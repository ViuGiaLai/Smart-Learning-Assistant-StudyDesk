// ---------------------------------------------------------------------------
// Smart Learning Assistant - Study Desk Firmware
// Board: ESP32 DevKit V1
// Sensors: DHT22 (GPIO4), PIR HC-SR501 (GPIO27), LDR module (GPIO34)
// Outputs: LED (GPIO2), active buzzer (GPIO25), relay/fan (GPIO26)
// OLED:    SSD1306 128x64 I2C (SDA=GPIO21, SCL=GPIO22)
//
// Data flow: read -> queue -> MQTT smartstudy/<DEVICE_CODE>/telemetry
// Commands:  MQTT smartstudy/<DEVICE_CODE>/command
// Status:    MQTT smartstudy/<DEVICE_CODE>/status (retained + LWT)
// ---------------------------------------------------------------------------
#include <Arduino.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <time.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#include "config.h"

#if ENABLE_HTTP_FALLBACK || ENABLE_HTTP_ALERTS
#include <HTTPClient.h>
#endif

// ---------------------------------------------------------------------------
// Hardware objects
// ---------------------------------------------------------------------------
DHT dht(DHT_PIN, DHT22);
WiFiClient networkClient;
PubSubClient mqtt(networkClient);
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

static const char *TELEMETRY_TOPIC = TOPIC_PREFIX "/" DEVICE_CODE "/telemetry";
static const char *COMMAND_TOPIC   = TOPIC_PREFIX "/" DEVICE_CODE "/command";
static const char *STATUS_TOPIC    = TOPIC_PREFIX "/" DEVICE_CODE "/status";

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------
struct PendingReading {
  char messageId[40];
  float temperature;
  float humidity;
  int light;
  bool motion;
  uint32_t recordedEpoch;
};

static const uint8_t QUEUE_SIZE = 20;
PendingReading queueBuffer[QUEUE_SIZE];
uint8_t queueCount = 0;

// ---------------------------------------------------------------------------
// Device state
// ---------------------------------------------------------------------------
bool ledState    = false;
bool buzzerState = false;
bool fanState    = false;
bool alertsEnabled = true;
bool autoControl   = true;
bool fanAuto       = true;
uint32_t manualHoldUntil    = 0;
uint32_t fanManualHoldUntil = 0;

static const int      LIGHT_HYSTERESIS_LUX = 60;
static const uint32_t MANUAL_HOLD_MS       = 30UL * 60UL * 1000UL;

float    temperatureMin  = TEMP_MIN_DEFAULT;
float    temperatureMax  = TEMP_MAX_DEFAULT;
float    humidityMin     = HUMIDITY_MIN_DEFAULT;
float    humidityMax     = HUMIDITY_MAX_DEFAULT;
int      lightMinLux     = LIGHT_MIN_DEFAULT;
uint32_t sampleIntervalMs = SAMPLE_INTERVAL_MS;

#if ENABLE_HTTP_ALERTS
uint32_t lastHttpAlertAt = 0;
char     lastHttpAlertType[32] = "";
#endif

uint32_t lastSampleAt = 0;
uint32_t bootAt       = 0;

// ---------------------------------------------------------------------------
// Alarm (Study-Done notification)
// ---------------------------------------------------------------------------
bool     alarmActive     = false;
uint32_t alarmUntil      = 0;
uint32_t alarmStartedAt  = 0;
uint32_t lastAlarmBlinkAt = 0;
bool     alarmPulseState = false;

// ---------------------------------------------------------------------------
// OLED – Screen state machine
// ---------------------------------------------------------------------------
enum OledScreen {
  SCR_BOOT, SCR_STANDBY, SCR_FOCUS, SCR_FINAL10,
  SCR_DONE, SCR_BREAK, SCR_CMD_FEEDBACK, SCR_AUTO_ALERT, SCR_AI_VOICE
};
OledScreen currentScreen = SCR_BOOT;

// Study countdown
bool     studyActive          = false;
int32_t  studyRemainingSeconds = 0;
int32_t  studyTotalSeconds     = 0;
uint32_t studyLastTickAt      = 0;
int      studyPlannedMinutes  = 25;

// Break countdown
bool     breakActive          = false;
int32_t  breakRemainingSeconds = 0;
uint32_t breakLastTickAt      = 0;

// Transient feedback screens
char     cmdFeedbackText[20] = "";
uint32_t cmdFeedbackUntil   = 0;
char     autoAlertText[20]  = "";
uint32_t autoAlertUntil     = 0;

// AI voice
bool    aiListening  = false;
bool    aiThinking   = false;
uint8_t aiAnimFrame  = 0;
uint32_t aiAnimLastAt = 0;
static uint8_t aiBars[7] = {2,4,8,12,8,4,2};

// Robot blink
bool     robotEyeOpen = true;
uint32_t robotBlinkAt = 0;

// Boot progress
uint8_t  bootProgress = 0;
bool     bootDone     = false;

// OLED sensor cache (updated by sampleAndPublish)
float oledTemp   = NAN;
float oledHum    = NAN;
float oledLux    = 0;
bool  oledMotion = false;

// Forward declaration
void drawScreenBoot();
uint32_t lastWifiAttemptAt = 0;
uint32_t lastMqttAttemptAt = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
String makeMessageId() {
  char buffer[40];
  snprintf(buffer, sizeof(buffer), "%08lx%08lx",
           (unsigned long)esp_random(), (unsigned long)esp_random());
  return String(buffer);
}

uint32_t currentEpoch() {
  time_t now = time(nullptr);
  return (now > 1700000000) ? (uint32_t)now : 0;
}

String isoUtc(uint32_t epoch) {
  if (epoch == 0) return String("");
  time_t raw = (time_t)epoch;
  struct tm ti;
  gmtime_r(&raw, &ti);
  char buffer[24];
  strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &ti);
  return String(buffer);
}

float estimateLux(int raw) {
  if (raw < 0) raw = 0;
  if (raw > 4095) raw = 4095;
  float ratio = (float)raw / 4095.0f;
#if LDR_INVERTED
  ratio = 1.0f - ratio;
#endif
  return 1000.0f * powf(ratio, 2.2f);
}

// ---------------------------------------------------------------------------
// Output control
// ---------------------------------------------------------------------------
void setLed(bool value) {
  ledState = value;
  digitalWrite(LED_PIN, value ? HIGH : LOW);
}

void setFan(bool value) {
  fanState = value;
#if FAN_ACTIVE_LOW
  digitalWrite(FAN_PIN, value ? LOW : HIGH);
#else
  digitalWrite(FAN_PIN, value ? HIGH : LOW);
#endif
  Serial.printf("[fan] %s -> D%d = %s (FAN_ACTIVE_LOW=%d)\n",
                value ? "BAT" : "TAT", FAN_PIN,
                digitalRead(FAN_PIN) ? "3.3V" : "0V", FAN_ACTIVE_LOW);
}

void setBuzzer(bool value) {
  buzzerState = value;
  pinMode(BUZZER_PIN, OUTPUT);
}

// ---------------------------------------------------------------------------
// Alarm / Study Done
// ---------------------------------------------------------------------------
void triggerStudyDoneAlarm(uint32_t durationMs = 8000) {
  alarmActive     = true;
  alarmStartedAt  = millis();
  alarmUntil      = millis() + durationMs;
  lastAlarmBlinkAt = millis();
  alarmPulseState = true;
  digitalWrite(LED_PIN, HIGH);
  digitalWrite(BUZZER_PIN, HIGH);
  buzzerState = true;
  // Chuyển sang màn DONE
  studyActive   = false;
  currentScreen = SCR_DONE;
  Serial.printf("[alarm] Hoan thanh %d phut: Den nhap nhay + Coi bao (8s)\n", studyPlannedMinutes);
}

void triggerAlarm(uint32_t durationMs = 8000) {
  triggerStudyDoneAlarm(durationMs);
}

void stopAlarm() {
  alarmActive     = false;
  alarmPulseState = false;
  digitalWrite(BUZZER_PIN, LOW);
  buzzerState = false;
  setLed(ledState);
  // Quay về STANDBY sau khi tắt
  if (currentScreen == SCR_DONE) currentScreen = SCR_STANDBY;
  Serial.println("[alarm] Da tat bao het gio");
}

// ---------------------------------------------------------------------------
// Auto control
// ---------------------------------------------------------------------------
void applyAutoLed(float lux) {
  if (alarmActive) return;
  if (!autoControl) return;
  if (millis() < manualHoldUntil) return;
  bool wasOff = !ledState;
  if (lux < (float)lightMinLux) {
    if (!ledState) {
      setLed(true);
      Serial.printf("[auto] den BAT: ~%.0f lux < nguong %d\n", lux, lightMinLux);
      // Màn AUTO ALERT
      snprintf(autoAlertText, sizeof(autoAlertText), "BAT DEN");
      autoAlertUntil = millis() + 3000;
      if (currentScreen != SCR_CMD_FEEDBACK) currentScreen = SCR_AUTO_ALERT;
    }
  } else if (lux >= (float)(lightMinLux + LIGHT_HYSTERESIS_LUX)) {
    if (ledState) {
      setLed(false);
      Serial.printf("[auto] den TAT: ~%.0f lux >= nguong %d\n", lux,
                    lightMinLux + LIGHT_HYSTERESIS_LUX);
    }
  }
}

void applyAutoFan(float temperature) {
  if (!fanAuto) return;
  if (millis() < fanManualHoldUntil) return;
  if (isnan(temperature)) return;
  if (temperature > temperatureMax) {
    if (!fanState) {
      setFan(true);
      Serial.printf("[auto] quat BAT: %.1fC > nguong %.1fC\n", temperature, temperatureMax);
      snprintf(autoAlertText, sizeof(autoAlertText), "BAT QUAT");
      autoAlertUntil = millis() + 3000;
      if (currentScreen != SCR_CMD_FEEDBACK) currentScreen = SCR_AUTO_ALERT;
    }
  } else if (temperature <= (temperatureMax - FAN_HYSTERESIS_C)) {
    if (fanState) {
      setFan(false);
      Serial.printf("[auto] quat TAT: %.1fC <= %.1fC\n", temperature,
                    temperatureMax - FAN_HYSTERESIS_C);
    }
  }
}

// ---------------------------------------------------------------------------
// MQTT status
// ---------------------------------------------------------------------------
void publishStatus(const char *status) {
  if (!mqtt.connected()) return;
  JsonDocument doc;
  doc["device_id"] = DEVICE_CODE;
  doc["status"]    = status;
  char payload[128];
  size_t length = serializeJson(doc, payload, sizeof(payload));
  mqtt.publish(STATUS_TOPIC, (const uint8_t *)payload, length, true);
}

// ---------------------------------------------------------------------------
// Queue + telemetry
// ---------------------------------------------------------------------------
void enqueueReading(const PendingReading &reading) {
  if (queueCount >= QUEUE_SIZE) {
    for (uint8_t i = 1; i < QUEUE_SIZE; i++) queueBuffer[i - 1] = queueBuffer[i];
    queueCount = QUEUE_SIZE - 1;
  }
  queueBuffer[queueCount++] = reading;
}

bool publishReading(const PendingReading &reading) {
  JsonDocument doc;
  doc["device_id"]      = DEVICE_CODE;
  doc["message_id"]     = reading.messageId;
  if (!isnan(reading.temperature)) doc["temperature"] = reading.temperature;
  if (!isnan(reading.humidity))    doc["humidity"]    = reading.humidity;
  doc["light"]          = reading.light;
  doc["light_lux"]      = roundf(estimateLux(reading.light) * 10.0f) / 10.0f;
  doc["motion_detected"] = reading.motion;
  doc["fan_on"]         = fanState;
  doc["fan_auto"]       = fanAuto;
  doc["led_on"]         = ledState;
  String ts = isoUtc(reading.recordedEpoch);
  if (ts.length() > 0) doc["timestamp"] = ts;
  char payload[420];
  size_t length = serializeJson(doc, payload, sizeof(payload));
  return mqtt.publish(TELEMETRY_TOPIC, (const uint8_t *)payload, length, false);
}

void flushQueue() {
  while (queueCount > 0 && mqtt.connected()) {
    if (!publishReading(queueBuffer[0])) return;
    for (uint8_t i = 1; i < queueCount; i++) queueBuffer[i - 1] = queueBuffer[i];
    queueCount--;
  }
}

#if ENABLE_HTTP_FALLBACK
bool postReadingHttp(const PendingReading &reading) {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  http.begin(String(API_BASE_URL) + "/api/iot/telemetry");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Code", DEVICE_CODE);
  http.addHeader("X-Device-Key", DEVICE_KEY);
  JsonDocument doc;
  doc["message_id"] = reading.messageId;
  if (!isnan(reading.temperature)) doc["temperature"] = reading.temperature;
  if (!isnan(reading.humidity))    doc["humidity"]    = reading.humidity;
  doc["light"]           = reading.light;
  doc["light_lux"]       = roundf(estimateLux(reading.light) * 10.0f) / 10.0f;
  doc["motion_detected"] = reading.motion;
  doc["fan_on"]          = fanState;
  doc["fan_auto"]        = fanAuto;
  doc["led_on"]          = ledState;
  String ts = isoUtc(reading.recordedEpoch);
  if (ts.length() > 0) doc["timestamp"] = ts;
  String payload;
  serializeJson(doc, payload);
  int status = http.POST(payload);
  http.end();
  return status == 200 || status == 202;
}
#endif

void flushAllTransports() {
  while (queueCount > 0) {
    if (mqtt.connected()) {
      if (!publishReading(queueBuffer[0])) return;
    } else {
#if ENABLE_HTTP_FALLBACK
      if (!postReadingHttp(queueBuffer[0])) return;
#else
      return;
#endif
    }
    for (uint8_t i = 1; i < queueCount; i++) queueBuffer[i - 1] = queueBuffer[i];
    queueCount--;
  }
}

// ---------------------------------------------------------------------------
// HTTP alerts
// ---------------------------------------------------------------------------
#if ENABLE_HTTP_ALERTS
const char *detectAlert(float temperature, float humidity, float lightLux, bool motion) {
  if (!isnan(temperature) && temperature > temperatureMax) return "HIGH_TEMPERATURE";
  if (!isnan(temperature) && temperature < temperatureMin) return "LOW_TEMPERATURE";
  if (!isnan(humidity) && humidity > humidityMax) return "HIGH_HUMIDITY";
  if (!isnan(humidity) && humidity < humidityMin) return "LOW_HUMIDITY";
  if (lightLux < (float)lightMinLux) return "LOW_LIGHT";
  if (motion) return "MOTION_DETECTED";
  return nullptr;
}

bool postAlertHttp(const PendingReading &reading, const char *alertType) {
  if (WiFi.status() != WL_CONNECTED || strlen(API_BASE_URL) == 0) return false;
  if (strlen(DEVICE_KEY) == 0 || strcmp(DEVICE_KEY, "sk_replace_me") == 0) return false;
  HTTPClient http;
  http.begin(String(API_BASE_URL) + "/api/iot/alerts");
  http.setTimeout(4000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Code", DEVICE_CODE);
  http.addHeader("X-Device-Key", DEVICE_KEY);
  JsonDocument doc;
  doc["device_id"]  = DEVICE_CODE;
  doc["message_id"] = reading.messageId;
  if (!isnan(reading.temperature)) doc["temperature"] = reading.temperature;
  if (!isnan(reading.humidity))    doc["humidity"]    = reading.humidity;
  doc["light"]     = reading.light;
  doc["light_lux"] = roundf(estimateLux(reading.light) * 10.0f) / 10.0f;
  doc["motion"]    = reading.motion ? 1 : 0;
  doc["alert_type"] = alertType;
  String ts = isoUtc(reading.recordedEpoch);
  if (ts.length() > 0) doc["timestamp"] = ts;
  String payload;
  serializeJson(doc, payload);
  int status = http.POST(payload);
  http.end();
  Serial.printf("[alert-http] type=%s status=%d\n", alertType, status);
  return status == 200 || status == 202;
}

void maybeSendAlertHttp(const PendingReading &reading) {
  float lux = estimateLux(reading.light);
  const char *alertType = detectAlert(reading.temperature, reading.humidity, lux, reading.motion);
  if (alertType == nullptr) return;
  uint32_t now = millis();
  if (strcmp(alertType, lastHttpAlertType) == 0 && now - lastHttpAlertAt < HTTP_ALERT_COOLDOWN_MS) return;
  strncpy(lastHttpAlertType, alertType, sizeof(lastHttpAlertType) - 1);
  lastHttpAlertType[sizeof(lastHttpAlertType) - 1] = '\0';
  lastHttpAlertAt = now;
  postAlertHttp(reading, alertType);
}
#endif

// ---------------------------------------------------------------------------
// MQTT command handler
// ---------------------------------------------------------------------------
void applyThresholds(JsonObject thresholds) {
  if (!thresholds["temperature_min"].isNull()) temperatureMin = thresholds["temperature_min"].as<float>();
  if (!thresholds["temperature_max"].isNull()) temperatureMax = thresholds["temperature_max"].as<float>();
  if (!thresholds["humidity_min"].isNull())    humidityMin    = thresholds["humidity_min"].as<float>();
  if (!thresholds["humidity_max"].isNull())    humidityMax    = thresholds["humidity_max"].as<float>();
  if (!thresholds["light_min_lux"].isNull())   lightMinLux   = (int)thresholds["light_min_lux"].as<float>();
  if (!thresholds["sample_interval_seconds"].isNull()) {
    int s = thresholds["sample_interval_seconds"].as<int>();
    s = constrain(s, 2, 300);
    sampleIntervalMs = (uint32_t)s * 1000UL;
  }
  if (!thresholds["auto_control"].isNull()) autoControl = thresholds["auto_control"].as<bool>();
  if (!thresholds["fan_auto"].isNull())     fanAuto     = thresholds["fan_auto"].as<bool>();
  Serial.printf("[config] temp=[%.1f,%.1f] hum=[%.0f,%.0f] light=%d interval=%lums auto=%d fan_auto=%d\n",
                temperatureMin, temperatureMax, humidityMin, humidityMax, lightMinLux,
                (unsigned long)sampleIntervalMs, autoControl ? 1 : 0, fanAuto ? 1 : 0);
}

void onCommand(char *topic, byte *payload, unsigned int length) {
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, payload, length);
  if (error) {
    Serial.printf("[mqtt] invalid command JSON: %s\n", error.c_str());
    return;
  }
  const char *action = doc["action"] | "";
  bool value = doc["value"] | false;

  if (strcmp(action, "set_led") == 0) {
    manualHoldUntil = millis() + MANUAL_HOLD_MS;
    setLed(value);
    snprintf(cmdFeedbackText, sizeof(cmdFeedbackText), value ? "BAT DEN" : "TAT DEN");
    cmdFeedbackUntil = millis() + 2000;
    currentScreen = SCR_CMD_FEEDBACK;

  } else if (strcmp(action, "set_fan") == 0) {
    fanManualHoldUntil = millis() + MANUAL_HOLD_MS;
    setFan(value);
    snprintf(cmdFeedbackText, sizeof(cmdFeedbackText), value ? "BAT QUAT" : "TAT QUAT");
    cmdFeedbackUntil = millis() + 2000;
    currentScreen = SCR_CMD_FEEDBACK;

  } else if (strcmp(action, "set_fan_auto") == 0) {
    fanAuto = value;
    if (value) fanManualHoldUntil = 0;

  } else if (strcmp(action, "set_buzzer") == 0) {
    buzzerState = value;
    digitalWrite(BUZZER_PIN, value ? HIGH : LOW);
    if (!value && alarmActive) {
      stopAlarm();
    }
    // Hiện phản hồi lệnh thủ công 2s, không chuyển sang màn DONE
    snprintf(cmdFeedbackText, sizeof(cmdFeedbackText), value ? "BAT COI" : "TAT COI");
    cmdFeedbackUntil = millis() + 2000;
    currentScreen = SCR_CMD_FEEDBACK;

  } else if (strcmp(action, "alarm") == 0 || strcmp(action, "study_done") == 0) {
    int mins = doc["planned_minutes"] | doc["value"] | 0;
    if (mins > 0) studyPlannedMinutes = mins;
    triggerStudyDoneAlarm(8000);

  } else if (strcmp(action, "set_alerts") == 0) {
    alertsEnabled = value;

  } else if (strcmp(action, "set_thresholds") == 0) {
    JsonObject thresholds = doc["value"].as<JsonObject>();
    if (!thresholds.isNull()) applyThresholds(thresholds);

  } else if (strcmp(action, "ping") == 0) {
    publishStatus("online");

  // ---- OLED Study commands ----
  } else if (strcmp(action, "study_start") == 0) {
    int secs = doc["value"] | 1500;
    int mins = doc["planned_minutes"] | (secs / 60);
    if (mins <= 0) mins = secs / 60;
    if (mins <= 0) mins = 25;
    studyPlannedMinutes   = mins;
    studyTotalSeconds     = secs;
    studyRemainingSeconds = secs;
    studyLastTickAt       = millis();
    studyActive           = true;
    breakActive           = false;
    currentScreen         = SCR_FOCUS;
    Serial.printf("[study] start: %d phut (%d giay)\n", studyPlannedMinutes, secs);

  } else if (strcmp(action, "study_stop") == 0) {
    studyActive = false;
    breakActive = false;
    if (currentScreen == SCR_FOCUS || currentScreen == SCR_FINAL10) {
      currentScreen = SCR_STANDBY;
    }

  } else if (strcmp(action, "study_break") == 0) {
    int secs = doc["value"] | 300;
    studyActive           = false;
    breakActive           = true;
    breakRemainingSeconds = secs;
    breakLastTickAt       = millis();
    currentScreen         = SCR_BREAK;
    Serial.printf("[study] break: %d giay\n", secs);

  } else if (strcmp(action, "ai_listen") == 0) {
    aiListening   = true;
    aiThinking    = false;
    currentScreen = SCR_AI_VOICE;

  } else if (strcmp(action, "ai_think") == 0) {
    aiListening   = false;
    aiThinking    = true;
    currentScreen = SCR_AI_VOICE;

  } else if (strcmp(action, "ai_done") == 0) {
    aiListening = false;
    aiThinking  = false;
    currentScreen = studyActive ? SCR_FOCUS : (breakActive ? SCR_BREAK : SCR_STANDBY);
  }

  Serial.printf("[mqtt] cmd=%s value=%d\n", action, (int)value);
}

// ---------------------------------------------------------------------------
// Connectivity
// ---------------------------------------------------------------------------
void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  uint32_t now = millis();
  if (now - lastWifiAttemptAt < 5000 && lastWifiAttemptAt != 0) return;
  lastWifiAttemptAt = now;

  Serial.printf("[wifi] connecting to %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  uint32_t started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 8000) {
    delay(200);
    Serial.print(".");
    if (bootProgress < 50) {
      bootProgress += 2;
      drawScreenBoot();
    }
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[wifi] connected, ip=%s\n", WiFi.localIP().toString().c_str());
    bootProgress = 60;
    drawScreenBoot();
  }
}

void connectMqtt() {
  if (mqtt.connected() || WiFi.status() != WL_CONNECTED) return;
  uint32_t now = millis();
  if (now - lastMqttAttemptAt < 5000 && lastMqttAttemptAt != 0) return;
  lastMqttAttemptAt = now;

  String clientId = String("esp32-") + DEVICE_CODE + "-" + String((uint32_t)esp_random(), HEX);
  bool ok;
  if (strlen(MQTT_USERNAME) > 0) {
    ok = mqtt.connect(clientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD,
                      STATUS_TOPIC, 1, true, "{\"status\":\"offline\"}");
  } else {
    ok = mqtt.connect(clientId.c_str(), STATUS_TOPIC, 1, true, "{\"status\":\"offline\"}");
  }
  if (ok) {
    Serial.println("[mqtt] connected");
    mqtt.subscribe(COMMAND_TOPIC, 1);
    publishStatus("online");
    flushQueue();
    bootProgress = 100;
    drawScreenBoot();
    delay(300);
    bootDone = true;
    currentScreen = SCR_STANDBY;
    Serial.println("[oled] Boot done -> STANDBY");
  } else {
    Serial.printf("[mqtt] failed rc=%d\n", mqtt.state());
  }
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------
void sampleAndPublish() {
  float temperature = dht.readTemperature();
  float humidity    = dht.readHumidity();
  int   light       = analogRead(LDR_PIN);
  float lightLux    = estimateLux(light);

  bool motion = false;
  if (millis() - bootAt > PIR_WARMUP_MS) {
    motion = digitalRead(PIR_PIN) == HIGH;
  }

  // Update OLED cache
  oledTemp   = temperature;
  oledHum    = humidity;
  oledLux    = lightLux;
  oledMotion = motion;

  PendingReading reading;
  String messageId = makeMessageId();
  messageId.toCharArray(reading.messageId, sizeof(reading.messageId));
  reading.temperature   = temperature;
  reading.humidity      = humidity;
  reading.light         = light;
  reading.motion        = motion;
  reading.recordedEpoch = currentEpoch();

  Serial.printf("[sensor] t=%.1fC h=%.1f%% light=%d (~%.0f lux) motion=%d\n",
                temperature, humidity, light, lightLux, motion ? 1 : 0);
  if (isnan(temperature) || isnan(humidity)) {
    Serial.println("[sensor] DHT22 read failed");
  }

  applyAutoLed(lightLux);
  applyAutoFan(temperature);

  enqueueReading(reading);
  flushAllTransports();

#if ENABLE_HTTP_ALERTS
  if (alertsEnabled) maybeSendAlertHttp(reading);
#endif
}

// ---------------------------------------------------------------------------
// OLED draw helpers
// ---------------------------------------------------------------------------

// Zone A: y=0  h=10  — cảm biến + WiFi/MQTT
void drawStatusBar() {
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  if (!isnan(oledTemp)) { display.print((int)oledTemp); display.print("C "); }
  else display.print("--C ");
  if (!isnan(oledHum))  { display.print((int)oledHum);  display.print("% "); }
  else display.print("--% ");
  display.print((int)oledLux);
  display.print("L ");
  bool wifiOk = (WiFi.status() == WL_CONNECTED);
  bool mqttOk = mqtt.connected();
  display.print(wifiOk ? (mqttOk ? "OK" : "W+") : "X");
  display.drawLine(0, 10, 127, 10, SSD1306_WHITE);
}

// Zone C: y=52 h=12  — trạng thái linh kiện
void drawDeviceBar() {
  display.drawLine(0, 52, 127, 52, SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 55);
  display.print("P:");
  display.print(oledMotion ? "Y" : "N");
  display.print(" FAN:");
  display.print(fanState ? "ON" : "OF");
  display.print(" LED:");
  display.print(ledState ? "ON" : "OF");
}

// ---------------------------------------------------------------------------
// Màn 1: BOOT
// ---------------------------------------------------------------------------
void drawScreenBoot() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(14, 2);
  display.print("SMART STUDY DESK");
  display.setCursor(10, 16);
  display.print("Dang ket noi...");
  // Progress bar
  display.drawRect(10, 28, 108, 10, SSD1306_WHITE);
  int fillW = (int)(bootProgress * 1.08f);
  if (fillW > 108) fillW = 108;
  if (fillW > 0) display.fillRect(10, 28, fillW, 10, SSD1306_WHITE);
  // WiFi label
  display.setCursor(4, 46);
  display.print("WiFi: ");
  display.print(WIFI_SSID);
  display.setCursor(4, 56);
  display.print("MQTT: ");
  display.print(mqtt.connected() ? "OK" : "...");
  display.display();
}

// ---------------------------------------------------------------------------
// Robot Face Graphic Renderer (Left Zone: x=4, y=13, w=50, h=36)
// ---------------------------------------------------------------------------
void drawRobotFace(int x, int y, int w, int h, bool motion, bool eyeOpen) {
  // Khung dau robot bo tron goc
  display.drawRoundRect(x, y, w, h, 4, SSD1306_WHITE);

  if (motion) {
    // === CO NGUOI: MAT SANG LONG LANH + MIENG CUOI ===
    if (eyeOpen) {
      // 2 mat to tron hien dai (phong cach robot EMO/Cozmo)
      display.fillRoundRect(x + 10, y + 8, 9, 12, 2, SSD1306_WHITE);
      display.fillRoundRect(x + 31, y + 8, 9, 12, 2, SSD1306_WHITE);
      // Diem sang trong mat (catchlight)
      display.drawPixel(x + 12, y + 10, SSD1306_BLACK);
      display.drawPixel(x + 33, y + 10, SSD1306_BLACK);
    } else {
      // Chop mat 150ms: 2 duong ke ngang thanh manh
      display.drawFastHLine(x + 10, y + 14, 9, SSD1306_WHITE);
      display.drawFastHLine(x + 31, y + 14, 9, SSD1306_WHITE);
    }
    // Ma hong 2 ben
    display.drawFastHLine(x + 6, y + 23, 4, SSD1306_WHITE);
    display.drawFastHLine(x + 40, y + 23, 4, SSD1306_WHITE);
    // Mieng cuoi duy nhat o giua (duong cong mem mai)
    display.drawLine(x + 19, y + 25, x + 22, y + 28, SSD1306_WHITE);
    display.drawLine(x + 22, y + 28, x + 28, y + 28, SSD1306_WHITE);
    display.drawLine(x + 28, y + 28, x + 31, y + 25, SSD1306_WHITE);
  } else {
    // === VANG MAT: MAT NHAM NGU + MIENG NGAY 'o' + zZz ===
    // 2 mat nham ngu yen binh
    display.drawFastHLine(x + 10, y + 14, 9, SSD1306_WHITE);
    display.drawFastHLine(x + 31, y + 14, 9, SSD1306_WHITE);
    // Mieng tho ngay tron nho 'o'
    display.drawCircle(x + 25, y + 26, 2, SSD1306_WHITE);
    // Ky hieu zZ bay len o goc tren
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(x + 36, y + 3); display.print("z");
    display.setCursor(x + 42, y + 2); display.print("Z");
  }
}

// ---------------------------------------------------------------------------
// Màn 2: STANDBY — Robot cảm xúc + Giờ NTP
// ---------------------------------------------------------------------------
void drawScreenStandby() {
  display.clearDisplay();
  drawStatusBar();

  // Mat robot do hoa chuan x=4, y=13, w=50, h=36
  drawRobotFace(4, 13, 50, 36, oledMotion, robotEyeOpen);

  // --- Clock + status (right zone x=60..127) ---
  time_t now = time(nullptr);
  struct tm ti;
  localtime_r(&now, &ti);
  char timeBuf[6];
  snprintf(timeBuf, sizeof(timeBuf), "%02d:%02d", ti.tm_hour, ti.tm_min);
  display.setTextSize(2);
  display.setCursor(62, 16);
  display.print(timeBuf);

  display.setTextSize(1);
  display.setCursor(62, 38);
  display.print(oledMotion ? "SAN SANG" : "VANG MAT");

  drawDeviceBar();
  display.display();
}

// ---------------------------------------------------------------------------
// Màn 3: FOCUS — Đếm ngược Pomodoro
// ---------------------------------------------------------------------------
void drawScreenFocus() {
  display.clearDisplay();
  drawStatusBar();

  // Countdown "MM:SS" ở giữa, font 3 (18×24), 5 chars × 18 = 90px → x=19
  display.setTextSize(3);
  char timeBuf[6];
  int32_t mm = studyRemainingSeconds / 60;
  int32_t ss = studyRemainingSeconds % 60;
  snprintf(timeBuf, sizeof(timeBuf), "%02d:%02d", (int)mm, (int)ss);
  display.setCursor(19, 14);
  display.print(timeBuf);

  // Progress bar y=41, width 110
  display.drawRect(9, 41, 110, 7, SSD1306_WHITE);
  if (studyTotalSeconds > 0) {
    int fillW = (int)((float)(studyTotalSeconds - studyRemainingSeconds)
                      / studyTotalSeconds * 108.0f);
    if (fillW > 0) display.fillRect(10, 42, fillW, 5, SSD1306_WHITE);
  }

  drawDeviceBar();
  display.display();
}

// ---------------------------------------------------------------------------
// Màn 4: FINAL 10s — Nhấp nháy cảnh báo
// ---------------------------------------------------------------------------
void drawScreenFinal10() {
  static bool blinkOn = true;
  static uint32_t lastBlink = 0;
  if (millis() - lastBlink >= 500) { blinkOn = !blinkOn; lastBlink = millis(); }

  display.clearDisplay();
  drawStatusBar();
  display.setTextColor(SSD1306_WHITE);

  // Dòng cảnh báo nhấp nháy
  display.setTextSize(1);
  if (blinkOn) {
    display.setCursor(10, 15);
    display.print(">>> SAP HET GIO! <<<");
  }

  // Số đếm ngược to ở giữa
  display.setTextSize(3);
  char timeBuf[4];
  snprintf(timeBuf, sizeof(timeBuf), "%02d", (int)studyRemainingSeconds);
  // 2 chars × 18px = 36px → center at x=46
  if (blinkOn) {
    display.setCursor(46, 24);
    display.print(timeBuf);
  }

  drawDeviceBar();
  display.display();
}

// ---------------------------------------------------------------------------
// Màn 5: STUDY DONE — Ăn mừng, nhấp nháy inverse
// ---------------------------------------------------------------------------
void drawScreenDone() {
  static bool inv = false;
  static uint32_t lastInv = 0;
  if (millis() - lastInv >= 300) { inv = !inv; lastInv = millis(); }

  display.clearDisplay();
  if (inv) display.fillRect(0, 0, 128, 64, SSD1306_WHITE);
  display.setTextColor(inv ? SSD1306_BLACK : SSD1306_WHITE);

  display.setTextSize(1);
  display.setCursor(14, 8);
  display.print("*  HOAN THANH!  *");

  // Robot mắt sao to ở giữa
  display.setTextSize(2);
  display.setCursor(24, 22);
  display.print("* O *");

  // Dòng thông báo đúng số phút thực tế đã học, tự động căn giữa
  display.setTextSize(1);
  char doneBuf[25];
  snprintf(doneBuf, sizeof(doneBuf), "DA HOC %d PHUT!", studyPlannedMinutes);
  int xOff = (128 - strlen(doneBuf) * 6) / 2;
  if (xOff < 0) xOff = 0;
  display.setCursor(xOff, 44);
  display.print(doneBuf);

  display.display();
}

// ---------------------------------------------------------------------------
// Màn 6: BREAK — Thư giãn + đếm ngược nghỉ
// ---------------------------------------------------------------------------
void drawScreenBreak() {
  display.clearDisplay();
  drawStatusBar();

  // Robot thư giãn (khung bo tròn)
  display.drawRoundRect(4, 13, 50, 36, 4, SSD1306_WHITE);
  // Mắt nhắm thư giãn
  display.drawFastHLine(14, 25, 9, SSD1306_WHITE);
  display.drawFastHLine(35, 25, 9, SSD1306_WHITE);
  // Miệng cười nhẹ thư giãn
  display.drawLine(22, 38, 25, 40, SSD1306_WHITE);
  display.drawLine(25, 40, 31, 40, SSD1306_WHITE);
  display.drawLine(31, 40, 34, 38, SSD1306_WHITE);
  // Chữ zZ
  display.setTextSize(1);
  display.setCursor(40, 15); display.print("zZ");

  // Break countdown - right
  display.setCursor(62, 16);
  display.setTextSize(1);
  display.print("NGHI NGOI");
  display.setTextSize(2);
  char timeBuf[6];
  snprintf(timeBuf, sizeof(timeBuf), "%02d:%02d",
           (int)(breakRemainingSeconds / 60), (int)(breakRemainingSeconds % 60));
  display.setCursor(62, 30);
  display.print(timeBuf);

  drawDeviceBar();
  display.display();
}

// ---------------------------------------------------------------------------
// Màn 7: CMD FEEDBACK — Hiện 2 giây khi nhận lệnh thủ công
// ---------------------------------------------------------------------------
void drawScreenCmdFeedback() {
  display.clearDisplay();
  drawStatusBar();

  display.setTextSize(1);
  display.setCursor(16, 18);
  display.print("> NHAN LENH <");

  display.setTextSize(2);
  int len = strlen(cmdFeedbackText);
  int xOff = (128 - len * 12) / 2;
  if (xOff < 0) xOff = 0;
  display.setCursor(xOff, 32);
  display.print(cmdFeedbackText);

  drawDeviceBar();
  display.display();
}

// ---------------------------------------------------------------------------
// Màn 8: AUTO ALERT — Hiện 3 giây khi tự động bật thiết bị
// ---------------------------------------------------------------------------
void drawScreenAutoAlert() {
  static bool blinkAlt = true;
  static uint32_t lastAlt = 0;
  if (millis() - lastAlt >= 400) { blinkAlt = !blinkAlt; lastAlt = millis(); }

  display.clearDisplay();
  drawStatusBar();

  // Khung robot bo tròn
  display.drawRoundRect(4, 13, 50, 36, 4, SSD1306_WHITE);
  // Mắt lo lắng > <
  display.setTextSize(1);
  display.setCursor(14, 21); display.print(">");
  display.setCursor(36, 21); display.print("<");
  // Miệng lo lắng ~
  display.drawLine(21, 38, 24, 36, SSD1306_WHITE);
  display.drawLine(24, 36, 28, 40, SSD1306_WHITE);
  display.drawLine(28, 40, 32, 36, SSD1306_WHITE);
  display.drawLine(32, 36, 35, 38, SSD1306_WHITE);

  // Alert text (right)
  display.setCursor(60, 14);
  display.print("TU DONG");
  display.setCursor(60, 26);
  display.print(autoAlertText);
  if (blinkAlt) {
    display.setCursor(60, 38);
    display.print("de ho tro");
  }

  drawDeviceBar();
  display.display();
}

// ---------------------------------------------------------------------------
// Màn 9: AI VOICE — Sóng âm animation
// ---------------------------------------------------------------------------
void drawScreenAiVoice() {
  if (millis() - aiAnimLastAt >= 150) {
    aiAnimLastAt = millis();
    aiAnimFrame++;
    for (int i = 0; i < 7; i++) aiBars[i] = (uint8_t)random(2, 14);
  }

  display.clearDisplay();
  drawStatusBar();

  display.setTextSize(1);
  display.setCursor(10, 14);
  display.print(aiThinking ? "DANG SUY NGHI..." : "DANG LANG NGHE...");

  // 7 thanh sóng, tổng width = 7×8 + 6×6 = 92px → start x=18
  for (int i = 0; i < 7; i++) {
    int bx = 18 + i * 14;
    int bh = aiBars[i];
    int by = 38 - bh;
    display.fillRect(bx, by, 8, bh, SSD1306_WHITE);
  }

  drawDeviceBar();
  display.display();
}

// ---------------------------------------------------------------------------
// OLED main update (gọi từ loop mỗi ~25ms)
// ---------------------------------------------------------------------------
void updateOled() {
  uint32_t now = millis();

  // --- Robot blink mỗi 3s, nháy 150ms ---
  if (robotEyeOpen && now - robotBlinkAt >= 3000) {
    robotEyeOpen = false;
    robotBlinkAt = now;
  } else if (!robotEyeOpen && now - robotBlinkAt >= 150) {
    robotEyeOpen = true;
    robotBlinkAt = now;
  }

  // --- Study countdown tick ---
  if (studyActive && now - studyLastTickAt >= 1000) {
    studyLastTickAt = now;
    if (studyRemainingSeconds > 0) {
      studyRemainingSeconds--;
      // Màn 4: 10 giây cuối → còi bíp 1 lần/giây nhẹ
      if (studyRemainingSeconds <= 10 && studyRemainingSeconds > 0) {
        currentScreen = SCR_FINAL10;
        digitalWrite(BUZZER_PIN, HIGH);
        delay(80);
        digitalWrite(BUZZER_PIN, LOW);
      }
      // Hết giờ → triggerAlarm (server cũng gửi, nhưng tự trigger an toàn hơn)
      if (studyRemainingSeconds == 0) {
        triggerAlarm(8000);
      }
    }
  }

  // --- Break countdown tick ---
  if (breakActive && now - breakLastTickAt >= 1000) {
    breakLastTickAt = now;
    if (breakRemainingSeconds > 0) {
      breakRemainingSeconds--;
    } else {
      breakActive   = false;
      currentScreen = SCR_STANDBY;
    }
  }

  // --- Transient screen expiry ---
  if (currentScreen == SCR_CMD_FEEDBACK && now >= cmdFeedbackUntil) {
    currentScreen = studyActive ? SCR_FOCUS : (breakActive ? SCR_BREAK : SCR_STANDBY);
  }
  if (currentScreen == SCR_AUTO_ALERT && now >= autoAlertUntil) {
    currentScreen = studyActive ? SCR_FOCUS : (breakActive ? SCR_BREAK : SCR_STANDBY);
  }

  // --- Render ---
  switch (currentScreen) {
    case SCR_BOOT:         drawScreenBoot();        break;
    case SCR_STANDBY:      drawScreenStandby();     break;
    case SCR_FOCUS:        drawScreenFocus();       break;
    case SCR_FINAL10:      drawScreenFinal10();     break;
    case SCR_DONE:         drawScreenDone();        break;
    case SCR_BREAK:        drawScreenBreak();       break;
    case SCR_CMD_FEEDBACK: drawScreenCmdFeedback(); break;
    case SCR_AUTO_ALERT:   drawScreenAutoAlert();   break;
    case SCR_AI_VOICE:     drawScreenAiVoice();     break;
  }
}

// ---------------------------------------------------------------------------
// Arduino lifecycle
// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(200);
  bootAt = millis();

  pinMode(PIR_PIN, INPUT_PULLDOWN);
  pinMode(LDR_PIN, INPUT);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  // Relay: đặt mức TẮT TRƯỚC khi set OUTPUT tránh relay nhảy lúc boot
#if FAN_ACTIVE_LOW
  digitalWrite(FAN_PIN, HIGH);
#else
  digitalWrite(FAN_PIN, LOW);
#endif
  pinMode(FAN_PIN, OUTPUT);
  Serial.printf("[boot] FAN_ACTIVE_LOW=%d | FAN_PIN=D%d | muc TAT = %s\n",
                FAN_ACTIVE_LOW, FAN_PIN, FAN_ACTIVE_LOW ? "HIGH (3.3V)" : "LOW (0V)");

  digitalWrite(BUZZER_PIN, LOW);
  setLed(false);
  stopAlarm();
  setFan(false);

  // OLED init
  Wire.begin(OLED_SDA, OLED_SCL);
  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    Serial.println("[oled] FAIL - khong tim thay man hinh SSD1306!");
  } else {
    display.clearDisplay();
    display.display();
    Serial.println("[oled] OK");
  }
  currentScreen = SCR_BOOT;
  bootProgress  = 5;
  bootDone      = false;
  drawScreenBoot(); // Hien ngay lap tuc tu mili-giay dau tien!

  dht.begin();
  connectWifi();
  configTime(7 * 3600, 0, "pool.ntp.org", "time.google.com"); // UTC+7

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onCommand);
  mqtt.setBufferSize(640);
  mqtt.setKeepAlive(30);
  connectMqtt();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWifi();
  } else if (!mqtt.connected()) {
    connectMqtt();
  }
  mqtt.loop();

  // --- Boot progress animation ---
  if (!bootDone) {
    if (mqtt.connected()) {
      bootProgress = 100;
      bootDone     = true;
      currentScreen = SCR_STANDBY;
      Serial.println("[oled] Boot done -> STANDBY");
    } else if (WiFi.status() == WL_CONNECTED && bootProgress < 60) {
      bootProgress = 60;
    } else if (bootProgress < 55) {
      bootProgress++;
    }
  }

  // --- Alarm pulse: LED + Còi đồng bộ nhấp nháy 150ms ---
  if (alarmActive) {
    uint32_t now = millis();
    if (now >= alarmUntil) {
      stopAlarm();
    } else if (now - lastAlarmBlinkAt >= 150) {
      lastAlarmBlinkAt  = now;
      alarmPulseState   = !alarmPulseState;
      digitalWrite(LED_PIN,    alarmPulseState ? HIGH : LOW);
      digitalWrite(BUZZER_PIN, alarmPulseState ? HIGH : LOW);
    }
  }

  // --- Sample + publish ---
  if (millis() - lastSampleAt >= sampleIntervalMs) {
    lastSampleAt = millis();
    sampleAndPublish();
  }

  // --- Retry queue ---
  if (mqtt.connected() && queueCount > 0) {
    flushQueue();
  }

  // --- OLED update ---
  updateOled();

  delay(10);
}

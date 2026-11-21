// ---------------------------------------------------------------------------
// Smart Learning Assistant - Study Desk Firmware
// Board: ESP32 DevKit V1 (Wokwi: board-esp32-devkit-c-v4)
// Sensors: DHT22 (GPIO4), PIR HC-SR501 (GPIO27), LDR module (GPIO34)
// Outputs: LED (GPIO2), active buzzer (GPIO25), relay/fan (GPIO26)
// LED2 + 220ohm tren Wokwi mo phong quat dang chay.
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

#include "config.h"

#if ENABLE_HTTP_FALLBACK || ENABLE_HTTP_ALERTS
#include <HTTPClient.h>
#endif

DHT dht(DHT_PIN, DHT22);
WiFiClient networkClient;
PubSubClient mqtt(networkClient);

static const char *TELEMETRY_TOPIC = TOPIC_PREFIX "/" DEVICE_CODE "/telemetry";
static const char *COMMAND_TOPIC = TOPIC_PREFIX "/" DEVICE_CODE "/command";
static const char *STATUS_TOPIC = TOPIC_PREFIX "/" DEVICE_CODE "/status";

struct PendingReading {
  char messageId[40];
  float temperature;
  float humidity;
  int light;
  bool motion;
  uint32_t recordedEpoch;
};

// Small in-RAM buffer: if Wi-Fi drops, readings are re-sent with the SAME
// message_id so the backend can deduplicate them.
static const uint8_t QUEUE_SIZE = 20;
PendingReading queueBuffer[QUEUE_SIZE];
uint8_t queueCount = 0;

bool ledState = false;
bool buzzerState = false;
bool fanState = false;
bool alertsEnabled = true;
// Tự động bật đèn khi tối / tắt khi đủ sáng (đồng bộ từ app qua set_thresholds).
bool autoControl = true;
// Tự động bật quạt khi nhiệt độ vượt temperature_max (do app đồng bộ).
bool fanAuto = true;
// Người dùng vừa bấm tay trên app thì tạm ngưng tự động để lệnh tay có hiệu lực.
uint32_t manualHoldUntil = 0;
uint32_t fanManualHoldUntil = 0;

// Trễ 60 lux quanh ngưỡng: tránh đèn bật/tắt liên tục khi ánh sáng dao động.
static const int LIGHT_HYSTERESIS_LUX = 60;
static const uint32_t MANUAL_HOLD_MS = 30UL * 60UL * 1000UL;

float temperatureMin = TEMP_MIN_DEFAULT;
float temperatureMax = TEMP_MAX_DEFAULT;
float humidityMin = HUMIDITY_MIN_DEFAULT;
float humidityMax = HUMIDITY_MAX_DEFAULT;
int lightMinLux = LIGHT_MIN_DEFAULT;
uint32_t sampleIntervalMs = SAMPLE_INTERVAL_MS;

#if ENABLE_HTTP_ALERTS
uint32_t lastHttpAlertAt = 0;
char lastHttpAlertType[32] = "";
#endif

uint32_t lastSampleAt = 0;
uint32_t bootAt = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
String makeMessageId() {
  char buffer[40];
  snprintf(buffer, sizeof(buffer), "%08lx%08lx", (unsigned long)esp_random(),
           (unsigned long)esp_random());
  return String(buffer);
}

uint32_t currentEpoch() {
  time_t now = time(nullptr);
  // Before NTP sync (or without internet) the RTC is meaningless.
  return (now > 1700000000) ? (uint32_t)now : 0;
}

String isoUtc(uint32_t epoch) {
  if (epoch == 0) return String("");
  time_t raw = (time_t)epoch;
  struct tm timeinfo;
  gmtime_r(&raw, &timeinfo);
  char buffer[24];
  strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &timeinfo);
  return String(buffer);
}

// Rough lux estimate for the local (offline) alert. Keep this in sync with
// backend/app/services/sensors.py:estimate_lux() so the device and the app
// agree on what "too dark" means. LDR_INVERTED handles modules whose AO
// voltage falls as the light gets brighter (e.g. the Wokwi module).
float estimateLux(int raw) {
  if (raw < 0) raw = 0;
  if (raw > 4095) raw = 4095;
  float ratio = (float)raw / 4095.0f;
#if LDR_INVERTED
  ratio = 1.0f - ratio;
#endif
  return 1000.0f * powf(ratio, 2.2f);
}

void setLed(bool value) {
  ledState = value;
  digitalWrite(LED_PIN, value ? HIGH : LOW);
}

// Điều khiển đèn theo ánh sáng đo được: tối thì bật, đủ sáng thì tắt.
// Bỏ qua khi người dùng đang giữ quyền điều khiển tay.
void applyAutoLed(float lux) {
  if (!autoControl) return;
  if (millis() < manualHoldUntil) return;
  if (lux < (float)lightMinLux) {
    if (!ledState) {
      setLed(true);
      Serial.printf("[auto] den BAT: ~%.0f lux < nguong %d\n", lux, lightMinLux);
    }
  } else if (lux >= (float)(lightMinLux + LIGHT_HYSTERESIS_LUX)) {
    if (ledState) {
      setLed(false);
      Serial.printf("[auto] den TAT: ~%.0f lux >= nguong %d\n", lux,
                    lightMinLux + LIGHT_HYSTERESIS_LUX);
    }
  }
}

void setBuzzer(bool value) {
  buzzerState = value;
  if (value) {
    tone(BUZZER_PIN, BUZZER_FREQUENCY);
  } else {
    noTone(BUZZER_PIN);
  }
}

// Quat that duoc noi qua relay: chi can doi dau ra relay tu LED mo phong
// sang quat that, code khong phai sua.
void setFan(bool value) {
  fanState = value;
#if FAN_ACTIVE_LOW
  digitalWrite(FAN_PIN, value ? LOW : HIGH);
#else
  digitalWrite(FAN_PIN, value ? HIGH : LOW);
#endif
}

// Tu dong bat quat khi nong: > temperatureMax thi BAT, <= temperatureMax -
// FAN_HYSTERESIS_C thi TAT (tre 2 do C de quat khong bat/tat lien tuc).
void applyAutoFan(float temperature) {
  if (!fanAuto) return;
  if (millis() < fanManualHoldUntil) return;
  if (isnan(temperature)) return;
  if (temperature > temperatureMax) {
    if (!fanState) {
      setFan(true);
      Serial.printf("[auto] quat BAT: %.1fC > nguong %.1fC\n", temperature,
                    temperatureMax);
    }
  } else if (temperature <= (temperatureMax - FAN_HYSTERESIS_C)) {
    if (fanState) {
      setFan(false);
      Serial.printf("[auto] quat TAT: %.1fC <= %.1fC\n", temperature,
                    temperatureMax - FAN_HYSTERESIS_C);
    }
  }
}

void publishStatus(const char *status) {
  if (!mqtt.connected()) return;
  JsonDocument doc;
  doc["device_id"] = DEVICE_CODE;
  doc["status"] = status;
  char payload[128];
  size_t length = serializeJson(doc, payload, sizeof(payload));
  mqtt.publish(STATUS_TOPIC, (const uint8_t *)payload, length, true);
}

// ---------------------------------------------------------------------------
// Queue + telemetry
// ---------------------------------------------------------------------------
void enqueueReading(const PendingReading &reading) {
  if (queueCount >= QUEUE_SIZE) {
    // Drop the oldest reading to keep the newest data.
    for (uint8_t i = 1; i < QUEUE_SIZE; i++) queueBuffer[i - 1] = queueBuffer[i];
    queueCount = QUEUE_SIZE - 1;
  }
  queueBuffer[queueCount++] = reading;
}

bool publishReading(const PendingReading &reading) {
  JsonDocument doc;
  doc["device_id"] = DEVICE_CODE;
  doc["message_id"] = reading.messageId;
  if (!isnan(reading.temperature)) doc["temperature"] = reading.temperature;
  if (!isnan(reading.humidity)) doc["humidity"] = reading.humidity;
  doc["light"] = reading.light;
  doc["light_lux"] = roundf(estimateLux(reading.light) * 10.0f) / 10.0f;
  doc["motion_detected"] = reading.motion;
  doc["fan_on"] = fanState;
  doc["fan_auto"] = fanAuto;
  doc["led_on"] = ledState;
  String timestamp = isoUtc(reading.recordedEpoch);
  if (timestamp.length() > 0) doc["timestamp"] = timestamp;

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
  if (!isnan(reading.humidity)) doc["humidity"] = reading.humidity;
  doc["light"] = reading.light;
  doc["light_lux"] = roundf(estimateLux(reading.light) * 10.0f) / 10.0f;
  doc["motion_detected"] = reading.motion;
  doc["fan_on"] = fanState;
  doc["fan_auto"] = fanAuto;
  doc["led_on"] = ledState;
  String timestamp = isoUtc(reading.recordedEpoch);
  if (timestamp.length() > 0) doc["timestamp"] = timestamp;

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
// MQTT command handler
// ---------------------------------------------------------------------------
void applyThresholds(JsonObject thresholds) {
  if (!thresholds["temperature_min"].isNull())
    temperatureMin = thresholds["temperature_min"].as<float>();
  if (!thresholds["temperature_max"].isNull())
    temperatureMax = thresholds["temperature_max"].as<float>();
  if (!thresholds["humidity_min"].isNull())
    humidityMin = thresholds["humidity_min"].as<float>();
  if (!thresholds["humidity_max"].isNull())
    humidityMax = thresholds["humidity_max"].as<float>();
  if (!thresholds["light_min_lux"].isNull())
    lightMinLux = (int)thresholds["light_min_lux"].as<float>();
  if (!thresholds["sample_interval_seconds"].isNull()) {
    int seconds = thresholds["sample_interval_seconds"].as<int>();
    seconds = constrain(seconds, 2, 300);
    sampleIntervalMs = (uint32_t)seconds * 1000UL;
  }
  if (!thresholds["auto_control"].isNull()) {
    autoControl = thresholds["auto_control"].as<bool>();
  }
  if (!thresholds["fan_auto"].isNull()) {
    fanAuto = thresholds["fan_auto"].as<bool>();
  }
  Serial.printf(
      "[config] temp=[%.1f, %.1f] humidity=[%.0f, %.0f] light_min=%d interval=%lums auto=%d "
      "fan_auto=%d\n",
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
  } else if (strcmp(action, "set_fan") == 0) {
    fanManualHoldUntil = millis() + MANUAL_HOLD_MS;
    setFan(value);
  } else if (strcmp(action, "set_fan_auto") == 0) {
    fanAuto = value;
    if (value) fanManualHoldUntil = 0;
  } else if (strcmp(action, "set_buzzer") == 0) {
    setBuzzer(value);
  } else if (strcmp(action, "set_alerts") == 0) {
    alertsEnabled = value;
  } else if (strcmp(action, "set_thresholds") == 0) {
    JsonObject thresholds = doc["value"].as<JsonObject>();
    if (!thresholds.isNull()) {
      applyThresholds(thresholds);
    }
  } else if (strcmp(action, "ping") == 0) {
    publishStatus("online");
  }
  Serial.printf("[mqtt] command=%s value=%d\n", action, value);
}

// ---------------------------------------------------------------------------
// Connectivity
// ---------------------------------------------------------------------------
void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.printf("[wifi] connecting to %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  uint32_t started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 20000) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[wifi] connected, ip=%s\n", WiFi.localIP().toString().c_str());
  }
}

void connectMqtt() {
  if (mqtt.connected() || WiFi.status() != WL_CONNECTED) return;
  String clientId = String("esp32-") + DEVICE_CODE + "-" + String((uint32_t)esp_random(), HEX);
  bool ok;
  if (strlen(MQTT_USERNAME) > 0) {
    ok = mqtt.connect(clientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD, STATUS_TOPIC, 1, true,
                      "{\"status\":\"offline\"}");
  } else {
    ok = mqtt.connect(clientId.c_str(), STATUS_TOPIC, 1, true, "{\"status\":\"offline\"}");
  }
  if (ok) {
    Serial.println("[mqtt] connected");
    mqtt.subscribe(COMMAND_TOPIC, 1);
    publishStatus("online");
    flushQueue();
  } else {
    Serial.printf("[mqtt] failed rc=%d\n", mqtt.state());
  }
}

// ---------------------------------------------------------------------------
// LAB3: ESP32 -> FastAPI alert over HTTP
// ---------------------------------------------------------------------------
#if ENABLE_HTTP_ALERTS
const char *detectAlert(float temperature, float humidity, float lightLux,
                        bool motion) {
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
  if (strlen(DEVICE_KEY) == 0 || strcmp(DEVICE_KEY, "sk_replace_me") == 0) {
    Serial.println("[alert-http] DEVICE_KEY chua cau hinh, bo qua");
    return false;
  }

  HTTPClient http;
  http.begin(String(API_BASE_URL) + "/api/iot/alerts");
  http.setTimeout(4000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Code", DEVICE_CODE);
  http.addHeader("X-Device-Key", DEVICE_KEY);

  JsonDocument doc;
  doc["device_id"] = DEVICE_CODE;
  doc["message_id"] = reading.messageId;
  if (!isnan(reading.temperature)) doc["temperature"] = reading.temperature;
  if (!isnan(reading.humidity)) doc["humidity"] = reading.humidity;
  doc["light"] = reading.light;
  doc["light_lux"] = roundf(estimateLux(reading.light) * 10.0f) / 10.0f;
  doc["motion"] = reading.motion ? 1 : 0;
  doc["alert_type"] = alertType;
  String timestamp = isoUtc(reading.recordedEpoch);
  if (timestamp.length() > 0) doc["timestamp"] = timestamp;

  String payload;
  serializeJson(doc, payload);
  int status = http.POST(payload);
  http.end();
  Serial.printf("[alert-http] type=%s status=%d\n", alertType, status);
  return status == 200 || status == 202;
}

void maybeSendAlertHttp(const PendingReading &reading) {
  float lightLux = estimateLux(reading.light);
  const char *alertType =
      detectAlert(reading.temperature, reading.humidity, lightLux, reading.motion);
  if (alertType == nullptr) return;

  uint32_t now = millis();
  if (strcmp(alertType, lastHttpAlertType) == 0 &&
      now - lastHttpAlertAt < HTTP_ALERT_COOLDOWN_MS) {
    return;
  }
  // Mark the attempt before the request: a dead backend must not be hammered
  // every sample interval. A failed alert is retried after the cooldown.
  strncpy(lastHttpAlertType, alertType, sizeof(lastHttpAlertType) - 1);
  lastHttpAlertType[sizeof(lastHttpAlertType) - 1] = '\0';
  lastHttpAlertAt = now;
  postAlertHttp(reading, alertType);
}
#endif

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------
void sampleAndPublish() {
  float temperature = dht.readTemperature();
  float humidity = dht.readHumidity();
  int light = analogRead(LDR_PIN);
  float lightLux = estimateLux(light);

  // HC-SR501 needs ~60s to stabilise after power-on.
  bool motion = false;
  if (millis() - bootAt > PIR_WARMUP_MS) {
    motion = digitalRead(PIR_PIN) == HIGH;
  }

  PendingReading reading;
  String messageId = makeMessageId();
  messageId.toCharArray(reading.messageId, sizeof(reading.messageId));
  reading.temperature = temperature;
  reading.humidity = humidity;
  reading.light = light;
  reading.motion = motion;
  reading.recordedEpoch = currentEpoch();

  Serial.printf("[sensor] t=%.1fC h=%.1f%% light=%d (~%.0f lux) motion=%d\n", temperature,
                humidity, light, lightLux, motion ? 1 : 0);

  if (isnan(temperature) || isnan(humidity)) {
    Serial.println("[sensor] DHT22 read failed (check pull-up / wiring)");
  }

  applyAutoLed(lightLux);
  applyAutoFan(temperature);

  enqueueReading(reading);
  flushAllTransports();

#if ENABLE_HTTP_ALERTS
  if (alertsEnabled) {
    maybeSendAlertHttp(reading);
  }
#endif

  // Còi nhắc khi phòng quá nóng và mất kết nối backend (đèn đã do applyAutoLed lo).
  if (alertsEnabled && !mqtt.connected()) {
    bool tooHot = !isnan(temperature) && temperature > temperatureMax;
    if (tooHot) {
      setBuzzer(true);
    } else {
      setBuzzer(false);
    }
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
  pinMode(FAN_PIN, OUTPUT);
  setLed(false);
  setBuzzer(false);
  setFan(false);

  dht.begin();
  connectWifi();
  configTime(0, 0, "pool.ntp.org", "time.google.com");

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onCommand);
  mqtt.setBufferSize(640);
  mqtt.setKeepAlive(30);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWifi();
  }
  if (!mqtt.connected()) {
    connectMqtt();
  }
  mqtt.loop();

  if (millis() - lastSampleAt >= sampleIntervalMs) {
    lastSampleAt = millis();
    sampleAndPublish();
  }

  // Retry buffered readings even between samples.
  if (mqtt.connected() && queueCount > 0) {
    flushQueue();
  }
  delay(10);
}

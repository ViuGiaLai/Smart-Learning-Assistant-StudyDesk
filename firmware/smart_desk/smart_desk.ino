// ---------------------------------------------------------------------------
// Smart Learning Assistant - Study Desk Firmware
// Board: ESP32 DevKit V1 (Wokwi: board-esp32-devkit-c-v4)
// Sensors: DHT22 (GPIO4), PIR HC-SR501 (GPIO27), LDR module (GPIO34)
// Outputs: LED (GPIO2), active buzzer (GPIO25)
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

#if ENABLE_HTTP_FALLBACK
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
bool alertsEnabled = true;

float temperatureMin = TEMP_MIN_DEFAULT;
float temperatureMax = TEMP_MAX_DEFAULT;
int lightMinLux = LIGHT_MIN_DEFAULT;
uint32_t sampleIntervalMs = SAMPLE_INTERVAL_MS;

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

void setBuzzer(bool value) {
  buzzerState = value;
  if (value) {
    tone(BUZZER_PIN, BUZZER_FREQUENCY);
  } else {
    noTone(BUZZER_PIN);
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
  if (!thresholds["light_min_lux"].isNull())
    lightMinLux = (int)thresholds["light_min_lux"].as<float>();
  if (!thresholds["sample_interval_seconds"].isNull()) {
    int seconds = thresholds["sample_interval_seconds"].as<int>();
    seconds = constrain(seconds, 2, 300);
    sampleIntervalMs = (uint32_t)seconds * 1000UL;
  }
  Serial.printf("[config] temp=[%.1f, %.1f] light_min=%d interval=%lums\n", temperatureMin,
                temperatureMax, lightMinLux, (unsigned long)sampleIntervalMs);
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
    setLed(value);
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
// Sampling
// ---------------------------------------------------------------------------
void sampleAndPublish() {
  float temperature = dht.readTemperature();
  float humidity = dht.readHumidity();
  int light = analogRead(LDR_PIN);

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
                humidity, light, estimateLux(light), motion ? 1 : 0);

  if (isnan(temperature) || isnan(humidity)) {
    Serial.println("[sensor] DHT22 read failed (check pull-up / wiring)");
  }

  enqueueReading(reading);
  flushAllTransports();

  // Local fallback alert when the backend is unreachable.
  if (alertsEnabled && !mqtt.connected()) {
    float lightLux = estimateLux(light);
    bool tooDark = lightLux < (float)lightMinLux;
    bool tooHot = !isnan(temperature) && temperature > temperatureMax;
    setLed(tooDark || tooHot);
    if (tooDark) {
      Serial.printf("[alert] dark: ~%.0f lux < %d lux\n", lightLux, lightMinLux);
    }
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

  pinMode(PIR_PIN, INPUT);
  pinMode(LDR_PIN, INPUT);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  setLed(false);
  setBuzzer(false);

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

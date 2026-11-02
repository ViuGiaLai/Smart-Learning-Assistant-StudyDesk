// ---------------------------------------------------------------------------
// Device configuration - copy the values you use in the mobile app.
// For real deployment, keep credentials out of git (use a private config.h).
// ---------------------------------------------------------------------------
#pragma once

// Wi-Fi (Wokwi uses this guest network)
#define WIFI_SSID "Wokwi-GUEST"
#define WIFI_PASSWORD ""

// MQTT broker
// - Wokwi: test.mosquitto.org (public, no auth - demo only!)
// - Real device: your LAN broker (e.g. 192.168.1.10) or a TLS broker.
// Point the backend's MQTT_HOST at the same broker.
#define MQTT_HOST "broker.emqx.io"
#define MQTT_PORT 1883
#define MQTT_USERNAME ""
#define MQTT_PASSWORD ""
#define TOPIC_PREFIX "smartstudy_demo_2f7c91"

// Must match the device_code registered in the app.
#define DEVICE_CODE "STUDY_DESK_001"

// Pin map (matches docs/02-phan-cung.md and diagram.json)
#define DHT_PIN 4
#define PIR_PIN 27
#define LDR_PIN 34
#define LED_PIN 2
#define BUZZER_PIN 25
#define BUZZER_FREQUENCY 2000

// Sampling: DHT22 needs >= 2 s between reads.
#define SAMPLE_INTERVAL_MS 10000
#define PIR_WARMUP_MS 60000

// Default thresholds (the app can override them via set_thresholds)
#define TEMP_MIN_DEFAULT 18.0f
#define TEMP_MAX_DEFAULT 30.0f
#define HUMIDITY_MIN_DEFAULT 30.0f
#define HUMIDITY_MAX_DEFAULT 70.0f
#define LIGHT_MIN_DEFAULT 150

// LDR module polarity (AO pin):
//   0 = voltage rises with light  -> common KY-018 / LM393 module
//   1 = voltage falls with light  -> Wokwi's wokwi-photoresistor-sensor
// If your real module reports "dark" in a bright room, flip this value.
#define LDR_INVERTED 0

// Optional HTTP fallback for networks that block MQTT.
// Create the device in the app, then paste its key here.
#define ENABLE_HTTP_FALLBACK 0
#define API_BASE_URL "http://192.168.1.10:8000"
#define DEVICE_KEY "sk_replace_me"

// LAB3: send a separate alert to FastAPI when a threshold is crossed.
// Keep this off for a real desk until API_BASE_URL and DEVICE_KEY are set.
#define ENABLE_HTTP_ALERTS 0
#define HTTP_ALERT_COOLDOWN_MS 60000UL

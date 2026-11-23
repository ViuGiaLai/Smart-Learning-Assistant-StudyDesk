// ---------------------------------------------------------------------------
// Device configuration - copy the values you use in the mobile app.
// For real deployment, keep credentials out of git (use a private config.h).
// ---------------------------------------------------------------------------
#pragma once

// Wi-Fi (Wokwi uses this virtual guest network - KHONG DOI khi chay mo phong tren Wokwi)
#define WIFI_SSID "Wokwi-GUEST"
#define WIFI_PASSWORD ""

// MQTT broker: Mosquitto rieng chay tren VPS (allow_anonymous false).
// - Tai khoan phai trung password_file cua broker.
// - Backend FastAPI phai tro ve cung broker nay (MQTT_HOST/MQTT_USERNAME/MQTT_PASSWORD).
// - Khong nen commit mat khau that khi nop bai: dung config.h rieng hoac bien moi truong.
#define MQTT_HOST "138.2.109.17"
#define MQTT_PORT 1883
#define MQTT_USERNAME "admin"
#define MQTT_PASSWORD "viu852005"
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
// Relay dieu khien quat (LED led2 trong Wokwi dai dien cho quat that).
// Sau nay chi can thay LED mo phong bang quat that o dau ra relay.
#define FAN_PIN 26
#define FAN_HYSTERESIS_C 2.0f
// 0 = relay kich muc CAO (Wokwi module dat transistor "pnp").
// 1 = relay kich muc THAP (nhieu module relay ngoai thi truong).
#define FAN_ACTIVE_LOW 1

// OLED SSD1306 128x64 I2C
#define OLED_SDA      21
#define OLED_SCL      22
#define OLED_ADDR     0x3C
#define SCREEN_WIDTH  128
#define SCREEN_HEIGHT 64

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
#define LDR_INVERTED 1

// Optional HTTP fallback for networks that block MQTT.
// Create the device in the app, then paste its key here.
#define ENABLE_HTTP_FALLBACK 0
#define API_BASE_URL "https://smartstudy.viuphuthien.id.vn"
#define DEVICE_KEY "sk_replace_me"

// LAB3: send a separate alert to FastAPI when a threshold is crossed.
// Keep this off for a real desk until API_BASE_URL and DEVICE_KEY are set.
#define ENABLE_HTTP_ALERTS 0
#define HTTP_ALERT_COOLDOWN_MS 60000UL

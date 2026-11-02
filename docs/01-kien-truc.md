# 01 — Kiến trúc hệ thống

## 1. Tổng quan

Hệ thống gồm bốn khối:

```text
┌────────────────────┐
│  Mobile app        │  Expo / React Native / TypeScript
│  (Android, iOS)    │  React Native Paper, Zustand, React Navigation
└─────────┬──────────┘
          │ REST (JSON) + WebSocket
          ▼
┌────────────────────┐        ┌──────────────────┐
│  FastAPI backend   │◄──────►│  PostgreSQL      │
│  REST + WS + MQTT  │        └──────────────────┘
│  Gemini (server)   │
└─────────┬──────────┘
          │ MQTT pub/sub
          ▼
┌────────────────────┐
│  Mosquitto broker  │
└─────────┬──────────┘
          │ smartstudy/<device>/telemetry|command|status
          ▼
┌────────────────────┐
│  ESP32 study desk  │  DHT22, PIR, LDR, LED, buzzer
└────────────────────┘
```

Ứng dụng di động **không kết nối trực tiếp** tới MQTT hay Gemini. Mọi dữ liệu đi qua
backend để:

- giấu API key Gemini;
- kiểm tra quyền sở hữu thiết bị;
- chuẩn hoá và chống trùng dữ liệu;
- tính thời gian học theo giờ server.

## 2. Thành phần backend

| Thư mục | Trách nhiệm |
|---|---|
| `app/api/` | Router HTTP/WebSocket, xác thực, phân trang |
| `app/core/` | Cấu hình, JWT, hash mật khẩu, tiện ích thời gian UTC |
| `app/db/` | Model SQLAlchemy 2 và session async |
| `app/schemas/` | Pydantic request/response, ràng buộc dữ liệu |
| `app/services/iot.py` | Chuẩn hoá telemetry, dedupe, phát WebSocket |
| `app/services/mqtt.py` | Vòng lặp kết nối MQTT, subscribe, publish lệnh, LWT |
| `app/services/alerts.py` | Đánh giá ngưỡng, cooldown, tự điều khiển LED |
| `app/services/stats.py` | Tính thời gian học, thống kê theo timezone, clamp timestamp |
| `app/services/ai.py` | Dựng context, gọi Gemini, fallback theo luật |
| `app/services/realtime.py` | Quản lý các kết nối WebSocket theo thiết bị |

### 2.1 Vòng đời ứng dụng

`app/main.py` dùng `lifespan`:

1. `init_db()` tạo bảng nếu chưa có.
2. `mqtt_service.start()` chạy listener nền, tự reconnect sau 5 giây nếu broker lỗi.
3. Tạo `offline_watchdog` quét mỗi 20 giây, đánh dấu thiết bị quá 90 giây không gửi dữ liệu.
4. Khi tắt: huỷ watchdog, dừng MQTT, đóng engine.

## 3. Mô hình dữ liệu

```text
users 1──n devices 1──n sensor_readings
  │
  ├──n study_sessions ──0..1 study_plans
  ├──n study_plans
  ├──n notifications
  └──n ai_conversations
```

Các điểm quan trọng:

- **`sensor_readings`** có unique `(device_id, message_id)` để chống ghi trùng.
  `recorded_at` là giờ thiết bị (đã clamp), `received_at` là giờ server.
- **`study_sessions`** lưu `accumulated_seconds` và `last_resumed_at`, nhờ đó thời gian
  không phụ thuộc đồng hồ điện thoại và vẫn đúng khi app bị đóng giữa phiên.
- **`devices.settings`** là JSON: ngưỡng nhiệt độ/độ ẩm/ánh sáng, thời gian không chuyển
  động, `collection_enabled`, `auto_control`, chu kỳ lấy mẫu.
- **`ai_conversations`** lưu câu hỏi, câu trả lời và snapshot context để tra cứu lại.

## 4. Luồng telemetry

Prefix lấy từ `MQTT_TOPIC_PREFIX` (mặc định `smartstudy`; bản demo đang chạy dùng
`smartstudy_demo_2f7c91`). Ví dụ dưới đây viết theo prefix mặc định.

```text
ESP32
  │ publish JSON
  ▼
smartstudy/STUDY_DESK_001/telemetry
  │
  ▼
mqtt.py: subscribe smartstudy/+/telemetry
  │ tìm Device theo device_code
  ▼
iot.ingest_telemetry()
  ├─ cập nhật status=online, last_seen_at
  ├─ nếu collection_enabled=false → không lưu
  ├─ nếu message_id đã tồn tại → duplicate=true, không lưu
  ├─ clamp timestamp thiết bị
  ├─ quy đổi LDR raw → lux (gần đúng)
  ├─ lưu SensorReading
  ├─ alerts.evaluate_environment_alerts()
  └─ WebSocket broadcast "telemetry" + "alert"
  │
  ▼
Mobile app cập nhật dashboard
```

### 4.1 Chống trùng (idempotency)

- Firmware sinh `message_id` một lần cho mỗi mẫu đọc và **giữ nguyên** khi gửi lại.
- Backend unique constraint `(device_id, message_id)`.
- Nếu firmware cũ không gửi `message_id`, backend tạo fingerprint SHA-256 từ
  `temperature|humidity|light|motion|timestamp`.
- Trường hợp MQTT và HTTP gửi đồng thời: `IntegrityError` được bắt, trả `duplicate=true`.

### 4.2 Thời gian

- Backend lưu tất cả dạng UTC naive trong DB.
- API trả chuỗi ISO-8601 có `Z`.
- Timestamp từ thiết bị bị lệch quá `MAX_CLOCK_SKEW_SECONDS` (mặc định 24 giờ) sẽ bị thay
  bằng giờ server.
- Thống kê ngày dùng `APP_TIMEZONE` (mặc định `Asia/Ho_Chi_Minh`).

## 5. Luồng lệnh điều khiển

```text
App ──POST /api/devices/{id}/commands──► Backend
                                           │ publish
                                           ▼
                         smartstudy/<device>/command
                                           │
                                           ▼
                                        ESP32
                                  set_led / set_buzzer
                                  set_alerts / set_thresholds / ping
```

- `delivered=false` nếu MQTT chưa kết nối; API vẫn trả 202 kèm `detail` để UI hiển thị.
- Khi người dùng đổi ngưỡng qua `PATCH /api/devices/{id}`, backend tự gửi
  `set_thresholds` xuống thiết bị.
- Cảnh báo môi trường có thể tự bật LED nếu `auto_control=true`.

## 6. WebSocket

- Endpoint: `GET /ws/devices/{device_id}?token=<access_token>`.
- Token được kiểm tra **trước khi** `accept()`.
- Kiểm tra `device.user_id == token.sub`, nếu không đóng với mã 4403.
- Khi kết nối, server gửi `snapshot` gồm trạng thái thiết bị và reading mới nhất.
- Sự kiện: `telemetry`, `alert`, `device_status`, `pong`.
- Client gửi chuỗi `ping` để giữ kết nối.

## 7. Quyết định thiết kế

| Quyết định | Lý do |
|---|---|
| FastAPI + SQLAlchemy async | Phù hợp I/O-bound, dễ test, tự sinh OpenAPI |
| JWT access + refresh | Không cần session server; refresh hạn chế việc đăng nhập lại |
| scrypt của stdlib | Tránh phụ thuộc native (bcrypt) khi cài trên Windows/Docker |
| Device key hash SHA-256 | Key dài, ngẫu nhiên; không cần chậm như mật khẩu người dùng |
| SQLite cho dev/test | Chạy nhanh, không cần Docker; production dùng PostgreSQL |
| MQTT là transport chính | Nhẹ, phù hợp ESP32; HTTP chỉ là fallback |
| Firebase FCM HTTP v1 | Push tới điện thoại; Supabase vẫn giữ tài khoản/database |
| Rule-based AI fallback | Demo và test không phụ thuộc mạng/API key |
| Server tính thời gian học | Chống gian lận và sai lệch đồng hồ |
| Một thiết bị / một người dùng | Đơn giản hoá quyền riêng tư và API |

## 8. Xử lý lỗi và độ bền

- MQTT listener tự reconnect; lỗi từng message chỉ log, không làm chết vòng lặp.
- Firmware giữ queue 20 mẫu trong RAM; khi đầy thì bỏ mẫu cũ nhất.
- Watchdog offline tạo thông báo `device_offline`.
- Push FCM là best-effort: notification luôn lưu DB, lỗi FCM không làm hỏng request.
- Cảnh báo có cooldown 10 phút để tránh spam.
- API dùng `HTTPException` với thông điệp tiếng Việt; lỗi validation trả 422 của FastAPI.
- Giới hạn kích thước/kiểu dữ liệu ở Pydantic (ví dụ lux 0–100000, nhiệt độ −40…80).

## 9. Những gì chưa có trong kiến trúc

- Chưa có message queue bền vững (Kafka/Redis Streams) — MQTT QoS 1 + DB là đủ cho demo.
- Chưa có Alembic; schema tạo bằng `create_all`.
- Chưa có horizontal scaling cho WebSocket (cần Redis pub/sub nếu chạy nhiều instance).
- Chưa có rate limiting và audit log.
- Push FCM cần development build + `google-services.json`; Expo Go không nhận remote push.

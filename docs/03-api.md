# 03 — API

Base URL: `http://localhost:8000`  
Tiền tố REST: `/api`  
Tài liệu tương tác: `/docs` (Swagger UI), `/redoc`.

## 1. Quy ước chung

- Request/response dùng JSON UTF-8.
- Thời gian trả về là ISO-8601 UTC, ví dụ `2026-11-01T03:20:00Z`.
- Các endpoint (trừ `/health`, `/api/auth/register`, `/api/auth/login`,
  `/api/auth/refresh`, `/api/iot/telemetry`) yêu cầu header:

  ```http
  Authorization: Bearer <access_token>
  ```

- Lỗi chuẩn của FastAPI:

  ```json
  { "detail": "Thông điệp lỗi" }
  ```

- Mã lỗi thường gặp:

  | Mã | Ý nghĩa |
  |---|---|
  | 400 | Dữ liệu không hợp lệ |
  | 401 | Thiếu/sai token, sai mật khẩu |
  | 403 | Không có quyền với tài nguyên |
  | 404 | Không tìm thấy hoặc không thuộc người dùng |
  | 409 | Trùng email / mã thiết bị / đang có phiên học |
  | 422 | Validation lỗi (Pydantic) |
  | 4401 / 4403 | WebSocket: chưa xác thực / không có quyền |

## 2. Health

### `GET /health`

Không cần xác thực.

```json
{
  "status": "ok",
  "environment": "development",
  "mqtt_connected": true,
  "auth_provider": "supabase",
  "ai_enabled": true,
  "ai_provider": "groq",
  "timezone": "Asia/Ho_Chi_Minh"
}
```

## 3. Xác thực

Khi `AUTH_PROVIDER=supabase`, backend chuyển register/login/refresh sang Supabase Auth.
Access token do Supabase cấp được xác thực bằng JWKS (ES256); client vẫn dùng cùng các
endpoint dưới đây. Với `AUTH_PROVIDER=local` (test/offline), backend tự cấp JWT như trước.

### `POST /api/auth/register`

```json
{
  "email": "sinhvien@example.com",
  "name": "Nguyễn Văn A",
  "password": "matkhau123"
}
```

Ràng buộc: email hợp lệ, tên 1–120 ký tự, mật khẩu 8–128 ký tự.

Phản hồi `201`:

```json
{
  "user": {
    "id": "uuid",
    "email": "sinhvien@example.com",
    "name": "Nguyễn Văn A",
    "role": "student",
    "created_at": "2026-11-01T03:00:00Z"
  },
  "requires_email_confirmation": false,
  "tokens": {
    "access_token": "eyJ...",
    "refresh_token": "eyJ...",
    "token_type": "bearer",
    "expires_in": 3600
  }
}
```

Nếu Supabase bật **Confirm email**, tài khoản được tạo nhưng chưa có phiên:

```json
{
  "user": { "id": "uuid", "email": "sinhvien@example.com", "name": "Nguyễn Văn A", "role": "student" },
  "requires_email_confirmation": true,
  "tokens": null
}
```

Lúc này app phải thông báo kiểm tra hộp thư; đăng nhập trước khi xác nhận trả `403`.

### `POST /api/auth/login`

```json
{ "email": "sinhvien@example.com", "password": "matkhau123" }
```

Trả về cùng cấu trúc `AuthResponse`. Sai thông tin → `401`.

### `POST /api/auth/refresh`

```json
{ "refresh_token": "eyJ..." }
```

Trả về `TokenPair` mới. Refresh token hết hạn/không hợp lệ → `401`.

### `GET /api/auth/me`

Trả về `UserOut` của người dùng hiện tại.

### Quản trị (chỉ `role=admin`)

| Method | Đường dẫn | Mô tả |
|---|---|---|
| GET | `/api/admin/overview` | Tổng số user/admin/thiết bị/phiên/reading + 10 user mới nhất |
| PATCH | `/api/admin/users/{user_id}/role` | Đổi vai trò `student` ↔ `admin` |

```json
{ "role": "admin" }
```

User thường gọi các endpoint này nhận `403`. Admin không thể tự thu hồi quyền của mình (`400`).

## 4. Thiết bị

### `POST /api/devices/register`

```json
{ "device_code": "STUDY_DESK_001", "name": "Bàn học" }
```

- `device_code`: 3–64 ký tự, chỉ `A-Z a-z 0-9 _ -`, được chuẩn hoá thành chữ hoa.
- Trùng mã → `409`.

Phản hồi `201` (device key **chỉ hiện một lần**):

```json
{
  "id": "uuid",
  "device_code": "STUDY_DESK_001",
  "name": "Bàn học",
  "status": "offline",
  "last_seen_at": null,
  "settings": {
    "temperature_min": 18.0,
    "temperature_max": 30.0,
    "humidity_min": 30.0,
    "humidity_max": 70.0,
    "light_min_lux": 150.0,
    "no_motion_minutes": 15,
    "collection_enabled": true,
    "auto_control": true,
    "sample_interval_seconds": 10
  },
  "created_at": "2026-11-01T03:00:00Z",
  "device_key": "sk_...",
  "mqtt_username": "STUDY_DESK_001",
  "mqtt_topics": {
    "telemetry": "smartstudy/STUDY_DESK_001/telemetry",
    "command": "smartstudy/STUDY_DESK_001/command",
    "status": "smartstudy/STUDY_DESK_001/status"
  }
}
```

> Giá trị trên dùng prefix mặc định `smartstudy`. Nếu đặt `MQTT_TOPIC_PREFIX` khác
> (bản demo: `smartstudy_demo_2f7c91`), API trả topic theo prefix đó — firmware và
> backend phải cấu hình giống nhau.

> MQTT hiện dùng `device_code` làm username khi broker bật ACL. Mật khẩu MQTT cần cấu hình
> riêng ở broker; `device_key` dùng cho HTTP fallback.

### `GET /api/devices`

Danh sách thiết bị của người dùng, sắp xếp theo `created_at`.

### `GET /api/devices/{device_id}/status`

```json
{
  "id": "uuid",
  "device_code": "STUDY_DESK_001",
  "status": "online",
  "online": true,
  "last_seen_at": "2026-11-01T03:20:00Z",
  "seconds_since_last_seen": 4,
  "sample_interval_seconds": 10,
  "collection_enabled": true
}
```

`online` được tính lại theo `DEVICE_OFFLINE_AFTER_SECONDS`, không chỉ dựa vào cột `status`.

### `PATCH /api/devices/{device_id}`

Cập nhật tên và/hoặc ngưỡng. `settings` là **partial merge**.

```json
{
  "name": "Bàn học phòng ngủ",
  "settings": {
    "light_min_lux": 200,
    "temperature_max": 29,
    "collection_enabled": false
  }
}
```

Nếu MQTT đang kết nối, backend gửi `set_thresholds` xuống thiết bị.

### `DELETE /api/devices/{device_id}`

Xoá thiết bị và toàn bộ reading/session liên quan (cascade). Trả `204`.

### `GET /api/devices/{device_id}/readings`

Query:

| Tham số | Mặc định | Ghi chú |
|---|---|---|
| `from` | — | ISO-8601, lọc `recorded_at >= from` |
| `to` | — | ISO-8601, lọc `recorded_at <= to` |
| `limit` | 100 | 1–500 |
| `offset` | 0 | ≥ 0 |

```json
{
  "items": [
    {
      "id": "uuid",
      "device_id": "uuid",
      "message_id": "a1b2c3",
      "temperature": 27.4,
      "humidity": 61.0,
      "light_raw": 1820,
      "light_lux": 156.2,
      "motion_detected": true,
      "recorded_at": "2026-11-01T03:19:50Z",
      "received_at": "2026-11-01T03:19:51Z"
    }
  ],
  "total": 120,
  "limit": 100,
  "offset": 0
}
```

### `GET /api/devices/{device_id}/readings/latest`

Trả về reading mới nhất hoặc `null`.

### `POST /api/devices/{device_id}/commands`

```json
{ "action": "set_led", "value": true }
```

`action`:

| Action | `value` | Ý nghĩa |
|---|---|---|
| `set_led` | bool | Bật/tắt LED |
| `set_buzzer` | bool | Bật/tắt buzzer |
| `set_alerts` | bool | Bật/tắt cảnh báo tại thiết bị |
| `set_thresholds` | object | Cập nhật ngưỡng (merge) |
| `ping` | null | Kiểm tra thiết bị còn sống |

Phản hồi `202`:

```json
{
  "delivered": true,
  "topic": "smartstudy/STUDY_DESK_001/command",
  "payload": { "action": "set_led", "value": true },
  "detail": null
}
```

Nếu MQTT chưa kết nối: `delivered=false`, `detail` giải thích lệnh chưa gửi.

## 5. Telemetry HTTP fallback

### `POST /api/iot/telemetry`

Header:

```http
X-Device-Code: STUDY_DESK_001
X-Device-Key: sk_...
```

Body:

```json
{
  "device_id": "STUDY_DESK_001",
  "message_id": "8f3c2a1b",
  "temperature": 27.5,
  "humidity": 62.0,
  "light": 1820,
  "light_lux": 156.2,
  "motion_detected": true,
  "timestamp": "2026-11-01T03:20:00Z"
}
```

- `light` là ADC thô 0–4095.
- `light_lux` tuỳ chọn; nếu bỏ trống backend tự ước lượng từ `light`.
- `timestamp` tuỳ chọn; nếu lệch quá 24 giờ sẽ dùng giờ server.
- `device_id` trong body không bắt buộc và không dùng để xác thực.

Phản hồi `202`:

```json
{
  "stored": true,
  "duplicate": false,
  "collection_enabled": true,
  "reading": { "...": "..." },
  "alerts": [
    {
      "type": "light_low",
      "title": "Ánh sáng bàn học chưa đủ",
      "content": "Cường độ sáng khoảng 42 lux, thấp hơn ngưỡng 150 lux..."
    }
  ]
}
```

Nếu bản ghi trùng: `stored=false`, `duplicate=true`, `reading` là bản ghi đã có.  
Nếu người dùng tắt thu thập: `stored=false`, `collection_enabled=false`.

## 6. Phiên học

### `POST /api/study-sessions/start`

```json
{ "plan_id": null, "planned_minutes": 25 }
```

- Nếu đang có phiên `running`/`paused` → `409`.
- Nếu có `plan_id`, plan phải thuộc người dùng và được chuyển `in_progress`.

Phản hồi `201`:

```json
{
  "id": "uuid",
  "plan_id": null,
  "started_at": "2026-11-01T03:20:00Z",
  "ended_at": null,
  "planned_minutes": 25,
  "status": "running",
  "duration_seconds": 0,
  "created_at": "2026-11-01T03:20:00Z"
}
```

### `GET /api/study-sessions/active`

Trả về phiên đang chạy/tạm dừng hoặc `null`.

### `GET /api/study-sessions`

Query: `limit` (mặc định 20, tối đa 100).

### `POST /api/study-sessions/{session_id}/pause`

Chỉ phiên `running`. Cộng dồn thời gian và đặt `status=paused`.

### `POST /api/study-sessions/{session_id}/resume`

Chỉ phiên `paused`. Đặt `last_resumed_at=now`, `status=running`.

### `POST /api/study-sessions/{session_id}/finish?cancelled=false`

Không có body. Kết thúc phiên, cộng thời gian còn lại, đặt `ended_at`, `status=completed`
(hoặc `cancelled`). Nếu phiên gắn với plan và plan chưa hoàn thành, plan được đánh dấu `completed`.

### `POST /api/study-sessions/finish`

Alias tương thích với tài liệu gốc, nhận `session_id` trong body:

```json
{ "session_id": "uuid", "cancelled": false }
```

### `GET /api/study/stats`

```json
{
  "today_focused_seconds": 3000,
  "today_sessions": 2,
  "week_focused_seconds": 12600,
  "week_sessions": 7,
  "total_focused_seconds": 54000,
  "completed_sessions": 12,
  "plans_total": 5,
  "plans_completed": 3,
  "goal_completion_rate": 41.7,
  "daily_goal_minutes": 120,
  "daily": [
    { "date": "2026-10-26", "focused_seconds": 1800, "sessions": 1 }
  ],
  "timezone": "Asia/Ho_Chi_Minh"
}
```

### `GET /api/study/goal` — `PUT /api/study/goal`

```json
{ "daily_minutes": 120 }
```

`daily_minutes`: 5–1440.

## 7. Kế hoạch học

| Method | Đường dẫn | Mô tả |
|---|---|---|
| GET | `/api/study-plans?status=pending` | Danh sách, lọc theo trạng thái |
| POST | `/api/study-plans` | Tạo kế hoạch |
| PATCH | `/api/study-plans/{id}` | Cập nhật một phần |
| DELETE | `/api/study-plans/{id}` | Xoá |

Tạo kế hoạch:

```json
{
  "title": "Ôn tập React Native",
  "description": "Navigation và state management",
  "scheduled_start": "2026-11-02T09:00:00Z",
  "planned_minutes": 50
}
```

`status`: `pending | in_progress | completed | cancelled`. Khi chuyển `completed`,
`completed_at` được đặt tự động.

## 8. Thông báo

| Method | Đường dẫn | Mô tả |
|---|---|---|
| GET | `/api/notifications?unread_only=false&limit=30` | Danh sách mới nhất |
| POST | `/api/notifications/{id}/read` | Đánh dấu đã đọc |
| POST | `/api/notifications/read-all` | Đánh dấu tất cả |

Loại thông báo: `temperature_high`, `temperature_low`, `humidity_high`, `humidity_low`,
`light_low`, `no_motion`, `device_offline`.

## 9. Trợ lý AI

### `POST /api/assistant/chat`

```json
{
  "message": "Tôi nên cải thiện góc học tập thế nào?",
  "conversation_id": null
}
```

```json
{
  "conversation_id": "uuid",
  "answer": "Chào Minh Anh! ...",
  "suggestions": [
    "Ánh sáng khoảng 98 lux, dưới ngưỡng 150 lux — hãy bật đèn bàn."
  ],
  "source": "groq",
  "model": "openai/gpt-oss-120b",
  "created_at": "2026-11-01T03:25:00Z"
}
```

- `source=groq` là mặc định; `source=gemini` khi Groq lỗi và có Gemini key;
  `source=rule_based` khi thiếu cả hai key hoặc cả hai provider lỗi.
- Backend tự dựng context từ dữ liệu cảm biến, thống kê học tập và kế hoạch.

### `GET /api/assistant/context`

Trả về snapshot ngắn để hiển thị "chip" ngữ cảnh trong app:

```json
{
  "latest_temperature": 27.5,
  "latest_humidity": 62.0,
  "latest_light_lux": 156.2,
  "device_online": true,
  "today_focused_seconds": 3000,
  "suggestions": ["..."]
}
```

### `GET /api/assistant/history?limit=20`

Danh sách hội thoại gần nhất (tối đa 100).

## 10. WebSocket

```text
ws://localhost:8000/ws/devices/{device_id}?token=<access_token>
```

Yêu cầu `device_id` thuộc người dùng của token.
`token` có thể là JWT local hoặc access token Supabase.

Server gửi ngay:

```json
{
  "event": "snapshot",
  "device_id": "uuid",
  "data": {
    "status": "online",
    "last_seen_at": "2026-11-01T03:20:00Z",
    "latest_reading": { "...": "..." }
  }
}
```

Các sự kiện tiếp theo:

```json
{ "event": "telemetry", "device_id": "uuid", "source": "mqtt", "data": {}, "alerts": [] }
{ "event": "alert", "device_id": "uuid", "data": { "type": "light_low" } }
{ "event": "device_status", "device_id": "uuid", "data": { "status": "offline" } }
{ "event": "pong" }
```

Client gửi `ping` (text) để nhận `pong`.

## 11. Ví dụ nhanh bằng curl

```bash
# Đăng nhập
curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@smartstudy.vn","password":"demo12345"}'

# Lấy token rồi gọi API
TOKEN="<access_token>"
curl -s http://localhost:8000/api/devices -H "Authorization: Bearer $TOKEN"

# Gửi telemetry HTTP
curl -s -X POST http://localhost:8000/api/iot/telemetry \
  -H "Content-Type: application/json" \
  -H "X-Device-Code: STUDY_DESK_001" \
  -H "X-Device-Key: sk_demo_study_desk_key_001" \
  -d '{"message_id":"test-1","temperature":27.5,"humidity":62,"light":1820,"motion_detected":true}'
```

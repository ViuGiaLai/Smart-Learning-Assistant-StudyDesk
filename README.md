# Smart Learning Assistant

Trợ lý học tập thông minh gồm **ứng dụng di động React Native**, **backend FastAPI**,
**Supabase PostgreSQL + Supabase Auth**, **MQTT + WebSocket** và **firmware ESP32** đọc cảm biến
môi trường bàn học (nhiệt độ, độ ẩm, ánh sáng, chuyển động).

> Đây là bản triển khai mới, độc lập với thư mục `Smart-Study-Assistant` sẵn có.
> Toàn bộ mã nguồn nằm trong `D:\all_my_project\smart-learning-assistant`.

---

## 1. Tính năng

| Nhóm | Chức năng |
|---|---|
| Tài khoản | Đăng ký / đăng nhập qua **Supabase Auth**, xác nhận email, access token ES256 xác thực bằng JWKS; refresh token; lưu token bằng SecureStore |
| Phân quyền | Vai trò `student` / `admin`; mỗi người chỉ thấy kế hoạch, lịch sử học và thiết bị của mình; `/api/admin/*` yêu cầu admin |
| Học tập | Phiên Pomodoro, tạm dừng / tiếp tục, thời gian do **server** tính, thống kê 7 ngày, mục tiêu ngày, kế hoạch học |
| Thiết bị | Đăng ký ESP32, sinh device key (chỉ hiện một lần), đổi ngưỡng, bật/tắt thu thập dữ liệu, gửi lệnh LED / buzzer / ping |
| IoT | Nhận telemetry qua MQTT (chính) hoặc HTTP (dự phòng), chống trùng bằng `message_id`, tự đánh dấu offline, LWT |
| Môi trường | Nhiệt độ, độ ẩm, lux ước lượng từ LDR, chuyển động; cảnh báo có cooldown; tự bật LED khi vượt ngưỡng |
| Realtime | WebSocket có xác thực JWT và kiểm tra quyền sở hữu thiết bị |
| AI | **Groq** (chính) + Gemini dự phòng + gợi ý theo luật; API key chỉ nằm ở server |
| Firmware | ESP32 + DHT22 + PIR + LDR + LED + buzzer, queue gửi lại khi mất mạng, cấu hình Wokwi kèm theo |

---

## 2. Kiến trúc

```text
┌──────────────────────┐        HTTPS / WSS        ┌─────────────────────────┐
│  React Native (Expo) │ ────────────────────────► │  FastAPI                │
│  Paper + Zustand     │ ◄──────────────────────── │  REST + WebSocket       │
└──────────────────────┘                           │                         │
                                                   │  SQLAlchemy 2 async     │
┌──────────────────────┐        MQTT 1883          │  Groq REST (httpx)      │
│  ESP32 / Wokwi       │ ────────────────────────► │                         │
│  DHT22 PIR LDR       │ ◄──────────────────────── │                         │
└──────────────────────┘   telemetry/command/status└───────────┬─────────────┘
                                                               │
                                                    ┌──────────▼──────────┐
                                                    │ Supabase PostgreSQL │
                                                    │ Mosquitto (MQTT)    │
                                                    └─────────────────────┘
```

Luồng dữ liệu:

1. ESP32 đọc cảm biến mỗi 10 giây và publish JSON lên
   `smartstudy_demo_2f7c91/<DEVICE_CODE>/telemetry`.
2. Backend subscribe `smartstudy_demo_2f7c91/+/telemetry`, kiểm tra `message_id` để chống trùng,
   lưu reading, đánh giá ngưỡng và phát sự kiện WebSocket cho ứng dụng.
3. Ứng dụng có thể gửi lệnh qua REST; backend publish xuống
   `smartstudy_demo_2f7c91/<DEVICE_CODE>/command`.
4. Firmware publish trạng thái lên `smartstudy_demo_2f7c91/<DEVICE_CODE>/status` (retained + LWT).

---

## 3. Cấu trúc thư mục

```text
smart-learning-assistant/
├── backend/                 FastAPI, SQLAlchemy, Supabase Auth, MQTT, Groq, test
│   ├── app/
│   │   ├── api/             auth, admin, devices, iot, study, notifications, assistant, ws
│   │   ├── core/            config, security, time
│   │   ├── db/              models, session
│   │   ├── schemas/         Pydantic request/response
│   │   └── services/        iot, mqtt, sensors, alerts, stats, ai, realtime, supabase_auth
│   ├── scripts/seed_demo.py
│   ├── tests/               25 test pytest
│   └── Dockerfile
├── mobile/                  Expo + React Native + TypeScript
│   └── src/                 api, components, hooks, navigation, screens, store
├── firmware/                Arduino sketch + PlatformIO
│   ├── smart_desk/          smart_desk.ino, config.h
│   ├── diagram.json
│   └── platformio.ini
├── wokwi/                   Bản sẵn sàng dán vào wokwi.com
│   ├── sketch.ino
│   ├── config.h
│   ├── diagram.json
│   └── libraries.txt
├── tools/simulate_device.py Giả lập telemetry MQTT/HTTP
├── tools/serve_wokwi.py     Phục vụ thư mục wokwi/ qua HTTP (CORS)
├── mosquitto/mosquitto.conf
├── docker-compose.yml
├── supabase/migrations/     SQL bật RLS và chặn truy cập trực tiếp bằng publishable key
└── docs/                    Kiến trúc, phần cứng, API, Wokwi, demo, đánh giá tài liệu
```

---

## 4. Yêu cầu môi trường

- **Không bắt buộc Docker.** Có hai cách chạy:
  - Nhanh, đơn giản: Python 3.11–3.12 + SQLite + broker MQTT công khai (xem mục 6).
  - Đầy đủ: Docker Desktop (PostgreSQL + Mosquitto + backend) như mục 5.
- **Node.js 20+** và npm cho ứng dụng di động / bản web.
- Điện thoại cài **Expo Go** (cùng mạng LAN với máy tính) hoặc Android Studio / Xcode.
- PlatformIO (nếu muốn biên dịch firmware thật) và tài khoản Wokwi (nếu muốn lưu dự án mô phỏng).

---

## 5. Chạy bằng Docker Compose (tùy chọn)

```powershell
cd D:\all_my_project\smart-learning-assistant

# Tùy chọn: đặt JWT_SECRET và GEMINI_API_KEY trong file .env ở thư mục gốc
# JWT_SECRET=...
# GEMINI_API_KEY=...

docker compose up --build
```

Sau khi khởi động:

- API: <http://localhost:8000>
- Swagger UI: <http://localhost:8000/docs>
- Health check: <http://localhost:8000/health>
- PostgreSQL: `localhost:5432` (user/password/db: `smartstudy`)
- MQTT: `localhost:1883`

Tạo dữ liệu demo:

```powershell
docker compose exec backend python -m scripts.seed_demo
```

Tài khoản demo: **demo@smartstudy.vn / demo12345**
Thiết bị: `STUDY_DESK_001` (key `sk_demo_study_desk_key_001`, chỉ cần cho HTTP fallback).

> `docker-compose.yml` dùng MQTT ẩn danh cho mục đích demo. Xem
> `mosquitto/mosquitto.conf` và `docs/07-bao-mat-va-rieng-tu.md` trước khi triển khai thật.

---

## 6. Chạy backend trực tiếp (SQLite, không cần Docker)

```powershell
cd D:\all_my_project\smart-learning-assistant\backend

python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt

copy .env.example .env
# Sửa .env theo cấu hình demo đang chạy:
#   DATABASE_URL=sqlite+aiosqlite:///./smartstudy.db
#   MQTT_ENABLED=true
#   MQTT_HOST=broker.emqx.io
#   MQTT_PORT=1883
#   MQTT_USE_TLS=false
#   MQTT_TOPIC_PREFIX=smartstudy_demo_2f7c91

python -m scripts.seed_demo
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

- `broker.emqx.io:1883` là broker công khai, dùng cho demo khi máy chưa cài Mosquitto.
  Đây là broker **công khai** — hãy đổi `MQTT_TOPIC_PREFIX` cho riêng bạn và không gửi dữ liệu thật.
- Nếu mạng chặn `test.mosquitto.org:1883`, dùng `broker.emqx.io:1883` hoặc
  `broker.hivemq.com:1883`. Wokwi cũng phải dùng cùng broker và cùng prefix.
- **Windows:** backend dùng `paho-mqtt` chạy thread riêng thay vì `aiomqtt`, vì event loop
  Proactor mặc định của Windows không hỗ trợ `loop.add_reader()`. Không cần WSL.
- Kiểm tra: <http://localhost:8000/health> phải trả `"mqtt_connected": true`.
- Nếu cổng 8000 đã bị ứng dụng khác chiếm, chạy `--port 8010` và đặt
  `EXPO_PUBLIC_API_URL=http://localhost:8010` trước khi khởi động Expo.

Nếu dùng PostgreSQL cục bộ, đổi `DATABASE_URL` thành:

```text
postgresql+asyncpg://smartstudy:smartstudy@localhost:5432/smartstudy
```

Bảng được tạo tự động khi khởi động (`init_db`). Với dự án thật nên thay bằng Alembic.

---

## 7. Chạy ứng dụng di động / bản web

```powershell
cd D:\all_my_project\smart-learning-assistant\mobile
npm install

# mobile/.env đã trỏ sẵn backend demo: EXPO_PUBLIC_API_URL=http://localhost:8010
# Điện thoại thật: sửa thành IP LAN của máy tính, ví dụ http://192.168.1.10:8010

npx expo start          # Expo Go / emulator
npx expo start --web    # mở bản web tại http://localhost:8081
```

- Nếu không có `mobile/.env`, app tự lấy host từ Metro (`Constants.expoConfig.hostUri`),
  phù hợp khi chạy Expo Go trên cùng mạng LAN.
- Điện thoại thật **không dùng được** `localhost`; hãy dùng IP LAN của máy tính.
- Android emulator dùng `http://10.0.2.2:8010`.
- Nếu backend chạy ở cổng khác (ví dụ 8000):
  `$env:EXPO_PUBLIC_API_URL='http://localhost:8000'; npx expo start --web`.
- Kiểm tra kiểu: `npm run typecheck`.

---

## 8. Firmware ESP32 và Wokwi

### 8.1 Mô phỏng trên Wokwi

**Link dự án đã lưu (Public):**
<https://wokwi.com/projects/479557511287602177>
— mở link, bấm **Play** là chạy, không cần dựng lại.

Thư mục `wokwi/` đã có sẵn bốn file để dán trực tiếp:

| File | Nội dung |
|---|---|
| `wokwi/sketch.ino` | Toàn bộ firmware (giống `firmware/smart_desk/smart_desk.ino`) |
| `wokwi/config.h` | Wi-Fi `Wokwi-GUEST`, broker `broker.emqx.io`, prefix demo, `LDR_INVERTED 1` |
| `wokwi/diagram.json` | Sơ đồ chân ESP32 + DHT22 + PIR + LDR + LED + buzzer |
| `wokwi/libraries.txt` | `DHT sensor library`, `PubSubClient`, `ArduinoJson` |

Các bước:

1. Mở <https://wokwi.com/projects/new/esp32> (đăng nhập nếu muốn **SAVE** dự án).
2. Dán `wokwi/sketch.ino` vào tab `sketch.ino`.
3. Tạo file `config.h` mới và dán `wokwi/config.h`.
4. Dán `wokwi/diagram.json` vào tab `diagram.json`.
5. Mở **Library Manager** → thêm `DHT sensor library`, `PubSubClient`, `ArduinoJson`.
6. Bấm **Start the simulation**, mở Serial Monitor. Log đúng sẽ giống:

```text
[wifi] connected, ip=10.10.0.2
[mqtt] connected
[sensor] t=24.0C h=40.0% light=1001 (~540 lux) motion=0
```

7. Mở app → thiết bị `STUDY_DESK_001` chuyển **Online**, nhiệt độ/độ ẩm/lux cập nhật.
8. Kéo thanh sáng của LDR xuống thấp để thấy cảnh báo ánh sáng yếu và LED bật.

Lưu ý:

- Wokwi chỉ vào được broker qua Internet, nên dùng `broker.emqx.io` (hoặc broker public khác),
  **không dùng `localhost`**.
- Module LDR của Wokwi ngược chiều với module KY-018 thông thường: AO **giảm** khi sáng.
  Vì vậy `wokwi/config.h` đặt `LDR_INVERTED 1`; firmware thật để `0`.
  Nếu module thật của bạn cũng ngược chiều, đổi thành `1`.
- Firmware gửi kèm `light_lux` đã tính, nên app hiển thị đúng cả hai loại module.
- Nếu Wokwi báo hàng đợi build, bấm **CANCEL** rồi chạy lại sau; bản miễn phí dùng chung build server.

Chi tiết từng bước và xử lý lỗi: `docs/04-wokwi.md`.

### 8.2 Biên dịch bằng PlatformIO

```powershell
cd D:\all_my_project\smart-learning-assistant\firmware
pio run
```

### 8.3 Phần cứng thật

Chỉ cần **mua linh kiện, sửa `config.h`, nạp code** — không phải viết lại gì:

1. Mua: ESP32 DevKit V1, DHT22, PIR HC-SR501, module LDR (AO), LED + trở 220 Ω,
   buzzer active, dây jumper, breadboard.
2. Sửa `firmware/smart_desk/config.h`:
   - `WIFI_SSID` / `WIFI_PASSWORD` của nhà bạn;
   - `MQTT_HOST` = IP máy chạy backend trong LAN (hoặc broker public);
   - `TOPIC_PREFIX` trùng với `MQTT_TOPIC_PREFIX` trong `backend/.env`;
   - `DEVICE_CODE` trùng mã thiết bị trong app;
   - `LDR_INVERTED` = `0` với KY-018; đổi `1` nếu đọc ngược.
3. Nạp: `pio run -t upload` (hoặc mở `firmware/smart_desk/smart_desk.ino` bằng Arduino IDE).
4. Đấu dây theo bảng dưới và `docs/02-phan-cung.md`.

| Linh kiện | Chân ESP32 | Ghi chú |
|---|---|---|
| DHT22 | GPIO4 | Nguồn 3.3 V, trở kéo 10 kΩ |
| PIR HC-SR501 | GPIO27 | Cấp 5 V (VIN), logic 3.3 V ở ngõ OUT |
| LDR module | GPIO34 | Dùng chân `AO`, **không phải lux đã hiệu chuẩn** |
| LED | GPIO2 | Qua trở 220 Ω; GPIO2 là chân strapping |
| Buzzer active | GPIO25 | Active buzzer; dùng `tone()` nếu là passive |

---

## 9. Giả lập thiết bị không cần phần cứng

```powershell
cd D:\all_my_project\smart-learning-assistant

# MQTT tới broker công khai, cùng prefix với backend
python tools\simulate_device.py --device-code STUDY_DESK_001 `
  --host broker.emqx.io --prefix smartstudy_demo_2f7c91 --scenario normal

# Kịch bản khác: low_light | hot
python tools\simulate_device.py --device-code STUDY_DESK_001 `
  --host broker.emqx.io --prefix smartstudy_demo_2f7c91 --scenario low_light

# HTTP fallback
python tools\simulate_device.py --http http://localhost:8000 `
  --device-code STUDY_DESK_001 --device-key sk_demo_study_desk_key_001
```

> Chỉ chạy **một** nguồn telemetry cho mỗi `DEVICE_CODE` tại một thời điểm
> (Wokwi **hoặc** simulator), nếu không dữ liệu sẽ xen kẽ nhau.

---

## 10. Kiểm thử và chất lượng mã

```powershell
cd D:\all_my_project\smart-learning-assistant\backend
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check app tests scripts

cd ..\mobile
npx tsc --noEmit
```

Bộ test backend dùng SQLite tạm và tắt MQTT, bao phủ: đăng ký/đăng nhập/refresh,
quyền sở hữu thiết bị, telemetry trùng, ngưỡng cảnh báo, phiên học, thống kê,
trợ lý AI fallback và WebSocket.

### Kết quả kiểm chứng trong môi trường tạo dự án

| Hạng mục | Kết quả |
|---|---|
| `pytest` | 25 passed |
| Supabase thật (auth + DB) | Đăng nhập Supabase, tạo kế hoạch / thiết bị / phiên học, refresh token: OK |
| Groq thật | `source=groq`, model `openai/gpt-oss-120b`, trả lời 1.301 ký tự |
| RLS Supabase | PostgREST với publishable key trả `401 permission denied` |
| `ruff check` | All checks passed |
| `tsc --noEmit` | Không lỗi |
| `expo export --platform android` | Bundle thành công (1254 modules) |
| `pio run` | Thành công, RAM 15.3% (49.988 B), Flash 81.1% (1.063.436 B) |
| Wokwi web + backend + app | Chạy thật: Online, 24 °C, 40 %, ~540 lux, nhận lệnh `set_led` |
| `docker compose config` | Hợp lệ (chưa build image vì Docker daemon không chạy) |

---

## 11. Cấu hình quan trọng

| Biến | Ý nghĩa |
|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://...` hoặc `sqlite+aiosqlite:///...` |
| `AUTH_PROVIDER` | `local` (mặc định) hoặc `supabase` |
| `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` | Dùng khi `AUTH_PROVIDER=supabase`; **chỉ ở backend** |
| `SUPABASE_JWT_SECRET` | Chỉ project cũ ký access token bằng HS256; project mới dùng JWKS ES256 |
| `JWT_SECRET` | Bắt buộc đổi khi triển khai; dùng chuỗi ngẫu nhiên ≥ 32 byte |
| `MQTT_HOST` / `MQTT_PORT` | Địa chỉ broker; backend và firmware phải trỏ cùng broker |
| `MQTT_USE_TLS` | Bật TLS (thường cổng 8883) |
| `DEVICE_OFFLINE_AFTER_SECONDS` | Mặc định 90 giây |
| `ALERT_COOLDOWN_SECONDS` | Chống spam cảnh báo, mặc định 600 giây |
| `GROQ_API_KEY` / `GROQ_MODEL` | **Chỉ đặt ở backend**, không đưa vào app di động; mặc định `openai/gpt-oss-120b` |
| `AI_PROVIDER` | `auto` (Groq → Gemini → rule-based), `groq` hoặc `gemini` |
| `GEMINI_API_KEY` | Dự phòng khi Groq lỗi hoặc `AI_PROVIDER=gemini` |
| `APP_TIMEZONE` | Mặc định `Asia/Ho_Chi_Minh`, dùng cho thống kê theo ngày |

Xem đầy đủ trong `backend/.env.example`.

---

## 12. Kịch bản demo 5 phút

1. Chạy `docker compose up --build`, sau đó seed dữ liệu demo.
2. Mở app, đăng nhập `demo@smartstudy.vn / demo12345`.
3. Trang **Tổng quan** hiển thị thiết bị, thời gian học hôm nay, cảnh báo mới.
4. Chạy `tools/simulate_device.py --scenario low_light` → app nhận telemetry realtime,
   thẻ môi trường chuyển sang cảnh báo ánh sáng yếu.
5. Vào **Tập trung**, bắt đầu Pomodoro 25 phút; thử tạm dừng/tiếp tục.
6. Vào **Trợ lý**, hỏi “Tôi nên cải thiện góc học tập thế nào?”.
7. Vào **Thiết bị**, đổi ngưỡng ánh sáng, bật/tắt thu thập dữ liệu, gửi lệnh LED.
8. Kết thúc phiên và xem **Thống kê**.

Chi tiết: `docs/05-demo.md`.

---

## 13. Những điểm đã sửa so với tài liệu gốc

Tài liệu tham chiếu có một số chỗ chưa chính xác hoặc thiếu. Bản này đã xử lý:

- LDR trả về ADC thô, **không phải lux**; backend quy đổi gần đúng và ghi rõ giới hạn.
- Bổ sung `message_id` + unique constraint để chống trùng khi firmware gửi lại.
- Thời gian phiên học do server quyết định, không tin đồng hồ ESP32/điện thoại.
- WebSocket yêu cầu JWT và kiểm tra thiết bị thuộc người dùng.
- Thêm watchdog offline, MQTT LWT, cooldown cảnh báo.
- Thêm phân trang lịch sử reading, thống kê theo timezone.
- Gemini key chỉ nằm ở server; AI có fallback khi thiếu key.
- Làm rõ bo mạch Wokwi là **ESP32 DevKit C V4**, không phải DOIT DevKit V1.
- Sửa mâu thuẫn ngân sách và bổ sung cáp USB.

Phân tích đầy đủ: `docs/06-danh-gia-tai-lieu.md`.

---

## 14. Giới hạn hiện tại

- Chưa có Alembic; bảng tạo bằng `create_all` + vá cột tương thích khi khởi động; RLS nằm trong `supabase/migrations/`.
- Push FCM đã có ở backend/mobile nhưng cần **development build** + `mobile/google-services.json`;
  Expo Go không nhận remote push.
- Đã có hai vai trò `student` / `admin`; chưa có rate limiting và audit log cho hành động quản trị.
- MQTT demo dùng broker công khai / ẩn danh; production cần TLS + ACL theo thiết bị.
- LDR chỉ cho biết xu hướng sáng/tối, không dùng để đo lux chính xác.
- Chưa có CI/CD, chưa có EAS build profile.
- Firmware đã có luồng LAB3; chưa biên dịch lại trong môi trường hiện tại vì thiếu PlatformIO/arduino-cli.
- Supabase mặc định bật xác nhận email; project chưa cấu hình SMTP riêng nên dùng email thật và có thể bị giới hạn tần suất gửi.
- Supabase free tier có thể tạm dừng project khi không hoạt động; khi đó API trả lỗi kết nối cho tới khi mở lại dashboard.

---

## 15. Tài liệu

| File | Nội dung |
|---|---|
| `docs/01-kien-truc.md` | Kiến trúc, luồng dữ liệu, quyết định thiết kế |
| `docs/02-phan-cung.md` | Sơ đồ chân, điện áp, lưu ý phần cứng |
| `docs/03-api.md` | Danh sách endpoint, payload, mã lỗi |
| `docs/04-wokwi.md` | Chạy mô phỏng, biên dịch firmware |
| `docs/05-demo.md` | Kịch bản demo và kiểm thử |
| `docs/06-danh-gia-tai-lieu.md` | Đánh giá tài liệu gốc và các sửa đổi |
| `docs/07-bao-mat-va-rieng-tu.md` | Bảo mật, quyền riêng tư, khuyến nghị triển khai |

---

## 16. Supabase Auth + PostgreSQL và Groq

### 16.1 Cấu hình

`backend/.env` (đã gitignore) đang trỏ tới project Supabase và Groq. Các biến chính:

| Biến | Ghi chú |
|---|---|
| `DATABASE_URL` | Session pooler của Supabase, cổng `5432`, có `ssl=require` tự động |
| `AUTH_PROVIDER=supabase` | Bật xác thực qua Supabase Auth |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | Publishable key, chỉ dùng phía server |
| `GROQ_API_KEY` | Groq key, chỉ dùng phía server |
| `GROQ_MODEL` | `openai/gpt-oss-120b` |

**Vì sao dùng pooler?** Host `db.<project-ref>.supabase.co` chỉ có bản ghi IPv6. Máy/mạng chỉ IPv4
sẽ không phân giải được; dùng **Session pooler** `aws-0-<region>.pooler.supabase.com:5432` với
user `postgres.<project-ref>`. Mật khẩu có ký tự đặc biệt phải URL-encode (ví dụ `@` → `%40`).

### 16.2 Luồng đăng nhập

1. App gọi `POST /api/auth/register`; backend gọi Supabase GoTrue signup.
2. Project đang bật **Confirm email**: response là `201` với `tokens: null` và
   `requires_email_confirmation: true`. App hiển thị thông báo kiểm tra hộp thư.
3. Người dùng bấm liên kết xác nhận, sau đó đăng nhập. Backend gọi GoTrue, nhận cặp
   access/refresh token và đồng bộ profile vào bảng `public.users`.
4. Mọi request API dùng access token Supabase. Backend xác thực chữ ký ES256 qua JWKS,
   kiểm tra `iss`/`aud`, rồi ánh xạ `sub` sang user nội bộ.
5. Refresh token được GoTrue xoay vòng qua `POST /api/auth/refresh`.

Lưu ý:

- Supabase từ chối domain dành riêng như `example.com` (`email_address_invalid`); hãy dùng email thật.
- Muốn bỏ bước xác nhận khi demo: Dashboard → **Authentication → Sign In / Providers → Email**,
  tắt **Confirm email**. Production nên giữ bật và cấu hình SMTP + URL Configuration.
- Đổi Site URL / Redirect URLs trong Supabase cho khớp địa chỉ web/app của bạn.

### 16.3 Phân quyền và RLS

- Mọi bảng nghiệp vụ đều có `user_id`; backend kiểm tra quyền sở hữu ở từng endpoint.
- `users.role` mặc định `student`. Endpoint `/api/admin/overview` và
  `/api/admin/users/{id}/role` chỉ cho `admin`.
- Nâng quyền thủ công (SQL Editor của Supabase):

  ```sql
  update public.users set role = 'admin' where email = 'ban@example.com';
  ```

- `supabase/migrations/20261102000000_restrict_public_access.sql` bật RLS và thu hồi quyền của
  `anon`/`authenticated` trên toàn bộ bảng ứng dụng. Backend kết nối bằng role `postgres` nên
  vẫn hoạt động; publishable key không đọc được dữ liệu qua PostgREST (đã kiểm chứng `401`).
- Nếu sau này muốn dùng `supabase-js` trực tiếp, thay các lệnh `revoke` bằng policy
  `user_id = auth.uid()::text` thay vì mở lại toàn bộ quyền.

### 16.4 Groq

- Backend chọn provider theo `AI_PROVIDER=auto`: Groq trước, Gemini nếu Groq lỗi, cuối cùng là rule-based.
- Key chỉ nằm trong `backend/.env` / biến môi trường server, không bao giờ gửi xuống mobile.
- Kiểm tra nhanh:

  ```powershell
  curl.exe -s http://localhost:8010/health
  # {"ai_provider":"groq","auth_provider":"supabase",...}
  ```

### 16.5 Đã kiểm chứng với project thật

- Đăng nhập Supabase → `/api/auth/me` trả đúng email và role.
- Tạo thiết bị, kế hoạch, phiên học; thống kê và lịch sử hội thoại ghi vào Supabase.
- Chat thật qua Groq (`openai/gpt-oss-120b`), lưu hội thoại vào `ai_conversations`.
- `/api/admin/overview` trả `403` với `student`, `200` sau khi nâng `admin`.
- Refresh token Supabase trả access token mới; token sai trả `401`.

---

## 17. Ba LAB: FCM + IoT cảnh báo

### 17.1 Luồng tổng thể

```text
React Native ──(FCM token)──> FastAPI ──(HTTP v1)──> Firebase FCM ──> điện thoại
ESP32/Wokwi ──(HTTP POST + device key)──> FastAPI ──> Supabase + FCM
```

Supabase vẫn quản lý tài khoản/PostgreSQL; Firebase **chỉ** dùng FCM. Service account
chỉ nằm trên server, không có trong mobile.

### 17.2 LAB2 — FastAPI gửi Push Notification

Biến môi trường server (`backend/.env`):

```env
FIREBASE_CREDENTIALS_FILE=./secrets/firebase-service-account.json
FIREBASE_PROJECT_ID=my-website-cinema
```

`FIREBASE_CREDENTIALS_FILE` để trống sẽ tắt push; thông báo vẫn được lưu DB. Backend dùng
FCM HTTP v1 trực tiếp (PyJWT RS256 + httpx), không dùng `firebase-admin`. Token FCM được
upsert trong bảng `device_tokens`; token bị FCM báo invalid sẽ tự xoá.

| Method | Endpoint | Quyền |
|---|---|---|
| POST | `/api/notifications/register-device` | user — đăng ký token |
| DELETE | `/api/notifications/register-device` | user — huỷ token |
| POST | `/api/notifications/send` | user — gửi cho chính mình |
| POST | `/api/notifications/send-to-user` | admin |
| GET | `/api/notifications` | user — lịch sử |

Push là best-effort: lỗi FCM không làm hỏng request tạo thông báo. Ngoài API thủ công,
backend tự push khi có cảnh báo telemetry, thiết bị offline, hoàn thành phiên học và
nhắc kế hoạch học sắp bắt đầu (watchdog mỗi 60 giây).

### 17.3 LAB1 — React Native nhận thông báo

```bash
cd mobile
# Tải google-services.json cho package com.smartstudy.assistant từ Firebase Console,
# đặt tại mobile/google-services.json (đã gitignore).
npx expo run:android        # development build, KHÔNG dùng Expo Go cho remote push
```

- App xin quyền, tạo channel Android `study-alerts`, lấy native FCM token và gửi lên
  `/api/notifications/register-device` sau khi đăng nhập.
- Chạm vào thông báo mở màn hình **Thông báo**; đăng xuất sẽ huỷ token khỏi server.
- Trong màn hình Thông báo có nút **Gửi thử**. Khi chưa có `google-services.json`,
  app vẫn chạy nhưng nút báo chưa lấy được FCM token.

### 17.4 LAB3 — ESP32/Wokwi gửi cảnh báo

Trong `firmware/smart_desk/config.h` (và bản Wokwi `wokwi/config.h`):

```c
#define ENABLE_HTTP_ALERTS 1
#define API_BASE_URL "https://<vps-hoac-tunnel>"
#define DEVICE_KEY "sk_..."        // key hiện một lần khi tạo thiết bị
#define HTTP_ALERT_COOLDOWN_MS 60000UL
```

Firmware đọc DHT22/LDR/PIR, tự phát hiện `HIGH_TEMPERATURE`, `LOW_TEMPERATURE`,
`HIGH_HUMIDITY`, `LOW_HUMIDITY`, `LOW_LIGHT`, `MOTION_DETECTED` rồi POST tới
`/api/iot/alerts` với header `X-Device-Code` / `X-Device-Key`. Backend lưu reading,
tạo notification, chống trùng theo cooldown và gửi FCM. `wokwi/sketch.ino` được đồng bộ
với firmware; Wokwi **không truy cập được localhost/IP LAN**, nên dùng VPS public hoặc
tunnel (cloudflared/ngrok) và dán URL vào `API_BASE_URL`.

### 17.5 Kiểm chứng

- `ruff` pass, `pytest` 31 pass; `npx tsc --noEmit` pass.
- FCM OAuth đã lấy được access token bằng service account; gửi token giả trả `400
  INVALID_ARGUMENT` — đúng nghĩa là project/API đã sẵn sàng, chỉ thiếu token thật.
- Supabase đã tạo `device_tokens`, cột `study_plans.reminder_sent_at`; RLS bật trên 8 bảng.
- Chưa thể gửi push tới điện thoại thật cho tới khi có `google-services.json` + dev build.
- Chưa biên dịch lại firmware trong môi trường này vì không có PlatformIO/arduino-cli;
  cần build trên Wokwi/PlatformIO trước khi nạp.

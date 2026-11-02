# 05 — Kịch bản demo và kiểm thử

## 1. Chuẩn bị

### 1.1 Backend + PostgreSQL + MQTT

```powershell
cd D:\all_my_project\smart-learning-assistant
docker compose up --build -d
docker compose ps
docker compose exec backend python -m scripts.seed_demo
```

Kiểm tra:

```powershell
curl http://localhost:8000/health
```

Kỳ vọng: `status=ok`, `mqtt_connected=true`.

### 1.2 Ứng dụng di động

```powershell
cd mobile
npm install
npx expo start
```

Mở Expo Go, quét QR. Đảm bảo điện thoại cùng Wi-Fi với máy tính.

Nếu app không kết nối được API, tạo `mobile/.env`:

```text
EXPO_PUBLIC_API_URL=http://<IP-LAN-cua-may>:8000
```

và khởi động lại Expo (`npx expo start -c`).

### 1.3 Dữ liệu demo

`seed_demo` tạo:

- Người dùng: `demo@smartstudy.vn / demo12345`
- Thiết bị: `STUDY_DESK_001`, tên "Bàn học"
- 60 reading trong 2 giờ gần nhất
- 2 phiên học, 2 kế hoạch, 1 thông báo ánh sáng yếu
- Device key: `sk_demo_study_desk_key_001`

## 2. Kịch bản demo 5–7 phút

### Bước 1 — Đăng nhập và tổng quan (1 phút)

1. Đăng nhập bằng tài khoản demo.
2. Trang **Tổng quan** hiển thị:
   - lời chào theo giờ;
   - thời gian học hôm nay / mục tiêu;
   - trạng thái thiết bị;
   - nhiệt độ, độ ẩm, ánh sáng, chuyển động;
   - thông báo chưa đọc.

**Điểm nhấn:** dữ liệu thống kê lấy từ server, không phải bộ đếm cục bộ.

### Bước 2 — Telemetry thời gian thực (1–2 phút)

Chạy giả lập ở terminal khác:

```powershell
cd D:\all_my_project\smart-learning-assistant
pip install -r tools\requirements.txt
python tools\simulate_device.py --device-code STUDY_DESK_001 --host localhost --scenario normal --interval 3
```

App cập nhật thẻ môi trường mà không cần kéo làm mới (WebSocket).

Sau đó chạy kịch bản ánh sáng yếu:

```powershell
python tools\simulate_device.py --device-code STUDY_DESK_001 --scenario low_light --interval 3
```

**Kỳ vọng:**

- `light_lux` giảm mạnh.
- Sau mẫu đầu tiên vượt ngưỡng, app nhận sự kiện `alert`.
- Thông báo "Ánh sáng bàn học chưa đủ" xuất hiện.
- LED trên thiết bị (nếu đang chạy Wokwi) được bật do `auto_control=true`.

> Cảnh báo có cooldown 10 phút, nên không spam mỗi 3 giây.

### Bước 3 — Chống trùng dữ liệu (30 giây)

```powershell
curl -X POST http://localhost:8000/api/iot/telemetry `
  -H "Content-Type: application/json" `
  -H "X-Device-Code: STUDY_DESK_001" `
  -H "X-Device-Key: sk_demo_study_desk_key_001" `
  -d '{\"message_id\":\"demo-dup-1\",\"temperature\":27.5,\"humidity\":62,\"light\":1820,\"motion_detected\":true}'
```

Gọi lệnh trên **hai lần**. Lần 1: `stored=true`. Lần 2: `stored=false`, `duplicate=true`.

### Bước 4 — Phiên học Pomodoro (1–2 phút)

1. Vào tab **Tập trung**.
2. Chọn 25 phút, nhấn bắt đầu.
3. Thử **Tạm dừng**, sau đó **Tiếp tục**.
4. Đóng app, mở lại → phiên vẫn còn (server lưu trạng thái).
5. Kết thúc phiên.
6. Vào **Thống kê** → thời gian hôm nay tăng; biểu đồ 7 ngày cập nhật.

**Điểm nhấn:** thời gian do server tính bằng `accumulated_seconds` +
`last_resumed_at`, không tin đồng hồ điện thoại.

### Bước 5 — Trợ lý AI (1 phút)

Vào tab **Trợ lý**, hỏi:

- "Tôi nên cải thiện góc học tập thế nào?"
- "Hôm nay tôi học được bao lâu?"
- "Cho tôi một kế hoạch học 2 giờ tối nay."

Nếu chưa cấu hình `GEMINI_API_KEY`, câu trả lời là rule-based nhưng vẫn dựa trên dữ liệu
thật (nhiệt độ, lux, thời gian học). Giao diện hiển thị nguồn `rule_based`.

### Bước 6 — Quản lý thiết bị (1 phút)

1. Vào **Thiết bị**.
2. Đổi ngưỡng ánh sáng từ 150 → 300 lux, lưu.
3. Gửi lệnh **Bật LED**, sau đó **Tắt LED**.
4. Tắt **Thu thập dữ liệu**.
5. Chạy lại simulator → API trả `collection_enabled=false`, không lưu reading mới.
6. Bật lại thu thập.

**Điểm nhấn:** quyền riêng tư do người dùng kiểm soát; mọi API kiểm tra thiết bị thuộc
người dùng.

### Bước 7 — Mất kết nối (tuỳ chọn, 2 phút)

1. Dừng simulator (Ctrl+C).
2. Chờ hơn 90 giây.
3. App nhận `device_status=offline`.
4. Trong **Thông báo** xuất hiện "Thiết bị mất kết nối".

## 3. Demo với Wokwi

Xem `docs/04-wokwi.md`. Tóm tắt:

1. `config.h`: dùng `MQTT_HOST` trùng backend.
2. Đăng ký `STUDY_DESK_001` trong app.
3. Chạy Wokwi.
4. Click PIR, kéo thanh sáng LDR, đổi nhiệt độ DHT22.
5. Gửi lệnh LED từ app → LED Wokwi sáng.

## 4. Kiểm thử tự động

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -q
```

Kỳ vọng: **22 passed**.

```powershell
.\.venv\Scripts\python.exe -m ruff check app tests scripts
```

Kỳ vọng: `All checks passed!`.

```powershell
cd ..\mobile
npx tsc --noEmit
```

Kỳ vọng: không có lỗi.

### Phạm vi test backend

| File | Nội dung |
|---|---|
| `test_auth.py` | Đăng ký, trùng email, đăng nhập sai/đúng, refresh, `/me` |
| `test_devices_iot.py` | Đăng ký thiết bị, key chỉ trả một lần, quyền sở hữu, telemetry, dedupe, ngưỡng, tắt thu thập, lệnh |
| `test_study.py` | Bắt đầu/pause/resume/finish, chặn 2 phiên, thống kê, mục tiêu, kế hoạch |
| `test_assistant.py` | Fallback rule-based, context, history |

## 5. Reset dữ liệu demo

```powershell
# Docker
docker compose exec backend python -m scripts.seed_demo --reset

# Local
cd backend
.\.venv\Scripts\python.exe -m scripts.seed_demo --reset
```

## 6. Câu hỏi thường gặp khi demo

**App báo "Không kết nối được máy chủ"**

- Điện thoại và máy tính phải cùng mạng LAN.
- Kiểm tra `EXPO_PUBLIC_API_URL`; không dùng `localhost` trên điện thoại.
- Windows Firewall có thể chặn cổng 8000; cho phép Python/uvicorn.

**WebSocket không nhận dữ liệu**

- Kiểm tra token còn hạn.
- Kiểm tra thiết bị thuộc đúng tài khoản.
- Xem log backend có lỗi 4401/4403 không.

**MQTT không kết nối**

- Chế độ Docker: `docker compose logs mosquitto`.
- Chế độ không Docker: kiểm tra broker trong `backend/.env`
  (`MQTT_HOST=broker.emqx.io`, `MQTT_PORT=1883`, `MQTT_TOPIC_PREFIX=smartstudy_demo_2f7c91`).
- `curl http://localhost:8010/health` → `mqtt_connected` phải là `true`.
- Mạng trường/nhà mạng có thể chặn `test.mosquitto.org:1883`; dùng `broker.emqx.io:1883`.
- Wokwi web không truy cập được `localhost`; firmware và backend phải cùng broker công khai.

**Thống kê lệch múi giờ**

- Đặt `APP_TIMEZONE=Asia/Ho_Chi_Minh` (mặc định).
- Trên Windows cần gói `tzdata` (đã có trong `requirements.txt`).

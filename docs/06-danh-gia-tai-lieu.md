# 06 — Đánh giá tài liệu gốc và các sửa đổi

Tài liệu thiết kế ban đầu mô tả đúng ý tưởng tổng thể nhưng có một số điểm **sai về kỹ thuật**,
**mâu thuẫn nội bộ** hoặc **thiếu sót** khiến sinh viên làm theo sẽ gặp lỗi. Dưới đây là
danh sách, mức độ và cách bản triển khai này xử lý.

## 1. Tổng hợp mức độ

| # | Vấn đề | Mức độ | Trạng thái |
|---|---|---|---|
| 1 | LDR trả ADC thô nhưng tài liệu gọi là lux | Cao | Đã sửa |
| 2 | Thiếu cơ chế chống trùng telemetry | Cao | Đã sửa |
| 3 | Tin đồng hồ ESP32/điện thoại | Cao | Đã sửa |
| 4 | Kết thúc phiên học mơ hồ | Cao | Đã sửa |
| 5 | WebSocket không xác thực/phân quyền | Cao | Đã sửa |
| 6 | Gemini key có nguy cơ lộ ở client | Cao | Đã sửa |
| 7 | MQTT chỉ nhắc “bảo mật” chung chung | Cao | Đã bổ sung tài liệu + cấu hình |
| 8 | Không có watchdog offline | Trung bình | Đã sửa |
| 9 | Không phân trang lịch sử reading | Trung bình | Đã sửa |
| 10 | Tên `light` / `motion` mơ hồ | Trung bình | Đã làm rõ |
| 11 | GPIO2 là LED onboard + strapping | Trung bình | Đã ghi chú |
| 12 | PIR cần 5 V và warm-up | Trung bình | Đã ghi chú |
| 13 | DHT22 đọc quá nhanh | Trung bình | Đã giới hạn 10 giây |
| 14 | Ngân sách mâu thuẫn, thiếu cáp USB | Trung bình | Đã lập bảng mới |
| 15 | Wokwi dùng sai tên board | Thấp | Đã sửa |
| 16 | Mâu thuẫn Paper/NativeWind, Zustand/Redux | Thấp | Đã chốt |
| 17 | Thiếu xử lý lỗi mạng/MQTT | Trung bình | Đã sửa |
| 18 | Thiếu ràng buộc dữ liệu | Trung bình | Đã sửa |

## 2. Chi tiết từng vấn đề

### 2.1 LDR: ADC thô không phải lux

**Tài liệu:** dùng LDR và ghi giá trị `light` như cường độ sáng (lux).

**Vấn đề:** ESP32 đọc ADC 12-bit (0–4095). Module LDR + điện trở cho điện áp thay đổi
theo ánh sáng, nhưng:

- quan hệ không tuyến tính;
- phụ thuộc điện trở, khoảng cách, hướng;
- ADC ESP32 không tuyến tính gần 0 V và 3.3 V;
- không có đơn vị vật lý nếu không hiệu chuẩn.

Gọi thẳng giá trị 0–4095 là “lux” là **sai đơn vị**.

**Đã xử lý:**

- Schema tách `light` (raw 0–4095) và `light_lux` (tuỳ chọn).
- Firmware tính `light_lux` ngay trên thiết bị và gửi kèm; backend dùng giá trị đó,
  chỉ ước lượng lại khi payload cũ không có.
- Công thức dùng chung: `lux = 1000 × (raw/4095)^2.2` (`services/sensors.py:estimate_lux`).
- Có cờ `LDR_INVERTED` cho module ngược chiều (Wokwi = `1`, KY-018 thật = `0`).
- Ghi rõ trong docs và UI là “ước lượng”, chỉ dùng cho ngưỡng cảnh báo.
- Khuyến nghị BH1750/VEML7700 nếu cần đo lux thật.

### 2.2 Thiếu idempotency cho telemetry

**Tài liệu:** publish telemetry định kỳ, không nói chuyện gửi lại khi mất mạng.

**Vấn đề:** MQTT QoS 1 và retry của firmware có thể gửi trùng. Nếu backend chỉ `INSERT`,
biểu đồ và thống kê sẽ bị nhân đôi.

**Đã xử lý:**

- Thêm `message_id` vào payload.
- Unique constraint `(device_id, message_id)`.
- Firmware giữ nguyên `message_id` khi đẩy lại từ queue.
- Backend bắt `IntegrityError` cho trường hợp MQTT và HTTP đua nhau.
- Nếu firmware cũ không gửi `message_id`, backend tạo fingerprint SHA-256.

### 2.3 Thời gian và lệch đồng hồ

**Tài liệu:** dùng `timestamp` do thiết bị gửi, có nơi dùng giờ điện thoại để tính phiên học.

**Vấn đề:**

- ESP32 chưa có NTP sẽ trả thời gian từ 1970.
- Người dùng có thể đổi giờ điện thoại để “tăng” thời gian học.
- Múi giờ Việt Nam (+07) dễ bị trừ nhầm khi lưu UTC.

**Đã xử lý:**

- Server là nguồn thời gian chính (`received_at`, `utcnow()`).
- Timestamp thiết bị bị **clamp** nếu lệch quá 24 giờ.
- Phiên học lưu `accumulated_seconds` + `last_resumed_at`; server tự tính.
- Thống kê ngày dùng `APP_TIMEZONE`, trả kèm `timezone` để client biết.
- API luôn trả ISO-8601 có `Z`.

### 2.4 Kết thúc phiên học mơ hồ

**Tài liệu:** có `POST /api/study-sessions/finish` nhưng không nói truyền `session_id`
ở đâu, và không nói pause/resume ảnh hưởng thời gian thế nào.

**Đã xử lý:**

- Endpoint chuẩn: `POST /api/study-sessions/{id}/finish?cancelled=false`.
- Giữ alias `POST /api/study-sessions/finish` với body `{session_id, cancelled}` để
  tương thích tài liệu.
- Chặn tạo phiên mới khi đang có phiên `running`/`paused`.
- Chỉ cho pause khi `running`, resume khi `paused`.
- Khi finish, cộng nốt thời gian, đặt `ended_at`, cập nhật plan liên quan.

### 2.5 WebSocket không có xác thực

**Tài liệu:** mở WebSocket `/ws/devices/{device_id}` để nhận dữ liệu realtime.

**Vấn đề:** nếu không kiểm tra token, bất kỳ ai biết `device_id` đều đọc được dữ liệu
cảm biến của người khác. `device_id` là UUID nhưng vẫn có thể bị lộ qua log/chia sẻ.

**Đã xử lý:**

- Yêu cầu `?token=<access_token>`.
- Giải mã và kiểm tra token **trước khi** `accept()`.
- Kiểm tra `device.user_id == token.sub`.
- Đóng với mã 4401 (chưa xác thực) / 4403 (không có quyền).
- Gửi snapshot sau khi đã xác thực.

### 2.6 Gemini API key ở client

**Tài liệu:** mô tả app gọi Gemini; nếu đặt key trong app di động/biến `EXPO_PUBLIC_*`
thì key nằm trong bundle và ai cũng trích xuất được.

**Đã xử lý:**

- App **không** gọi Gemini. App gọi `POST /api/assistant/chat`.
- Key chỉ đọc từ `GEMINI_API_KEY` phía server.
- Có fallback rule-based khi thiếu key hoặc Gemini lỗi, nên demo không bị chặn.
- System prompt giới hạn phạm vi, không chẩn đoán y tế, không bịa số liệu.

### 2.7 MQTT: bảo mật và vận hành

**Tài liệu:** chỉ ghi “dùng MQTT”, topic `smartstudy/{device}/...`, không nói broker,
xác thực, TLS, LWT, QoS.

**Đã xử lý:**

- `docker-compose.yml` + `mosquitto/mosquitto.conf` cho môi trường dev.
- Demo không cần Docker: dùng broker công khai `broker.emqx.io:1883` (vì
  `test.mosquitto.org` bị chặn ở một số mạng) + prefix riêng `smartstudy_demo_2f7c91`.
- Backend dùng QoS 1, subscribe `<prefix>/+/telemetry` và `<prefix>/+/status`,
  bỏ qua topic `status` của chính backend.
- Backend dùng `paho-mqtt` chạy thread riêng thay cho `aiomqtt`, vì event loop Proactor
  mặc định trên Windows không hỗ trợ `loop.add_reader()`.
- Có LWT cho backend và firmware.
- Docs nêu rõ: demo ẩn danh; production cần `password_file`, ACL theo `device_code`,
  TLS 8883.
- Cảnh báo không dùng broker công khai cho dữ liệu thật.

**Chưa làm:** chưa có script tạo password/ACL tự động, chưa có TLS trong compose.

### 2.8 Không có watchdog offline

**Vấn đề:** nếu ESP32 mất điện, cột `status` vẫn là `online` mãi.

**Đã xử lý:**

- `last_seen_at` cập nhật mỗi telemetry/status.
- Watchdog chạy mỗi 20 giây, đánh dấu offline sau 90 giây.
- Tạo notification `device_offline`.
- API `/status` tính `online` theo thời gian thực, không chỉ đọc cột.

### 2.9 Thiếu phân trang

**Vấn đề:** `/readings` trả toàn bộ lịch sử sẽ chậm và tốn bộ nhớ khi chạy lâu.

**Đã xử lý:**

- `limit` (1–500), `offset`, `from`, `to`.
- Trả `items`, `total`, `limit`, `offset`.
- Thông báo cũng giới hạn `limit` 1–100.

### 2.10 Tên trường `light` và `motion`

**Vấn đề:** tài liệu dùng `light` cho cả giá trị ADC và lux; `motion` cho cả trạng thái
hiện tại và “có người”.

**Đã xử lý:**

- `light` = ADC thô; `light_lux` = lux ước lượng.
- `motion_detected` = PIR phát hiện chuyển động tại mẫu đó.
- Cảnh báo “không thấy chuyển động” chỉ bật khi đang có phiên học, tránh báo nhầm.

### 2.11 GPIO2 và LED onboard

**Vấn đề:** nhiều board ESP32 DevKit có LED onboard nối GPIO2. Dùng GPIO2 cho LED ngoài
có thể:

- sáng cả hai LED;
- ảnh hưởng quá trình boot vì GPIO2 là strapping pin.

**Đã xử lý:** giữ GPIO2 theo tài liệu nhưng ghi rõ trong `docs/02-phan-cung.md`; khuyến nghị
dùng trở 220 Ω và cân nhắc GPIO khác nếu thiết kế PCB.

### 2.12 PIR HC-SR501: điện áp và warm-up

**Vấn đề:** HC-SR501 cần 5 V; nếu cấp 3.3 V có thể không ổn định. Sau khi cấp nguồn cần
30–60 giây để ổn định. Ngõ OUT thường 3.3 V nhưng cần kiểm tra.

**Đã xử lý:**

- Đấu `VCC` vào `VIN` (5 V).
- Firmware chờ `PIR_WARMUP_MS = 60000`.
- Docs cảnh báo kiểm tra mức logic và dùng chia áp nếu cần.

### 2.13 DHT22 đọc quá nhanh

**Vấn đề:** DHT22 cần ≥ 2 giây giữa hai lần đọc; đọc liên tục trả `NaN` hoặc sai.

**Đã xử lý:**

- Chu kỳ mặc định 10 giây.
- `sample_interval_seconds` tối thiểu 2 trong schema.
- Firmware bỏ qua mẫu lỗi và thử lại chu kỳ sau.

### 2.14 Ngân sách mâu thuẫn và thiếu cáp USB

**Vấn đề:** tài liệu ghi hai khoảng khác nhau (294–334k và 300–350k) và không tính cáp USB.

**Đã xử lý:** bảng BOM trong `docs/02-phan-cung.md` tính đủ linh kiện + cáp USB, khoảng
**224.000–356.000 VNĐ** (chưa vỏ), kèm ghi chú giá tham khảo.

### 2.15 Board Wokwi

**Vấn đề:** tài liệu gọi “ESP32 DOIT DevKit V1” nhưng Wokwi dùng part
`board-esp32-devkit-c-v4`.

**Đã xử lý:** `diagram.json` dùng đúng `board-esp32-devkit-c-v4`; docs phân biệt board
mô phỏng và board thật. Chân GPIO tương đương nên firmware dùng được cả hai.

**Đã kiểm chứng thực tế:** project Wokwi web chạy được với `wokwi/` (3 thư viện:
`DHT sensor library`, `PubSubClient`, `ArduinoJson`), serial in
`[wifi] connected, ip=10.10.0.2`, `[mqtt] connected`,
`[sensor] t=24.0C h=40.0% light=1001 (~540 lux) motion=0`; backend nhận
`light_raw=1001`, `light_lux=539.7`, app hiện **Online / 24.0 °C / 40 % / 540 lux**.

Đã lưu **Public**: <https://wokwi.com/projects/479557511287602177>.

Hai đặc điểm của Wokwi cần biết:

- Bản miễn phí **xếp hàng build** (có lúc `#65`), mất vài phút; không refresh trang.
- **SAVE cần đăng nhập**; chế độ **Unlisted** chỉ có ở gói trả phí. Không có tài khoản
  vẫn chạy được trong phiên hiện tại; mã nằm trong `wokwi/` để dán lại.

### 2.16 Mâu thuẫn UI stack

**Vấn đề:** tài liệu nhắc cả React Native Paper và NativeWind; cả Zustand và Redux.

**Đã chốt:**

- **React Native Paper 5** cho component (không dùng NativeWind).
- **Zustand 5** cho state (không dùng Redux).
- React Navigation 7 (bottom tabs + native stack).

Lý do: ít dependency, phù hợp đồ án, dễ đọc.

### 2.17 Thiếu xử lý lỗi mạng và MQTT

**Đã xử lý:**

- Backend: MQTT tự reconnect sau 5 giây; lỗi từng message không làm chết listener.
- Firmware: queue 20 mẫu, gửi lại khi có mạng.
- App: timeout 15 giây, refresh token, hiển thị trạng thái lỗi từng màn hình.
- API trả `delivered=false` khi MQTT chưa sẵn sàng thay vì báo thành công giả.

### 2.18 Thiếu ràng buộc dữ liệu

**Đã xử lý:**

- Nhiệt độ −40…80 °C, độ ẩm 0–100 %, lux 0–100000, ADC 0–4095.
- `device_code` chỉ chữ/số/gạch, 3–64 ký tự.
- Mật khẩu 8–128 ký tự.
- Ngưỡng có kiểm tra khoảng hợp lệ.
- `planned_minutes` 1–240; mục tiêu ngày 5–1440.

### 2.19 Lỗi chỉ lộ ra khi chạy thật

Ba lỗi dưới đây không thấy khi chỉ đọc code, chỉ phát hiện khi chạy Wokwi + app + backend
cùng lúc và đã được sửa:

| Lỗi | Biểu hiện | Cách sửa |
|---|---|---|
| Backend tách topic sai | `Telemetry from unknown device <code>` với mọi gói tin, app không có dữ liệu | Topic chỉ có 3 phần (`prefix/device/kind`) nhưng code tách 4; sửa để cắt prefix trước, còn 2 phần |
| LDR ngược chiều trên Wokwi | Phòng sáng 500 lux nhưng app hiện **0 lux**, tự bật LED và báo “ánh sáng yếu” | Thêm `LDR_INVERTED`, đặt `1` cho Wokwi; firmware gửi `light_lux` đã tính |
| Simulator chết khi broker rớt | `RuntimeError: Message publish failed: The client is not currently connected` | Bắt lỗi publish, chờ paho tự reconnect; `--once` không đánh dấu offline ngay |

## 3. Những điểm tài liệu làm đúng

Không phải mọi thứ đều sai. Các quyết định sau được giữ nguyên:

- Kiến trúc tách mobile / backend / firmware là hợp lý.
- Dùng MQTT cho ESP32 là lựa chọn phù hợp (nhẹ, pub/sub, QoS).
- Bộ cảm biến DHT22 + PIR + LDR đủ cho một đồ án chi phí thấp.
- Topic `smartstudy/{device}/telemetry|command|status` rõ ràng, dễ mở rộng.
- Ý tưởng Pomodoro + thống kê + trợ lý AI có giá trị sư phạm.
- Dùng PostgreSQL cho dữ liệu quan hệ là đúng.
- Wokwi giúp demo không cần phần cứng.

## 4. Những gì chưa sửa (và vì sao)

| Hạn chế | Lý do |
|---|---|
| Chưa có Alembic | Ưu tiên bản chạy được; `create_all` đủ cho demo |
| Chưa có push notification | Cần cấu hình FCM/APNs, nằm ngoài phạm vi đồ án |
| Chưa có rate limiting | Cần Redis hoặc middleware; ghi nhận là hạn chế |
| Chưa có TLS/ACL MQTT tự động | Phụ thuộc môi trường triển khai; đã có hướng dẫn |
| Chưa chạy thử trên phần cứng thật | Đã chạy Wokwi + backend + app thật; phần cứng chỉ cần mua linh kiện, sửa `config.h`, nạp code |
| Chưa có EAS build | Cần tài khoản Expo; app chạy được qua Expo Go |
| Chưa có CI/CD | Ngoài phạm vi; có lệnh test/lint thủ công |

## 5. Kết luận

Bản triển khai giữ **linh hồn** của tài liệu (bộ cảm biến, MQTT, Pomodoro, AI, Wokwi)
nhưng sửa các lỗi khiến hệ thống **không chạy đúng hoặc không an toàn**:

- dữ liệu không bị nhân đôi;
- thời gian học đáng tin;
- dữ liệu của người khác không đọc được;
- API key không bị lộ;
- thiết bị mất kết nối được phát hiện;
- tài liệu phần cứng khớp với firmware và Wokwi.

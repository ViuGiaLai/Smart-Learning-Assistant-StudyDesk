# 04 — Wokwi và firmware ESP32

## 1. Cấu trúc firmware

```text
firmware/
├── smart_desk/
│   ├── smart_desk.ino   Chương trình chính (dùng cho phần cứng thật)
│   └── config.h         Wi-Fi, MQTT, mã thiết bị, chân GPIO, LDR_INVERTED
├── diagram.json         Sơ đồ Wokwi
├── platformio.ini       Cấu hình PlatformIO
├── wokwi.toml           Cấu hình Wokwi cho VS Code
└── libraries.txt        Danh sách thư viện

wokwi/                   Bản sẵn sàng dán vào wokwi.com
├── sketch.ino           Giống firmware/smart_desk/smart_desk.ino
├── config.h             Bản Wokwi: LDR_INVERTED 1
├── diagram.json         Sơ đồ có sẵn lux = 500
└── libraries.txt        3 thư viện cần thêm

tools/serve_wokwi.py     Phục vụ wokwi/ qua HTTP (CORS) khi cần nạp nhanh
```

`wokwi/` và `firmware/smart_desk/` chỉ khác nhau ở `config.h` (một dòng `LDR_INVERTED`).
Khi sửa firmware, chép lại `wokwi/sketch.ino` để hai bản luôn khớp.

## 2. Chạy trên Wokwi (web)

**Dự án đã lưu (Public):** <https://wokwi.com/projects/479557511287602177>
— mở link và bấm **Play**. Phần dưới là cách tạo lại từ đầu nếu cần.

### 2.1 Tạo project

1. Mở <https://wokwi.com/projects/new/esp32>.
2. Tab `sketch.ino`: dán toàn bộ `wokwi/sketch.ino`
   (file chính **phải** tên `sketch.ino`, không phải `smart_desk.ino`).
3. Menu ▾ cạnh tên tab → **New file...** → đặt tên `config.h` → dán `wokwi/config.h`.
4. Tab `diagram.json`: dán `wokwi/diagram.json`.
5. **Library Manager** → nút **+** → thêm đúng 3 thư viện:
   `DHT sensor library`, `PubSubClient`, `ArduinoJson`.

   Wokwi tự thêm `Adafruit Unified Sensor` (dependency của DHT) và tự sinh
   `libraries.txt`. Không cần thêm tay.

> Nếu dán code vào tab sai (ví dụ tạo `smart_desk.ino`), Wokwi báo
> `config.h: No such file` hoặc không tìm thấy `setup()`. Xoá file sai và làm lại bước 2.

### 2.2 Cấu hình trong `wokwi/config.h`

```cpp
#define WIFI_SSID "Wokwi-GUEST"
#define WIFI_PASSWORD ""

#define MQTT_HOST "broker.emqx.io"
#define MQTT_PORT 1883
#define TOPIC_PREFIX "smartstudy_demo_2f7c91"
#define DEVICE_CODE "STUDY_DESK_001"

#define LDR_INVERTED 1   // module LDR của Wokwi ngược chiều
```

Backend phải trỏ **cùng broker** và **cùng prefix** (`backend/.env`):

```env
MQTT_ENABLED=true
MQTT_HOST=broker.emqx.io
MQTT_PORT=1883
MQTT_USE_TLS=false
MQTT_TOPIC_PREFIX=smartstudy_demo_2f7c91
```

### 2.3 Vì sao dùng `broker.emqx.io`

- Wokwi web chạy trên cloud nên **không truy cập được** `localhost` hay IP LAN của bạn.
- `test.mosquitto.org:1883` bị chặn ở một số nhà mạng / mạng trường (đã gặp khi làm dự án).
- `broker.emqx.io:1883` mở, không cần tài khoản, phù hợp demo.
- Đây là broker **công khai**: ai cũng đọc/ghi được cùng topic. Vì vậy dự án dùng
  prefix riêng `smartstudy_demo_2f7c91` (chuỗi ngẫu nhiên) để tránh đụng người khác,
  và **không gửi dữ liệu thật/nhạy cảm**.

Muốn dùng broker riêng: chạy Mosquitto trên VPS có IP công khai, hoặc
**Wokwi for VS Code** (mô phỏng cục bộ) rồi trỏ `MQTT_HOST` về IP LAN.

### 2.4 Chạy mô phỏng

- Nhấn **Play** (▶). Bản miễn phí thường phải **xếp hàng build** (`#65 in the build queue`),
  có thể mất 1–5 phút. Đừng tải lại trang, cứ để nguyên.
- Mở **Serial Monitor** (bảng dưới sơ đồ), tốc độ 115200.
- Log đã kiểm chứng thực tế:

  ```text
  rst:0x1 (POWERON_RESET),boot:0x13 (SPI_FAST_FLASH_BOOT)
  [wifi] connecting to Wokwi-GUEST.......
  [wifi] connected, ip=10.10.0.2
  [mqtt] connected
  [sensor] t=24.0C h=40.0% light=1001 (~540 lux) motion=0
  [sensor] t=24.0C h=40.0% light=1001 (~540 lux) motion=0
  ```

- `light=1001` là ADC thô, `~540 lux` là giá trị firmware tự tính và gửi kèm.
- Gửi lệnh từ app sẽ thấy: `[mqtt] command=set_led value=1` và LED đỏ sáng.

Tương tác trong Wokwi:

| Linh kiện | Cách tương tác |
|---|---|
| DHT22 | Click để đổi nhiệt độ/độ ẩm |
| PIR | Click để bật/tắt chuyển động |
| LDR | Kéo thanh sáng (slider) bên cạnh module |
| LED | Chỉ quan sát |

### 2.5 Lưu project trên Wokwi

- Dự án của đồ án đã lưu **Public** tại <https://wokwi.com/projects/479557511287602177>.
- Nút **SAVE** hiện hộp thoại yêu cầu **đăng nhập** (Google / GitHub / Email) rồi mới lưu được;
  Wokwi không còn cho lưu project ẩn danh.
- Chế độ **Unlisted** (không công khai) chỉ dành cho gói trả phí; bản miễn phí chỉ lưu **Public**.
- Không cần lưu vẫn demo được: mã nguồn đầy đủ nằm trong `wokwi/`, dán lại mất ~1 phút.
- Vì project là Public, **không để Wi-Fi/mật khẩu thật trong `config.h`**
  (bản Wokwi chỉ dùng `Wokwi-GUEST` nên an toàn).

## 3. Hành vi firmware

### 3.1 Chu kỳ đọc

- Mặc định 10 giây (`SAMPLE_INTERVAL_MS`).
- DHT22 cần tối thiểu 2 giây giữa hai lần đọc; không giảm dưới ngưỡng này.
- PIR chờ 60 giây warm-up trước khi báo chuyển động.

### 3.2 Queue khi mất mạng

- Giữ tối đa 20 mẫu trong RAM.
- Khi đầy, bỏ mẫu cũ nhất.
- Khi gửi lại, **giữ nguyên `message_id`** để backend dedupe.
- Queue mất khi reset board — đây là giới hạn có chủ ý của bản demo.

### 3.3 Lệnh nhận từ backend

Topic `smartstudy_demo_2f7c91/<DEVICE_CODE>/command`:

```json
{ "action": "set_led", "value": true }
{ "action": "set_buzzer", "value": false }
{ "action": "set_alerts", "value": true }
{ "action": "set_thresholds", "value": { "temperature_max": 29 } }
{ "action": "ping" }
```

Firmware áp dụng ngay và publish trạng thái mới lên topic `status`.

### 3.4 Trạng thái và LWT

- Khi kết nối: publish `{"status":"online"}` retained lên `<prefix>/<device>/status`.
- Cấu hình LWT: nếu mất kết nối đột ngột, broker tự publish `offline`.
- Backend cũng có watchdog: quá 90 giây không có telemetry → `offline`.

### 3.5 Đồng bộ thời gian

- Dùng NTP (`pool.ntp.org`).
- Nếu chưa đồng bộ, `timestamp` để trống; backend dùng giờ server.
- Backend bỏ qua timestamp lệch quá 24 giờ.

### 3.6 Quy đổi lux và chiều LDR

Firmware và backend dùng **cùng một công thức**:

```text
ratio = raw / 4095
lux   = 1000 × ratio^2.2
```

Module LDR khác nhau có thể **ngược chiều**:

| Loại | Điện áp AO khi sáng | `LDR_INVERTED` |
|---|---|---|
| KY-018 / LM393 thông thường | tăng | `0` |
| `wokwi-photoresistor-sensor` | **giảm** | `1` |

Nếu để sai cờ này, phòng sáng 500 lux sẽ bị báo “tối” và LED tự bật. Firmware tính
`light_lux` **trên thiết bị** rồi gửi kèm, nên backend/app chỉ việc dùng giá trị đó —
không phụ thuộc chiều của module.

## 4. Biên dịch bằng PlatformIO

```powershell
cd D:\all_my_project\smart-learning-assistant\firmware
pio run
```

Nạp firmware:

```powershell
pio run --target upload
pio device monitor
```

Nếu chưa cài PlatformIO:

```powershell
pip install platformio
# hoặc: python -m pip install --user platformio
```

### Trạng thái kiểm chứng

Firmware **đã biên dịch thành công** bằng PlatformIO (platform `espressif32`,
Arduino core 3.3.12) sau khi thêm `light_lux` và `LDR_INVERTED`:

```text
RAM:   15.3% (49.988 / 327.680 bytes)
Flash: 81.1% (1.063.436 / 1.310.720 bytes)
SUCCESS (51.86 s)
```

Lưu ý:

- Flash dùng 81.1%; nếu bật thêm tính năng, cân nhắc bảng partition lớn hơn.
- Wokwi dùng toolchain riêng, không liên quan `pio run`; cả hai đã build thành công.
- Lỗi thường gặp:

| Lỗi | Cách xử lý |
|---|---|
| `DHT.h: No such file` | Cài `DHT sensor library` (+ `Adafruit Unified Sensor` tự kéo theo) |
| `ArduinoJson.h: No such file` | Cài `ArduinoJson` 7.x |
| `PubSubClient.h: No such file` | Cài `PubSubClient` |
| `tone()` không xác định | Thêm `#include <Arduino.h>` (đã có) hoặc kiểm tra board |
| Tràn bộ nhớ | Giảm `QUEUE_SIZE`, tắt HTTP fallback |

## 5. Kiểm thử firmware

### 5.1 Không có phần cứng (đã chạy thật)

1. Backend chạy với `MQTT_HOST=broker.emqx.io`, prefix `smartstudy_demo_2f7c91`.
2. Đăng ký thiết bị `STUDY_DESK_001` trong app.
3. Chạy Wokwi, chờ build xong.
4. Sau ≤ 10 giây, app hiện **Online**, 24.0 °C, 40 %, 540 lux.
5. Gửi lệnh `set_led` từ app → Serial in `[mqtt] command=set_led value=1`, LED sáng.
6. Click PIR → `motion_detected=true`.
7. Kéo LDR xuống ~0 → cảnh báo ánh sáng yếu + LED bật.

> Chỉ chạy **một** nguồn telemetry cho mỗi `DEVICE_CODE`: Wokwi **hoặc**
> `tools/simulate_device.py`, không chạy cả hai (dữ liệu sẽ xen kẽ).

### 5.2 Có phần cứng

1. Nạp firmware qua USB.
2. Mở Serial Monitor, kiểm tra Wi-Fi/MQTT.
3. Che LDR → app cảnh báo ánh sáng yếu.
4. Vẫy tay trước PIR → `motion_detected=true`.
5. Rút nguồn PIR → sau 90 giây app báo thiết bị offline (nếu không còn telemetry).
6. Gửi lệnh `ping` từ app.

## 6. Xử lý sự cố

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| `WiFi connect failed` | Sai SSID/mật khẩu, Wokwi không có `Wokwi-GUEST` | Wokwi web chỉ hỗ trợ `Wokwi-GUEST` |
| `MQTT connect failed rc=-2` | Sai host/port, broker chặn | Kiểm tra `MQTT_HOST`; thử `broker.emqx.io` |
| Serial đứng ở `Waiting in queue...` | Hàng đợi build miễn phí | Chờ, hoặc CANCEL rồi chạy lại; không refresh |
| App không thấy dữ liệu | Chưa đăng ký `device_code`, sai prefix | Prefix firmware = `MQTT_TOPIC_PREFIX` backend |
| App thấy `540 lux` nhưng vẫn cảnh báo tối | Cảnh báo cũ còn trong thông báo | Đánh dấu đã đọc; reading mới đã đúng |
| App báo “ánh sáng 0 lux” khi phòng sáng | `LDR_INVERTED` sai chiều | Wokwi: `1`; KY-018 thật: `0` |
| DHT trả `nan` | Thiếu trở kéo, đọc quá nhanh | Thêm 10 kΩ, giữ chu kỳ ≥ 2 giây |
| PIR luôn `true` | Chưa warm-up, chỉnh quá nhạy | Chờ 60 giây, giảm `Sx` |
| LDR luôn 0/4095 | Nối nhầm `DO`, chân sai | Dùng `AO` → GPIO34 |
| Thời gian sai | Chưa có NTP | Bỏ trống timestamp, để backend xử lý |
| Lệnh không tới | Backend chưa kết nối MQTT | Kiểm tra `/health` → `mqtt_connected` |
| Log backend `Telemetry from unknown device backend` | Bản cũ hiểu nhầm topic 3 phần | Đã sửa trong `app/services/mqtt.py`; khởi động lại backend |

## 7. Ghi chú an toàn

- Không commit `config.h` chứa Wi-Fi/mật khẩu thật. Dùng `config.example.h` hoặc biến môi trường.
- Không dùng `broker.emqx.io` / `test.mosquitto.org` cho dữ liệu thật.
- Với triển khai thật: bật TLS (8883), tạo user/mật khẩu riêng cho từng thiết bị, ACL chỉ cho
  phép `smartstudy/<DEVICE_CODE>/#`.
- Device key trong firmware chỉ cần khi bật HTTP fallback; nếu dùng, hãy nạp qua USB và
  không chia sẻ file.

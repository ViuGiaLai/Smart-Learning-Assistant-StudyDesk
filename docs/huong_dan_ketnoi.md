# Hướng dẫn nối linh kiện — Smart Learning Assistant

Bàn học thông minh dùng ESP32 DevKit V1 + 4 linh kiện. Toàn bộ đi dây qua breadboard
(hoặc nối thẳng nếu hàn), giữ đúng các chân GPIO dưới đây thì **không phải sửa firmware**.

Tệp sơ đồ mô phỏng: `wokwi/diagram.json` — dự án Wokwi:
<https://wokwi.com/projects/479557511287602177>

---

## 1. Bảng nối nhanh (linh kiện → ESP32)

| Linh kiện | Chân linh kiện | Chân ESP32 | Ghi chú |
|---|---|---|---|
| DHT22 (nhiệt độ, độ ẩm) | VCC | 3V3 | Module thường đã có trở kéo |
| | DATA | GPIO4 | Thêm trở 10 kΩ lên 3V3 nếu dùng cảm biến rời |
| | GND | GND | |
| PIR HC-SR501 (chuyển động) | VCC | **5V (VIN)** | Cần 5 V mới ổn định, không dùng 3V3 |
| | OUT | GPIO27 | Sau khi cấp điện chờ ~60 giây |
| | GND | GND | |
| Module LDR (ánh sáng) | VCC | 3V3 | |
| | AO | GPIO34 | ADC1 — dùng được khi bật Wi-Fi |
| | GND | GND | |
| LED đỏ | Anode (+) | GPIO2 **qua trở 220 Ω** | Không nối trực tiếp, sẽ cháy LED |
| | Cathode (−) | GND | Chân dài là anode |
| Buzzer active 5 V | + | GPIO25 | Điều khiển bằng PWM 2 kHz |
| | − | GND | |

Nếu lắp trên breadboard, dùng thêm bảng hàng bên dưới cho gọn.

---

## 2. Nối theo hàng breadboard (bản Wokwi đang dùng)

Mỗi hàng a–e là **một điểm nối**: cắm chân linh kiện ở cột `b`, cắm dây từ ESP32 ở cột `e`
cùng hàng là thông mạch.

| Hàng | Cắm linh kiện | Dây đi tới ESP32 |
|---|---|---|
| 8 | DHT22 — DATA | GPIO4 |
| 20 | PIR — OUT | GPIO27 |
| 34 | LDR — AO | GPIO34 |
| 44 | Trở 220 Ω — chân 1 | GPIO2 |
| 48 | Trở 220 Ω — chân 2 + LED anode | (điểm nối chung, không lên ESP32) |
| 60 | Buzzer — chân + | GPIO25 |

| Thanh nguồn trên breadboard | Cắm vào | Nối tới |
|---|---|---|
| Đỏ trên (`tp`) = 3,3 V | DHT22 VCC, LDR VCC | ESP32 **3V3** |
| Đỏ dưới (`bp`) = 5 V | PIR VCC | ESP32 **5V (VIN)** |
| Đen trên (`tn`) = GND | DHT22 GND, LDR GND, LED cathode, Buzzer − | ESP32 **GND** |
| Đen dưới (`bn`) = GND | PIR GND | ESP32 **GND** |

---

## 3. Ba lỗi hay gặp khi đấu dây

1. **Nối 3,3 V với 5 V.** Hai thanh đỏ trên và dưới breadboard **phải để rời nhau** — nối lại
   là chập nguồn, board sẽ nóng và có thể hỏng. Chỉ nối hai thanh **đen** (GND) với nhau
   bằng một dây cầu, vì trên breadboard thật hai thanh này tách rời.
2. **Cấp 3,3 V cho PIR.** HC-SR501 chạy không ổn định ở 3,3 V: báo động giả hoặc không bật.
   Luôn lấy 5 V từ chân `VIN` (trên board Wokwi chân này tên là `5V`).
3. **LED không có trở.** GPIO2 cấp dòng trực tiếp sẽ làm LED cháy hoặc hỏng chân. Bắt buộc
   đi qua trở 220 Ω.

---

## 4. Trình tự lắp và kiểm tra

1. Cắm ESP32 xuống breadboard, đưa hai chân nguồn về hai thanh ray.
2. Đi dây nguồn trước: 3V3 lên thanh đỏ trên, 5V xuống thanh đỏ dưới, GND xuống hai thanh đen,
   cầu `GND trên ↔ GND dưới`.
3. Cắm lần lượt DHT22, PIR, LDR, LED + trở, buzzer theo bảng ở mục 2.
4. **Kiểm tra bằng mắt trước khi cấp nguồn**: không có dây nào nối thanh đỏ trên với thanh đỏ
   dưới; mọi chân GND đều về thanh đen.
5. Cắm USB, mở Serial Monitor **115200** — phải thấy dòng kết nối Wi-Fi rồi `MQTT connected`.
6. Mở app, vào màn hình **Thiết bị**: trạng thái phải chuyển sang Online trong ~10 giây;
   số liệu nhiệt độ/độ ẩm/ánh sáng cập nhật mỗi 10 giây.
7. Thử lệnh: bật LED, kêu còi, `ping` — thiết bị phản hồi trong 1–2 giây.

Nếu Serial báo `MQTT connect failed -4`: sai tài khoản/mật khẩu broker trong `config.h`.
Nếu app báo Offline mà Serial vẫn chạy: kiểm tra `TOPIC_PREFIX` và `DEVICE_CODE` có khớp
với thiết bị đã đăng ký trong app.

---

## 5. Bảng chân trong firmware

| Thông số | Giá trị | Khai báo |
|---|---|---|
| DHT22 | GPIO4 | `DHT_PIN` |
| PIR | GPIO27 | `PIR_PIN` |
| LDR | GPIO34 | `LDR_PIN` |
| LED | GPIO2 | `LED_PIN` |
| Buzzer | GPIO25 | `BUZZER_PIN` |
| Chu kỳ gửi dữ liệu | 10 giây | `SAMPLE_INTERVAL_MS` |
| Warm-up PIR | 60 giây | `PIR_WARMUP_MS` |

Đổi chân thì sửa `config.h` rồi nạp lại; phần còn lại của hệ thống không cần thay đổi.

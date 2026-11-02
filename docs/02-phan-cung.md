# 02 — Phần cứng và đấu nối

## 1. Linh kiện

| # | Linh kiện | SL | Ghi chú |
|---|---|---|---|
| 1 | ESP32 DevKit (Wokwi: `board-esp32-devkit-c-v4`) | 1 | Bản thật có thể là DevKit V1 / NodeMCU-32S; chân GPIO giống nhau |
| 2 | DHT22 (AM2302) | 1 | Đo nhiệt độ −40…80 °C, độ ẩm 0–100 % |
| 3 | PIR HC-SR501 | 1 | Phát hiện **chuyển động**, không phải "có người" tuyệt đối |
| 4 | Module LDR (quang trở + so sánh) | 1 | Xuất `AO` (analog) và `DO` (digital) |
| 5 | LED đỏ 5 mm | 1 | Kèm trở 220 Ω |
| 6 | Buzzer active 5 V | 1 | Nếu là buzzer passive phải dùng `tone()` |
| 7 | Breadboard + dây jumper | 1 bộ | Nên dùng dây có đầu cắm chắc chắn |
| 8 | Cáp USB micro/USB-C | 1 | **Bắt buộc** để nạp code và cấp nguồn (tài liệu gốc thiếu) |
| 9 | Vỏ hộp / băng dính 3M (tuỳ chọn) | 1 | Bảo vệ bo mạch |

### Chi phí tham khảo (2026, Việt Nam)

| Khoản | Giá thấp | Giá cao |
|---|---:|---:|
| ESP32 DevKit | 100.000 | 140.000 |
| DHT22 | 35.000 | 55.000 |
| PIR HC-SR501 | 25.000 | 45.000 |
| Module LDR | 8.000 | 15.000 |
| LED + trở | 3.000 | 6.000 |
| Buzzer active | 8.000 | 15.000 |
| Breadboard + dây | 25.000 | 45.000 |
| Cáp USB | 20.000 | 35.000 |
| **Tổng (chưa vỏ)** | **224.000** | **356.000** |
| Vỏ / phụ kiện (tuỳ chọn) | 30.000 | 60.000 |

> Đây là giá tham khảo, thay đổi theo nơi mua. Tài liệu gốc ghi hai khoảng
> 294–334k và 300–350k nhưng lại thiếu cáp USB; bảng trên đã tính đủ và thống nhất
> một khoảng. Khi làm báo cáo, nên ghi rõ "giá tham khảo tại thời điểm khảo sát".

## 2. Sơ đồ chân

Khớp với `firmware/diagram.json` và `firmware/smart_desk/config.h`.

| Linh kiện | Chân linh kiện | Chân ESP32 | Màu dây gợi ý | Ghi chú |
|---|---|---|---|---|
| DHT22 | VCC | 3V3 | đỏ | Có thể dùng 5 V nếu module có pull-up phù hợp; an toàn nhất là 3.3 V |
| DHT22 | GND | GND | đen | Nối đất chung |
| DHT22 | DATA | GPIO4 | xanh lá | Cần trở kéo 10 kΩ lên VCC nếu module chưa có |
| PIR HC-SR501 | VCC | VIN (5 V) | đỏ | HC-SR501 cần 5 V để ổn định |
| PIR HC-SR501 | GND | GND | đen | |
| PIR HC-SR501 | OUT | GPIO27 | cam | Ngõ ra mức cao 3.3 V, an toàn cho ESP32 |
| LDR module | VCC | 3V3 | đỏ | |
| LDR module | GND | GND | đen | |
| LDR module | AO | GPIO34 | tím | ADC1_CH6; GPIO34 chỉ làm input |
| LED | Anode (A) | GPIO2 qua trở 220 Ω | xanh dương | GPIO2 là chân strapping |
| LED | Cathode (C) | GND | đen | |
| Buzzer active | Chân + | GPIO25 | vàng | Active buzzer kêu khi có mức cao |
| Buzzer active | Chân − | GND | đen | |

### Sơ đồ ASCII

```text
                 ESP32 DevKit
              ┌───────────────┐
   DHT22 VCC ─┤ 3V3           │
   DHT22 GND ─┤ GND           │
   DHT22 DATA┤ GPIO4         │
              │               │
   PIR VCC  ──┤ VIN (5V)      │
   PIR GND  ──┤ GND           │
   PIR OUT  ──┤ GPIO27        │
              │               │
   LDR VCC  ──┤ 3V3           │
   LDR GND  ──┤ GND           │
   LDR AO   ──┤ GPIO34        │
              │               │
   LED A ──[220Ω]── GPIO2     │
   LED C ─────┤ GND           │
              │               │
   Buzzer + ──┤ GPIO25        │
   Buzzer − ──┤ GND           │
              └───────────────┘
```

## 3. Lưu ý điện học

### 3.1 DHT22

- Khoảng cách đọc tối thiểu **2 giây**; firmware dùng 10 giây.
- Nếu dùng DHT22 rời (4 chân), thêm trở **10 kΩ** giữa DATA và VCC.
- DHT22 có thể đọc sai vài mẫu đầu sau khi cấp nguồn; firmware bỏ qua mẫu lỗi.
- Không đặt cảm biến sát ESP32 hoặc nguồn nóng, sẽ làm nhiệt độ đo cao hơn thực tế.

### 3.2 PIR HC-SR501

- Cần **5 V**; cấp 3.3 V thường làm cảm biến không ổn định.
- Ngõ OUT của module thường ở mức 3.3 V, nhưng nên kiểm tra bằng đồng hồ trước khi nối
  trực tiếp. Nếu module dùng điện áp 5 V ở OUT, cần chia áp hoặc level shifter.
- Sau khi cấp nguồn cần **30–60 giây warm-up**; firmware chờ 60 giây trước khi tin dữ liệu.
- PIR phát hiện **thay đổi hồng ngoại**, không phát hiện người ngồi yên. Vì vậy backend
  dùng cờ `motion_detected` và cảnh báo "không thấy chuyển động", không kết luận "không có người".
- Chỉnh biến trở trên module: `Sx` (độ nhạy), `Tx` (thời gian giữ tín hiệu).

### 3.3 Module LDR

- Đầu ra `AO` là điện áp analog 0–3.3 V, ESP32 đọc thành số **0–4095**.
- Giá trị này **không phải lux**. Firmware và backend quy đổi gần đúng:

  ```text
  ratio = raw / 4095
  lux   = 1000 × ratio^2.2
  ```

  Công thức chỉ đơn điệu và phục vụ ngưỡng cảnh báo. Muốn đo lux thật cần cảm biến
  hiệu chuẩn (BH1750, VEML7700) hoặc hiệu chuẩn thủ công bằng app đo sáng trên điện thoại.
- **Chiều của module:** module KY-018/LM393 thông thường cho `AO` **tăng** khi sáng;
  module `wokwi-photoresistor-sensor` của Wokwi thì **giảm**. Cấu hình bằng
  `LDR_INVERTED` trong `config.h`:

  | Module | `LDR_INVERTED` |
  |---|---|
  | KY-018 / LM393 (phần cứng thật) | `0` |
  | Wokwi (`wokwi/config.h`) | `1` |

  Nếu đọc ngược (phòng sáng mà báo tối, LED tự bật), đổi cờ này. Firmware tính
  `light_lux` trên thiết bị và gửi kèm, nên app luôn hiển thị đúng lux.
- GPIO34 thuộc **ADC1**, hoạt động được khi Wi-Fi bật. Tránh dùng ADC2 (GPIO0/2/4/12–15…)
  cho analog nếu cần Wi-Fi.
- Module LDR thường có biến trở `DO`; có thể bỏ qua `DO` và chỉ dùng `AO`.

### 3.4 LED

- GPIO2 là **strapping pin**: nếu bị kéo xuống thấp lúc khởi động, ESP32 có thể vào chế độ
  nạp firmware. Dùng LED qua trở 220 Ω (dòng nhỏ) thường không gây vấn đề, nhưng khi thiết kế
  PCB nên tránh hoặc thêm buffer.
- Đừng nối LED trực tiếp không có trở — có thể làm hỏng GPIO hoặc LED.
- Trên một số board DevKit, GPIO2 đã nối với LED onboard; LED ngoài sẽ sáng cùng.

### 3.5 Buzzer

- **Active buzzer**: cấp mức cao là kêu, dùng `digitalWrite`/`tone` đều được.
- **Passive buzzer**: phải dùng `tone(pin, frequency)`.
- Buzzer nhỏ (< 30 mA) có thể nối trực tiếp; buzzer lớn nên dùng transistor + diode flyback.
- Firmware mặc định dùng `tone()` với tần số 2 kHz; nếu là active buzzer vẫn kêu.

## 4. Nguồn và bố trí

- Cấp ESP32 bằng cáp USB 5 V / 1 A trở lên.
- PIR lấy từ chân `VIN` (5 V) của board khi board được cấp USB.
- Nối **GND chung** cho tất cả module.
- Đặt PIR hướng về phía người ngồi, tránh hướng ra cửa sổ hoặc luồng gió.
- Đặt LDR gần mặt bàn, không bị bóng của chính người dùng che.
- DHT22 đặt cách xa ESP32 5–10 cm để tránh nhiệt từ chip.

## 5. Khác biệt giữa Wokwi và phần cứng thật

| Điểm | Wokwi | Thực tế |
|---|---|---|
| Board | `board-esp32-devkit-c-v4` | Có thể là DevKit V1; chân GPIO tương đương |
| PIR | Mô phỏng nút bấm | Cần warm-up, chỉnh độ nhạy |
| DHT22 | Giá trị mô phỏng | Cần trở kéo, tránh nhiễu |
| LDR | Mô phỏng ánh sáng, **ngược chiều** KY-018 thật | ADC thật có nhiễu, phi tuyến |
| Wi-Fi | `Wokwi-GUEST` | SSID/mật khẩu thật |
| MQTT | `broker.emqx.io` (công khai) | Broker riêng, nên có TLS/ACL |

## 6. Kiểm tra trước khi nạp firmware

1. Đo 3.3 V và 5 V giữa các chân nguồn và GND.
2. Kiểm tra không có chân nào bị chập.
3. Cắm USB, xem Serial Monitor ở 115200 baud.
4. Nếu DHT22 lỗi: kiểm tra trở kéo và dây DATA.
5. Nếu PIR luôn báo động: giảm độ nhạy, chờ warm-up, tránh nguồn nhiệt.
6. Nếu LDR luôn 0 hoặc 4095: kiểm tra chân `AO` (không phải `DO`), và chân GPIO34.

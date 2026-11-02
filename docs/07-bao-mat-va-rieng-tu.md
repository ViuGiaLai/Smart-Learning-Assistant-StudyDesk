# 07 — Bảo mật và quyền riêng tư

Tài liệu này mô tả những gì đã làm, những gì **chưa** làm và cách triển khai an toàn hơn.
Đây là đồ án học tập, không phải hệ thống đã được kiểm toán bảo mật.

## 1. Mô hình mối đe doạ (tóm tắt)

| Tài sản | Rủi ro chính |
|---|---|
| Mật khẩu người dùng | Lộ DB, brute force, dùng lại mật khẩu |
| JWT | Bị đánh cắp, token sống quá lâu |
| Device key | Lộ qua log/mã nguồn, dùng để gửi telemetry giả |
| Dữ liệu cảm biến | Đọc trộm, suy ra thói quen sinh hoạt |
| Gemini API key | Lộ qua app bundle hoặc repo |
| Broker MQTT | Người lạ publish/subscribe |

## 2. Xác thực người dùng

### 2.1 Hash mật khẩu

- Dùng **scrypt của Python stdlib** (`hashlib.scrypt`) với salt ngẫu nhiên 16 byte.
- Tham số: `n=2**14, r=8, p=1`, key length 32.
- Định dạng lưu: `scrypt$n$r$p$salt_hex$hash_hex`.
- So sánh bằng `hmac.compare_digest` để tránh timing attack.

Vì sao không bcrypt/argon2?

- Tránh phụ thuộc thư viện native khi cài trên Windows/Docker.
- scrypt là thuật toán có kiểm chứng, đủ cho đồ án.
- Với production quy mô lớn, nên dùng Argon2id và tăng tham số theo phần cứng.

### 2.2 JWT

- Access token: mặc định 60 phút.
- Refresh token: mặc định 14 ngày.
- Thuật toán HS256; secret lấy từ `JWT_SECRET`.
- Payload chứa `sub` (user id), `type` (`access`/`refresh`), `exp`, `iat`.
- Refresh token chỉ dùng cho `/api/auth/refresh`; không dùng để gọi API nghiệp vụ.

**Bắt buộc khi triển khai:**

```powershell
# Tạo secret ngẫu nhiên 32 byte
python -c "import secrets; print(secrets.token_hex(32))"
```

Đặt vào `JWT_SECRET`, không commit.

### 2.3 Lưu token trên mobile

- Ưu tiên `expo-secure-store` (Keychain/Keystore).
- Fallback `AsyncStorage` chỉ khi SecureStore không khả dụng (ví dụ một số môi trường web).
- Không log token ra console.
- Khi logout: xoá token khỏi bộ nhớ và storage.

## 3. Thiết bị và device key

- Mỗi thiết bị có `device_code` công khai và `device_key` bí mật.
- Server chỉ lưu **SHA-256 hash** của key; plaintext trả về đúng một lần khi đăng ký.
- Key dùng cho HTTP fallback qua header `X-Device-Key`.
- MQTT demo dùng `device_code` làm định danh; production nên cấu hình username/password
  riêng và ACL.

**Khuyến nghị:**

- Không đưa device key vào mã nguồn công khai.
- Nếu firmware bị mất, xoá thiết bị và đăng ký lại để thu hồi key.
- Cân nhắc thêm xoay vòng key (chưa triển khai).

## 4. Phân quyền

- Mọi endpoint thiết bị/reading/command đều kiểm tra `device.user_id == current_user.id`.
- Không trả 403 kèm thông tin thiết bị của người khác; trả 404 để giảm rò rỉ.
- WebSocket kiểm tra quyền trước khi `accept()`.
- Plan/session/notification đều lọc theo `user_id`.

**Chưa có:**

- vai trò admin;
- chia sẻ thiết bị giữa nhiều người;
- audit log ai đã gửi lệnh.

## 5. MQTT

### 5.1 Hiện tại (demo)

- Chế độ Docker: Mosquitto 2, cổng 1883, `allow_anonymous true`.
- Chế độ không Docker (bản demo đang chạy): broker công khai `broker.emqx.io:1883`,
  prefix riêng `smartstudy_demo_2f7c91` để tránh trùng topic với người khác.
- Backend subscribe `<prefix>/+/telemetry` và `<prefix>/+/status`
  (mặc định `<prefix>` = `smartstudy`).
- Firmware publish telemetry/status, subscribe command.
- Không có TLS.

Điều này **chỉ phù hợp mạng LAN hoặc demo lớp học**. Broker công khai thì ai cũng
đọc/ghi được cùng topic — chỉ gửi dữ liệu giả hoặc dữ liệu không nhạy cảm.

### 5.2 Production checklist

1. **Tắt ẩn danh:**

   ```conf
   allow_anonymous false
   password_file /mosquitto/config/passwd
   acl_file /mosquitto/config/acl
   ```

2. **Tạo user cho backend và từng thiết bị:**

   ```bash
   mosquitto_passwd -c /mosquitto/config/passwd backend
   mosquitto_passwd /mosquitto/config/passwd STUDY_DESK_001
   ```

3. **ACL tối thiểu** (thay `smartstudy` bằng `MQTT_TOPIC_PREFIX` thực tế):

   ```conf
   user backend
   topic read smartstudy/+/telemetry
   topic read smartstudy/+/status
   topic write smartstudy/+/command
   topic write smartstudy/backend/status

   user STUDY_DESK_001
   topic write smartstudy/STUDY_DESK_001/telemetry
   topic write smartstudy/STUDY_DESK_001/status
   topic read  smartstudy/STUDY_DESK_001/command
   ```

4. **TLS:**

   ```conf
   listener 8883
   cafile   /mosquitto/certs/ca.crt
   certfile /mosquitto/certs/server.crt
   keyfile  /mosquitto/certs/server.key
   ```

   Backend đặt `MQTT_USE_TLS=true`, `MQTT_PORT=8883`.

5. **Không dùng `test.mosquitto.org`** cho dữ liệu thật.
6. **Đổi `MQTT_TOPIC_PREFIX`** nếu dùng broker công cộng.
7. **Rate limit / giám sát** số message bất thường.

## 6. API

- CORS mặc định `*` cho dev. Production đặt danh sách cụ thể:

  ```env
  CORS_ORIGINS=https://app.example.com
  ```

- Validation đầu vào bằng Pydantic (độ dài, khoảng giá trị, kiểu).
- SQLAlchemy dùng tham số hoá, không nối chuỗi SQL.
- Swagger UI nên tắt hoặc bảo vệ ở production nếu không cần.
- Chạy sau reverse proxy có HTTPS (Caddy/Nginx/Cloudflare).
- **Chưa có** rate limiting cho login/chat → dễ bị brute force hoặc lạm dụng Gemini.
  Khuyến nghị thêm `slowapi` hoặc rate limit ở reverse proxy.

### 6.1 Header bảo mật gợi ý

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
```

## 7. Quyền riêng tư dữ liệu cảm biến

Dữ liệu nhiệt độ/ánh sáng/chuyển động có thể suy ra:

- giờ ngủ, giờ có nhà;
- thói quen học;
- mức độ tập trung.

### 7.1 Kiểm soát đã có

- `collection_enabled`: người dùng tắt thu thập; backend vẫn nhận heartbeat nhưng
  **không lưu** reading và không tạo cảnh báo.
- Xoá thiết bị sẽ xoá cascade reading và notification liên quan.
- API chỉ trả dữ liệu của chính người dùng.
- Không gửi dữ liệu thô cho bên thứ ba ngoài Gemini khi người dùng chủ động chat.

### 7.2 Khuyến nghị bổ sung

- Chính sách lưu trữ: ví dụ xoá reading thô sau 90 ngày, giữ thống kê tổng hợp.
- Cho người dùng tải/xoá toàn bộ dữ liệu (data export/delete).
- Ẩn vị trí chính xác; chỉ lưu tên phòng.
- Thông báo rõ khi bật lại thu thập.
- Không dùng dữ liệu cảm biến cho quảng cáo.

## 8. Gemini và dữ liệu gửi đi

Khi người dùng chat, backend gửi cho Gemini:

- tên người dùng;
- mục tiêu học;
- thống kê học tập;
- reading mới nhất + ngưỡng;
- câu hỏi.

**Không gửi:** email, mật khẩu, device key, token.

Khuyến nghị:

- Thông báo trong app rằng câu hỏi được xử lý bởi dịch vụ AI bên thứ ba.
- Không gửi dữ liệu nhận dạng cá nhân nếu không cần; có thể thay tên bằng “bạn”.
- Kiểm tra chính sách dữ liệu của Google Generative Language API.
- Có cơ chế tắt AI (`GEMINI_API_KEY` trống → rule-based).

## 9. Bí mật trong repo

| File | Trạng thái |
|---|---|
| `backend/.env` | Đã có trong `.gitignore` |
| `backend/.env.example` | Không chứa secret thật |
| `mobile/.env` | Đã có trong `.gitignore` |
| `firmware/smart_desk/config.h` | Chứa Wi-Fi/MQTT mẫu; **không nên commit bản thật** |

Nếu lỡ commit secret:

1. Thu hồi/đổi secret ngay.
2. Xoá khỏi lịch sử git (`git filter-repo` hoặc BFG).
3. Kiểm tra log dịch vụ xem có dấu hiệu lạm dụng.

## 10. Checklist trước khi triển khai

- [ ] `JWT_SECRET` ngẫu nhiên ≥ 32 byte.
- [ ] `ENVIRONMENT=production`.
- [ ] PostgreSQL dùng mật khẩu mạnh, không mở cổng 5432 ra internet.
- [ ] HTTPS cho API; WSS cho WebSocket.
- [ ] `CORS_ORIGINS` là danh sách cụ thể.
- [ ] MQTT tắt ẩn danh, có ACL + TLS.
- [ ] Không dùng `test.mosquitto.org`.
- [ ] `GEMINI_API_KEY` chỉ ở server, có hạn mức.
- [ ] Sao lưu DB định kỳ và thử khôi phục.
- [ ] Log không chứa token/mật khẩu/device key.
- [ ] Có rate limit cho login và chat.
- [ ] Có chính sách lưu trữ/xoá dữ liệu.
- [ ] Swagger UI được bảo vệ hoặc tắt.

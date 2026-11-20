/**
 * parseVoiceCommand – phân tích câu lệnh tiếng Việt (cả giọng nói lẫn gõ phím)
 * để điều khiển thiết bị IoT (Quạt, Đèn, Còi).
 *
 * Xử lý thông minh các biến thể phát âm STT tiếng Việt:
 *  - "tắt" / "tắc" / "ngắt" / "dừng" / "ngừng" / "off" / "stop"
 *  - "bật" / "bậc" / "mở" / "chạy" / "on" / "start"
 */

export type IoTAction = "set_fan" | "set_led" | "set_buzzer" | "set_fan_auto" | "ping";

export interface ParsedCommand {
  action: IoTAction;
  value: boolean;
  /** Phản hồi ngay cho người dùng */
  feedback: string;
}

// Từ khóa mang nghĩa TẮT / DỪNG
const OFF_KEYWORDS = /tắt|tắc|ngắt|dừng|ngừng|đóng|stop|off|im|hết|thôi|đừng|hủy|mute|ko|không|hạ/i;
// Từ khóa mang nghĩa BẬT / MỞ
const ON_KEYWORDS = /bật|bậc|mở|chạy|start|on|phát|kêu|hú|bấm|thắp|sáng|khởi động/i;

export function parseVoiceCommand(text: string): ParsedCommand | null {
  const norm = text.trim().toLowerCase();

  // 1. KIỂM TRA KẾT NỐI (PING)
  if (/kiểm tra kết nối|kiểm tra thiết bị|test kết nối|ping/i.test(norm)) {
    return {
      action: "ping",
      value: true,
      feedback: "📶 Đã gửi tín hiệu kiểm tra kết nối tới thiết bị bàn học!",
    };
  }

  // 2. CÒI / CHUÔNG / BUZZER
  if (/còi|chuông|buzzer|bíp|beep|buzz/i.test(norm)) {
    // Nếu có từ ngữ mang ý nghĩa TẮT / NGỪNG
    if (OFF_KEYWORDS.test(norm)) {
      return {
        action: "set_buzzer",
        value: false,
        feedback: "🔕 Đã tắt còi báo!",
      };
    }
    // Mặc định hoặc có từ bật -> BẬT CÒI
    return {
      action: "set_buzzer",
      value: true,
      feedback: "🔔 Đã bật còi báo!",
    };
  }

  // 3. QUẠT (FAN)
  if (/quạt|fan/i.test(norm)) {
    // Kiểm tra chế độ TỰ ĐỘNG
    if (/tự động|auto/i.test(norm)) {
      if (OFF_KEYWORDS.test(norm)) {
        return {
          action: "set_fan_auto",
          value: false,
          feedback: "⚙️ Đã tắt chế độ tự động cho quạt (chuyển sang thủ công)!",
        };
      }
      return {
        action: "set_fan_auto",
        value: true,
        feedback: "⚙️ Đã chuyển quạt sang chế độ tự động!",
      };
    }

    // Tắt quạt
    if (OFF_KEYWORDS.test(norm)) {
      return {
        action: "set_fan",
        value: false,
        feedback: "✅ Đã tắt quạt làm mát!",
      };
    }

    // Bật quạt
    if (ON_KEYWORDS.test(norm)) {
      return {
        action: "set_fan",
        value: true,
        feedback: "✅ Đã bật quạt làm mát!",
      };
    }
  }

  // 4. ĐÈN (LIGHT / LED)
  if (/đèn|light|led|chiếu sáng/i.test(norm)) {
    // Tắt đèn
    if (OFF_KEYWORDS.test(norm)) {
      return {
        action: "set_led",
        value: false,
        feedback: "✅ Đã tắt đèn bàn học!",
      };
    }

    // Bật đèn
    if (ON_KEYWORDS.test(norm)) {
      return {
        action: "set_led",
        value: true,
        feedback: "✅ Đã bật đèn bàn học!",
      };
    }
  }

  return null;
}

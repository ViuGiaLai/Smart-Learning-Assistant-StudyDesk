/**
 * parseVoiceCommands – phân tích câu lệnh tiếng Việt (cả giọng nói lẫn gõ phím)
 * để điều khiển thiết bị IoT (Quạt, Đèn, Còi).
 *
 * Hỗ trợ:
 *  - Lệnh đơn: "bật quạt", "tắt đèn", "tắc còi"...
 *  - Lệnh kép đồng thời: "tắt đèn và tắt quạt", "bật đèn và quạt", "tắt quạt mở đèn"...
 *  - Lệnh toàn bộ: "tắt hết", "tắt tất cả", "bật tất cả thiết bị"...
 *  - Xử lý phương ngữ/STT: "tắt"/"tắc"/"ngắt"/"dừng", "bật"/"bậc"/"mở"...
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

export function parseVoiceCommands(text: string): ParsedCommand[] {
  const norm = text.trim().toLowerCase();
  const results: ParsedCommand[] = [];
  const addedActions = new Set<IoTAction>();

  const addCmd = (cmd: ParsedCommand) => {
    if (!addedActions.has(cmd.action)) {
      addedActions.add(cmd.action);
      results.push(cmd);
    }
  };

  // 1. LỆNH TOÀN BỘ (TẮT HẾT / BẬT HẾT)
  if (/tất cả|toàn bộ|hết thiết bị|mọi thiết bị/i.test(norm) || /^(tắt|tắc|ngắt) (hết|tất cả)$/i.test(norm)) {
    if (OFF_KEYWORDS.test(norm)) {
      return [
        { action: "set_led", value: false, feedback: "✅ Đã tắt đèn bàn học!" },
        { action: "set_fan", value: false, feedback: "✅ Đã tắt quạt làm mát!" },
        { action: "set_buzzer", value: false, feedback: "🔕 Đã tắt còi báo!" },
      ];
    }
    if (ON_KEYWORDS.test(norm)) {
      return [
        { action: "set_led", value: true, feedback: "✅ Đã bật đèn bàn học!" },
        { action: "set_fan", value: true, feedback: "✅ Đã bật quạt làm mát!" },
      ];
    }
  }

  // 2. TÁCH CÂU THÀNH CÁC MỆNH ĐỀ (phân cách bởi "và", "với", "đồng thời", ",", ";")
  // Ví dụ: "tắt đèn và tắt quạt" -> ["tắt đèn", "tắt quạt"]
  // "bật đèn, tắt quạt" -> ["bật đèn", "tắt quạt"]
  const clauses = norm
    .split(/\s*(?:và|với|cùng|đồng thời|,|;|\+)\s*/)
    .map((c) => c.trim())
    .filter(Boolean);

  // Kiểm tra nếu có từ hành động chung ở đầu (vd: "bật đèn và quạt", "tắt quạt và đèn")
  const leadingOff = OFF_KEYWORDS.test(clauses[0] || "");
  const leadingOn = ON_KEYWORDS.test(clauses[0] || "");

  for (const clause of clauses) {
    const isOff = OFF_KEYWORDS.test(clause) || (leadingOff && !ON_KEYWORDS.test(clause));
    const isOn = ON_KEYWORDS.test(clause) || (leadingOn && !OFF_KEYWORDS.test(clause));

    // A. KIỂM TRA PING / KẾT NỐI
    if (/kiểm tra kết nối|kiểm tra thiết bị|test kết nối|ping/i.test(clause)) {
      addCmd({
        action: "ping",
        value: true,
        feedback: "📶 Đã gửi tín hiệu kiểm tra kết nối tới thiết bị bàn học!",
      });
    }

    // B. KIỂM TRA CÒI / CHUÔNG
    if (/còi|chuông|buzzer|bíp|beep|buzz/i.test(clause)) {
      if (isOff) {
        addCmd({
          action: "set_buzzer",
          value: false,
          feedback: "🔕 Đã tắt còi báo!",
        });
      } else {
        addCmd({
          action: "set_buzzer",
          value: true,
          feedback: "🔔 Đã bật còi báo!",
        });
      }
    }

    // C. KIỂM TRA QUẠT
    if (/quạt|fan/i.test(clause)) {
      if (/tự động|auto/i.test(clause)) {
        if (isOff) {
          addCmd({
            action: "set_fan_auto",
            value: false,
            feedback: "⚙️ Đã tắt chế độ tự động cho quạt (chuyển sang thủ công)!",
          });
        } else {
          addCmd({
            action: "set_fan_auto",
            value: true,
            feedback: "⚙️ Đã chuyển quạt sang chế độ tự động!",
          });
        }
      } else if (isOff) {
        addCmd({
          action: "set_fan",
          value: false,
          feedback: "✅ Đã tắt quạt làm mát!",
        });
      } else if (isOn) {
        addCmd({
          action: "set_fan",
          value: true,
          feedback: "✅ Đã bật quạt làm mát!",
        });
      }
    }

    // D. KIỂM TRA ĐÈN
    if (/đèn|light|led|chiếu sáng/i.test(clause)) {
      if (isOff) {
        addCmd({
          action: "set_led",
          value: false,
          feedback: "✅ Đã tắt đèn bàn học!",
        });
      } else if (isOn) {
        addCmd({
          action: "set_led",
          value: true,
          feedback: "✅ Đã bật đèn bàn học!",
        });
      }
    }
  }

  // Nếu tách clause chưa bắt được (vd: "bật đèn tắt quạt" không có chữ "và")
  if (results.length === 0) {
    // Quét độc lập từng thiết bị trên toàn bộ chuỗi
    if (/còi|chuông|buzzer|bíp|beep|buzz/i.test(norm)) {
      addCmd({
        action: "set_buzzer",
        value: !OFF_KEYWORDS.test(norm),
        feedback: OFF_KEYWORDS.test(norm) ? "🔕 Đã tắt còi báo!" : "🔔 Đã bật còi báo!",
      });
    }

    if (/quạt|fan/i.test(norm)) {
      const matchOff = /tắt.*quạt|tắc.*quạt|ngắt.*quạt|dừng.*quạt|quạt.*tắt|quạt.*tắc|quạt.*ngắt|quạt.*dừng|stop.*fan/i.test(norm);
      const matchOn = /bật.*quạt|bậc.*quạt|mở.*quạt|chạy.*quạt|quạt.*bật|quạt.*bậc|quạt.*mở|start.*fan/i.test(norm);
      if (matchOff) {
        addCmd({ action: "set_fan", value: false, feedback: "✅ Đã tắt quạt làm mát!" });
      } else if (matchOn) {
        addCmd({ action: "set_fan", value: true, feedback: "✅ Đã bật quạt làm mát!" });
      }
    }

    if (/đèn|light|led/i.test(norm)) {
      const matchOff = /tắt.*đèn|tắc.*đèn|ngắt.*đèn|đèn.*tắt|đèn.*tắc|đèn.*ngắt/i.test(norm);
      const matchOn = /bật.*đèn|bậc.*đèn|mở.*đèn|thắp.*đèn|sáng.*đèn|đèn.*bật|đèn.*bậc|đèn.*mở/i.test(norm);
      if (matchOff) {
        addCmd({ action: "set_led", value: false, feedback: "✅ Đã tắt đèn bàn học!" });
      } else if (matchOn) {
        addCmd({ action: "set_led", value: true, feedback: "✅ Đã bật đèn bàn học!" });
      }
    }
  }

  return results;
}

/** Tương thích ngược với các nơi gọi parseVoiceCommand (lấy phần tử đầu tiên hoặc null) */
export function parseVoiceCommand(text: string): ParsedCommand | null {
  const list = parseVoiceCommands(text);
  return list.length > 0 ? (list[0] ?? null) : null;
}

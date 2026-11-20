/**
 * parseStudyCommand – phân tích câu lệnh về phiên học / Pomodoro đếm ngược:
 *  - "đặt thời gian tập trung là 1 phút" -> action: "set_duration", minutes: 1
 *  - "bắt đầu thời gian" / "bắt đầu học" -> action: "start"
 *  - "bắt đầu học 1 phút" / "tập trung 25 phút" -> action: "start", minutes: 1/25
 *  - "tạm dừng học" -> action: "pause"
 *  - "tiếp tục học" -> action: "resume"
 *  - "kết thúc học" / "dừng học" -> action: "finish"
 *  - "còn bao nhiêu phút" / "thời gian còn lại" -> action: "query"
 */

export type StudyAction =
  | "set_duration"
  | "start"
  | "pause"
  | "resume"
  | "finish"
  | "query";

export interface ParsedStudyCommand {
  action: StudyAction;
  minutes?: number;
}

export function parseStudyCommand(text: string): ParsedStudyCommand | null {
  const norm = text.trim().toLowerCase();

  // 1. Trích xuất số phút nếu có trong câu
  // vd: "1 phút", "25 phút", "10p", "là 1 phút", "trong 45 phút"
  let minutes: number | undefined;
  const minMatch = norm.match(/(?:là\s*|trong\s*|khoảng\s*)?(\d+)\s*(?:phút|p|min)/i);
  if (minMatch && minMatch[1]) {
    const val = parseInt(minMatch[1], 10);
    if (!isNaN(val) && val >= 1 && val <= 240) {
      minutes = val;
    }
  }

  // 2. TẠM DỪNG
  if (/tạm dừng|dừng tạm thời|pause|nghỉ tay|nghỉ một lát/i.test(norm)) {
    return { action: "pause" };
  }

  // 3. TIẾP TỤC
  if (/tiếp tục (học|tập trung|đếm ngược|thời gian)?|resume/i.test(norm)) {
    return { action: "resume" };
  }

  // 4. KẾT THÚC / DỪNG HẲN / HỦY
  if (
    /kết thúc (học|phiên học|tập trung|buổi học)?|dừng học|dừng phiên học|hủy (học|phiên học|tập trung)?|xong phiên học|hoàn thành học/i.test(
      norm,
    )
  ) {
    return { action: "finish" };
  }

  // 5. HỎI THỜI GIAN CÒN LẠI / TIẾN ĐỘ
  if (
    /còn bao nhiêu|còn mấy phút|còn bao lâu|thời gian còn lại|thời gian tập trung còn|hết giờ chưa|tiến độ học/i.test(
      norm,
    )
  ) {
    return { action: "query" };
  }

  // 6. BẮT ĐẦU HỌC / BẮT ĐẦU THỜI GIAN / BẮT ĐẦU ĐẾM NGƯỢC
  const isStart =
    /bắt đầu|chạy thời gian|đếm ngược/i.test(norm) ||
    /(?:học|tập trung|hẹn giờ)\s+\d+\s*(?:phút|p|min)/i.test(norm);

  if (isStart) {
    return { action: "start", minutes };
  }

  // 7. THIẾT LẬP / ĐẶT THỜI GIAN (chưa bắt đầu ngay)
  // vd: "Hãy đặt thời gian tập trung là 1 phút", "cài thời gian 25 phút", "đặt 1 phút"
  const isSetupOnly =
    /(?:đặt|cài|thiết lập|đổi|chỉnh|chọn)(?:\s+thời\s*gian)?/i.test(norm);
  if (isSetupOnly && minutes !== undefined) {
    return { action: "set_duration", minutes };
  }

  return null;
}

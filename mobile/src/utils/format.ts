const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

export function formatDuration(seconds: number | null | undefined): string {
  const total = Math.max(0, Math.round(seconds ?? 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours} giờ ${minutes.toString().padStart(2, "0")} phút`;
  if (minutes > 0) return `${minutes} phút`;
  return `${total} giây`;
}

export function formatMinutes(seconds: number | null | undefined): number {
  return Math.round(Math.max(0, seconds ?? 0) / 60);
}

/** mm:ss for the Pomodoro ring. */
export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getHours().toString().padStart(2, "0")}:${date
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
}

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getDate().toString().padStart(2, "0")}/${(
    date.getMonth() + 1
  )
    .toString()
    .padStart(2, "0")}`;
}

export function weekdayLabel(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "?";
  return WEEKDAYS[date.getDay()] ?? "?";
}

export function formatLongDate(date = new Date()): string {
  return `${WEEKDAYS[date.getDay()] ?? ""}, ${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "chưa có dữ liệu";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "chưa có dữ liệu";
  const diffSeconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (diffSeconds < 15) return "vừa xong";
  if (diffSeconds < 60) return `${diffSeconds} giây trước`;
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)} phút trước`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)} giờ trước`;
  return `${Math.floor(diffSeconds / 86400)} ngày trước`;
}

export function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 11) return "Chào buổi sáng";
  if (hour < 14) return "Chào buổi trưa";
  if (hour < 18) return "Chào buổi chiều";
  return "Chào buổi tối";
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

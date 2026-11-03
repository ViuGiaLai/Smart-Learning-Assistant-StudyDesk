const dateTimeFormatter = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dateFormatter = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const shortDayFormatter = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
});

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return dateTimeFormatter.format(date);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return dateFormatter.format(date);
}

export function formatDay(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return shortDayFormatter.format(date);
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) return "Chưa có";
  const date = new Date(value).getTime();
  if (Number.isNaN(date)) return "—";
  const diff = Date.now() - date;
  const future = diff < 0;
  const seconds = Math.abs(diff) / 1000;

  const units: Array<[number, string, string]> = [
    [60, "giây", "giây"],
    [3600, "phút", "phút"],
    [86400, "giờ", "giờ"],
    [604800, "ngày", "ngày"],
    [2629800, "tuần", "tuần"],
    [31557600, "tháng", "tháng"],
    [Infinity, "năm", "năm"],
  ];
  const divisors = [1, 60, 3600, 86400, 604800, 2629800, 31557600];

  let unit = "giây";
  let divisor = 1;
  for (let i = 0; i < units.length; i += 1) {
    if (seconds < units[i][0]) {
      unit = units[i][1];
      divisor = divisors[i];
      break;
    }
  }
  const amount = Math.max(1, Math.floor(seconds / divisor));
  return future ? `${amount} ${unit} nữa` : `${amount} ${unit} trước`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("vi-VN").format(value);
}

export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}tr`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}k`;
  }
  return String(value);
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds < 0) return "0 phút";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours} giờ ${minutes} phút`;
  if (minutes > 0) return `${minutes} phút`;
  return `${Math.floor(seconds)} giây`;
}

export function formatTemp(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${value.toFixed(1)}°C`;
}

export function formatHumidity(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${value.toFixed(0)}%`;
}

export function formatLux(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${Math.round(value)} lux`;
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  temperature_high: "Nhiệt độ cao",
  temperature_low: "Nhiệt độ thấp",
  humidity_high: "Độ ẩm cao",
  humidity_low: "Độ ẩm thấp",
  light_low: "Ánh sáng thấp",
  light_high: "Ánh sáng cao",
  no_motion: "Không chuyển động",
  device_offline: "Thiết bị offline",
  study_reminder: "Nhắc học",
  study_completed: "Hoàn thành phiên",
  admin_message: "Tin nhắn admin",
  admin_broadcast: "Broadcast admin",
};

export function notificationTypeLabel(type: string): string {
  return NOTIFICATION_TYPE_LABELS[type] ?? titleCase(type);
}

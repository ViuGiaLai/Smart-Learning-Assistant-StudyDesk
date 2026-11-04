import type { DeviceSettings } from "../api/types";
import { palette } from "../theme";

export type SensorTone = "ok" | "cold" | "hot" | "warn" | "unknown";

export function temperatureTone(
  value: number,
  settings?: DeviceSettings | null,
): SensorTone {
  if (!settings) return "unknown";
  if (value < settings.temperature_min) return "cold";
  if (value > settings.temperature_max) return "hot";
  return "ok";
}

export function humidityTone(value: number, settings?: DeviceSettings | null): SensorTone {
  if (!settings) return "unknown";
  if (value < settings.humidity_min || value > settings.humidity_max) return "warn";
  return "ok";
}

export function lightTone(value: number, settings?: DeviceSettings | null): SensorTone {
  if (!settings) return "unknown";
  return value < settings.light_min_lux ? "warn" : "ok";
}

const TONE_COLORS: Record<SensorTone, string> = {
  ok: palette.success,
  cold: palette.info,
  hot: palette.danger,
  warn: palette.warning,
  unknown: palette.muted,
};

const TONE_BACKGROUNDS: Record<SensorTone, string> = {
  ok: "#DCFCE7",
  cold: "#DBEAFE",
  hot: "#FEE2E2",
  warn: "#FEF3C7",
  unknown: "#ECF0EF",
};

export function toneColor(tone: SensorTone): string {
  return TONE_COLORS[tone];
}

export function toneBackground(tone: SensorTone): string {
  return TONE_BACKGROUNDS[tone];
}

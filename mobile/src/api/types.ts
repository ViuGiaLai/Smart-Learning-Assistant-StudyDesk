export interface User {
  id: string;
  email: string;
  name: string;
  role: "student" | "admin";
  created_at: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface AuthResponse {
  user: User;
  tokens: TokenPair | null;
  requires_email_confirmation: boolean;
}

export interface DeviceSettings {
  temperature_min: number;
  temperature_max: number;
  humidity_min: number;
  humidity_max: number;
  light_min_lux: number;
  no_motion_minutes: number;
  collection_enabled: boolean;
  auto_control: boolean;
  sample_interval_seconds: number;
}

export type DeviceStatusValue = "online" | "offline";

export interface Device {
  id: string;
  device_code: string;
  name: string;
  status: DeviceStatusValue;
  last_seen_at: string | null;
  settings: DeviceSettings;
  created_at: string;
}

export interface RegisteredDevice extends Device {
  device_key: string;
  mqtt_username: string;
  mqtt_topics: Record<string, string>;
}

export interface DeviceStatus {
  id: string;
  device_code: string;
  status: DeviceStatusValue;
  online: boolean;
  last_seen_at: string | null;
  seconds_since_last_seen: number | null;
  sample_interval_seconds: number;
  collection_enabled: boolean;
}

export interface SensorReading {
  id: string;
  device_id: string;
  message_id: string;
  temperature: number | null;
  humidity: number | null;
  light_raw: number | null;
  light_lux: number | null;
  motion_detected: boolean;
  recorded_at: string;
  received_at: string;
}

export interface ReadingPage {
  items: SensorReading[];
  total: number;
  limit: number;
  offset: number;
}

export interface Alert {
  type: string;
  title: string;
  content: string;
}

export type StudySessionStatus = "running" | "paused" | "completed" | "cancelled";

export interface StudySession {
  id: string;
  plan_id: string | null;
  started_at: string;
  ended_at: string | null;
  planned_minutes: number;
  status: StudySessionStatus;
  duration_seconds: number;
  created_at: string;
}

export type StudyPlanStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface StudyPlan {
  id: string;
  title: string;
  description: string | null;
  scheduled_start: string | null;
  planned_minutes: number;
  status: StudyPlanStatus;
  completed_at: string | null;
  created_at: string;
}

export interface DailyStat {
  date: string;
  focused_seconds: number;
  sessions: number;
}

export interface StudyStats {
  today_focused_seconds: number;
  today_sessions: number;
  week_focused_seconds: number;
  week_sessions: number;
  total_focused_seconds: number;
  completed_sessions: number;
  plans_total: number;
  plans_completed: number;
  goal_completion_rate: number;
  daily_goal_minutes: number;
  daily: DailyStat[];
  timezone: string;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  content: string;
  is_read: boolean;
  device_id: string | null;
  created_at: string;
}

export interface PushResult {
  enabled: boolean;
  attempted: number;
  sent: number;
  failed: number;
  detail: string | null;
}

export interface PushDelivery {
  notification: NotificationItem;
  push: PushResult;
}

export interface DeviceTokenRegistration {
  registered: boolean;
  platform: string;
}

export interface ChatResponse {
  conversation_id: string;
  answer: string;
  suggestions: string[];
  source: ChatSource;
  model: string;
  created_at: string;
}

export type ChatSource = "groq" | "gemini" | "rule_based";

export interface AssistantContext {
  latest_temperature: number | null;
  latest_humidity: number | null;
  latest_light_lux: number | null;
  device_online: boolean;
  today_focused_seconds: number;
  suggestions: string[];
}

export interface CommandResponse {
  delivered: boolean;
  topic: string;
  payload: Record<string, unknown>;
  detail: string | null;
}

export interface TelemetryAccepted {
  stored: boolean;
  duplicate: boolean;
  collection_enabled: boolean;
  reading: SensorReading | null;
  alerts: Alert[];
}

export type StreamEvent =
  | {
      event: "snapshot";
      device_id: string;
      data: {
        status: DeviceStatusValue;
        last_seen_at: string | null;
        latest_reading: SensorReading | null;
      };
    }
  | {
      event: "telemetry";
      device_id: string;
      source: string;
      data: SensorReading;
      alerts: Alert[];
    }
  | { event: "alert"; device_id: string; data: Alert }
  | { event: "device_status"; device_id: string; data: Record<string, unknown> }
  | { event: "pong" };

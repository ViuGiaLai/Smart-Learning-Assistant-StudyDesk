// Kiểu dữ liệu khớp với các schema trong backend/app/schemas.

export type Role = "student" | "admin";
export type DeviceStatus = "online" | "offline";
export type SessionStatus = "running" | "paused" | "completed" | "cancelled";
export type PlanStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  created_at: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface AdminCountItem {
  label: string;
  count: number;
}

export interface AdminDailyReadings {
  date: string;
  readings: number;
  avg_temperature: number | null;
  avg_humidity: number | null;
  avg_light_lux: number | null;
}

export interface AdminDailyCount {
  date: string;
  count: number;
}

export interface AdminOverview {
  users: number;
  admins: number;
  devices: number;
  online_devices: number;
  study_sessions: number;
  sensor_readings: number;
  unread_notifications: number;
  recent_users: User[];
}

export interface AdminStats {
  total_users: number;
  admins: number;
  total_devices: number;
  online_devices: number;
  offline_devices: number;
  total_readings: number;
  readings_24h: number;
  alerts_24h: number;
  unread_notifications: number;
  active_sessions: number;
  total_sessions: number;
  total_plans: number;
  total_tokens: number;
  fcm_enabled: boolean;
  mqtt_connected: boolean;
  ai_provider: string;
  auth_provider: string;
  environment: string;
  timezone: string;
  generated_at: string;
  users_by_role: AdminCountItem[];
  alerts_by_type: AdminCountItem[];
  readings_daily: AdminDailyReadings[];
  alerts_daily: AdminDailyCount[];
  users_daily: AdminDailyCount[];
}

export interface AdminOwner {
  id: string;
  email: string;
  name: string;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  supabase_id: string | null;
  daily_goal_minutes: number;
  created_at: string;
  devices_count: number;
  notifications_count: number;
  sessions_count: number;
  plans_count: number;
  last_seen_at: string | null;
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
  alerts_enabled: boolean;
}

export interface AdminReading {
  id: string;
  device_id: string;
  device_code: string;
  device_name: string;
  temperature: number | null;
  humidity: number | null;
  light_raw: number | null;
  light_lux: number | null;
  motion_detected: boolean;
  recorded_at: string;
  received_at: string;
}

export interface AdminDevice {
  id: string;
  device_code: string;
  name: string;
  status: DeviceStatus;
  online: boolean;
  owner: AdminOwner;
  last_seen_at: string | null;
  created_at: string;
  settings: DeviceSettings;
  latest_reading: AdminReading | null;
  readings_count: number;
  notifications_count: number;
}

export interface AdminDeviceDetail extends AdminDevice {
  readings_24h: number;
  alerts_24h: number;
  mqtt_topics: Record<string, string>;
}

export interface AdminNotification {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  device_id: string | null;
  device_code: string | null;
  type: string;
  title: string;
  content: string;
  is_read: boolean;
  created_at: string;
}

export interface AdminSession {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  plan_id: string | null;
  started_at: string;
  ended_at: string | null;
  planned_minutes: number;
  status: SessionStatus;
  duration_seconds: number;
  created_at: string;
}

export interface AdminPlan {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  title: string;
  description: string | null;
  scheduled_start: string | null;
  planned_minutes: number;
  status: PlanStatus;
  reminder_sent_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface AdminUserDetail {
  user: AdminUser;
  devices: AdminDevice[];
  recent_notifications: AdminNotification[];
  recent_sessions: AdminSession[];
}

export interface PushResult {
  enabled: boolean;
  attempted: number;
  sent: number;
  failed: number;
  detail: string | null;
}

export interface AdminSendResult {
  notification: AdminNotification;
  push: PushResult;
}

export interface AdminBroadcastResult {
  recipients: number;
  created: number;
  push: PushResult;
}

export interface AdminDeviceKey {
  device_id: string;
  device_code: string;
  device_key: string;
  mqtt_topics: Record<string, string>;
  detail: string;
}

export interface AdminCommandResult {
  device_id: string;
  device_code: string;
  delivered: boolean;
  topic: string;
  payload: unknown;
  detail: string | null;
}

export interface AdminSystem {
  app_name: string;
  version: string;
  environment: string;
  auth_provider: string;
  ai_provider: string;
  timezone: string;
  api_prefix: string;
  database: string;
  mqtt_connected: boolean;
  mqtt_host: string;
  mqtt_topic_prefix: string;
  fcm_enabled: boolean;
  fcm_project_id: string | null;
  total_users: number;
  total_devices: number;
  total_tokens: number;
  generated_at: string;
}

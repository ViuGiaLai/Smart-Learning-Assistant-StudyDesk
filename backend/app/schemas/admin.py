from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.auth import UserOut
from app.schemas.common import UTCDateTime
from app.schemas.device import CommandResponse, DeviceSettings, DeviceStatusLiteral
from app.schemas.notification import PushResultOut

Role = Literal["student", "admin"]
SessionStatus = Literal["running", "paused", "completed", "cancelled"]
PlanStatus = Literal["pending", "in_progress", "completed", "cancelled"]


# ---------------------------------------------------------------------------
# Overview / dashboard
# ---------------------------------------------------------------------------
class AdminOverview(BaseModel):
    users: int
    admins: int
    devices: int
    online_devices: int = 0
    study_sessions: int
    sensor_readings: int
    unread_notifications: int = 0
    recent_users: list[UserOut]


class AdminCountItem(BaseModel):
    label: str
    count: int


class AdminDailyReadings(BaseModel):
    date: str
    readings: int
    avg_temperature: float | None = None
    avg_humidity: float | None = None
    avg_light_lux: float | None = None


class AdminDailyCount(BaseModel):
    date: str
    count: int


class AdminStatsOut(BaseModel):
    total_users: int
    admins: int
    total_devices: int
    online_devices: int
    offline_devices: int
    total_readings: int
    readings_24h: int
    alerts_24h: int
    unread_notifications: int
    active_sessions: int
    total_sessions: int
    total_plans: int
    total_tokens: int
    fcm_enabled: bool
    mqtt_connected: bool
    ai_provider: str
    auth_provider: str
    environment: str
    timezone: str
    generated_at: UTCDateTime
    users_by_role: list[AdminCountItem]
    alerts_by_type: list[AdminCountItem]
    readings_daily: list[AdminDailyReadings]
    alerts_daily: list[AdminDailyCount]
    users_daily: list[AdminDailyCount]


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------
class AdminUserOut(BaseModel):
    id: str
    email: str
    name: str
    role: Role
    supabase_id: str | None = None
    daily_goal_minutes: int
    created_at: UTCDateTime
    devices_count: int = 0
    notifications_count: int = 0
    sessions_count: int = 0
    plans_count: int = 0
    last_seen_at: UTCDateTime | None = None


class AdminUserPage(BaseModel):
    items: list[AdminUserOut]
    total: int
    page: int
    page_size: int


class AdminUserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    role: Role | None = None
    daily_goal_minutes: int | None = Field(default=None, ge=5, le=1440)


# ---------------------------------------------------------------------------
# Devices / readings
# ---------------------------------------------------------------------------
class AdminOwnerOut(BaseModel):
    id: str
    email: str
    name: str


class AdminReadingOut(BaseModel):
    id: str
    device_id: str
    device_code: str
    device_name: str
    temperature: float | None
    humidity: float | None
    light_raw: int | None
    light_lux: float | None
    motion_detected: bool
    recorded_at: UTCDateTime
    received_at: UTCDateTime


class AdminReadingPage(BaseModel):
    items: list[AdminReadingOut]
    total: int
    page: int
    page_size: int


class AdminDeviceOut(BaseModel):
    id: str
    device_code: str
    name: str
    status: DeviceStatusLiteral
    online: bool
    owner: AdminOwnerOut
    last_seen_at: UTCDateTime | None
    created_at: UTCDateTime
    settings: DeviceSettings
    latest_reading: AdminReadingOut | None = None
    readings_count: int = 0
    notifications_count: int = 0


class AdminDeviceDetail(AdminDeviceOut):
    readings_24h: int = 0
    alerts_24h: int = 0
    mqtt_topics: dict[str, str] = Field(default_factory=dict)


class AdminDevicePage(BaseModel):
    items: list[AdminDeviceOut]
    total: int
    page: int
    page_size: int


class AdminDeviceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    user_id: str | None = None
    settings: dict[str, Any] | None = None


class AdminDeviceKeyOut(BaseModel):
    device_id: str
    device_code: str
    device_key: str
    mqtt_topics: dict[str, str]
    detail: str


class AdminDeviceCommandResult(CommandResponse):
    device_id: str
    device_code: str


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------
class AdminNotificationOut(BaseModel):
    id: str
    user_id: str
    user_email: str
    user_name: str
    device_id: str | None = None
    device_code: str | None = None
    type: str
    title: str
    content: str
    is_read: bool
    created_at: UTCDateTime


class AdminNotificationPage(BaseModel):
    items: list[AdminNotificationOut]
    total: int
    page: int
    page_size: int


class AdminSendRequest(BaseModel):
    user_id: str
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=1000)
    type: str = Field(default="admin_message", min_length=1, max_length=40)


class AdminSendResult(BaseModel):
    notification: AdminNotificationOut
    push: PushResultOut


class AdminBroadcastRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=1000)
    type: str = Field(default="admin_broadcast", min_length=1, max_length=40)
    user_ids: list[str] | None = Field(
        default=None, description="Bỏ trống để gửi cho tất cả người dùng"
    )


class AdminBroadcastResult(BaseModel):
    recipients: int
    created: int
    push: PushResultOut


# ---------------------------------------------------------------------------
# Study sessions / plans
# ---------------------------------------------------------------------------
class AdminSessionOut(BaseModel):
    id: str
    user_id: str
    user_email: str
    user_name: str
    plan_id: str | None
    started_at: UTCDateTime
    ended_at: UTCDateTime | None
    planned_minutes: int
    status: SessionStatus
    duration_seconds: int
    created_at: UTCDateTime


class AdminSessionPage(BaseModel):
    items: list[AdminSessionOut]
    total: int
    page: int
    page_size: int


class AdminPlanOut(BaseModel):
    id: str
    user_id: str
    user_email: str
    user_name: str
    title: str
    description: str | None
    scheduled_start: UTCDateTime | None
    planned_minutes: int
    status: PlanStatus
    reminder_sent_at: UTCDateTime | None
    completed_at: UTCDateTime | None
    created_at: UTCDateTime


class AdminPlanPage(BaseModel):
    items: list[AdminPlanOut]
    total: int
    page: int
    page_size: int


class AdminUserDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user: AdminUserOut
    devices: list[AdminDeviceOut]
    recent_notifications: list[AdminNotificationOut]
    recent_sessions: list[AdminSessionOut]


# ---------------------------------------------------------------------------
# System
# ---------------------------------------------------------------------------
class AdminSystemOut(BaseModel):
    app_name: str
    version: str
    environment: str
    auth_provider: str
    ai_provider: str
    timezone: str
    api_prefix: str
    database: str
    mqtt_connected: bool
    mqtt_host: str
    mqtt_topic_prefix: str
    fcm_enabled: bool
    fcm_project_id: str | None
    total_users: int
    total_devices: int
    total_tokens: int
    generated_at: UTCDateTime

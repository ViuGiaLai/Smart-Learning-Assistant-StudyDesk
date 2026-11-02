from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.device import NotificationOut, SensorReadingOut


class DeviceTokenIn(BaseModel):
    token: str = Field(min_length=20, max_length=512)
    platform: Literal["android", "ios", "web"] = "android"


class DeviceTokenRegistered(BaseModel):
    registered: bool
    platform: str


class DeviceTokenRemove(BaseModel):
    token: str = Field(min_length=20, max_length=512)


class DeviceTokenRemoved(BaseModel):
    unregistered: bool


class PushRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=1000)
    type: str = Field(default="manual", min_length=1, max_length=40)
    data: dict[str, str] | None = None


class SendToUserRequest(PushRequest):
    user_id: str


class PushResultOut(BaseModel):
    enabled: bool
    attempted: int
    sent: int
    failed: int
    detail: str | None = None


class PushDeliveryOut(BaseModel):
    notification: NotificationOut
    push: PushResultOut


class DeviceAlertIn(BaseModel):
    device_id: str | None = Field(default=None, max_length=64)
    message_id: str | None = Field(default=None, max_length=64)
    temperature: float | None = Field(default=None, ge=-40, le=80)
    humidity: float | None = Field(default=None, ge=0, le=100)
    light: int | None = Field(default=None, ge=0, le=4095)
    light_lux: float | None = Field(default=None, ge=0, le=100_000)
    motion: bool = False
    motion_detected: bool | None = None
    alert_type: str = Field(min_length=3, max_length=40)
    timestamp: datetime | None = None


class DeviceAlertAccepted(BaseModel):
    stored: bool
    duplicate: bool
    reading: SensorReadingOut | None = None
    alert: NotificationOut | None = None
    push: PushResultOut

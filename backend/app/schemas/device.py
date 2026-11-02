from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool

from app.db.models import DEFAULT_DEVICE_SETTINGS
from app.schemas.common import UTCDateTime

DeviceStatusLiteral = Literal["online", "offline"]


class DeviceSettings(BaseModel):
    """User-configurable thresholds and privacy switches."""

    temperature_min: float = Field(DEFAULT_DEVICE_SETTINGS["temperature_min"], ge=-20, le=60)
    temperature_max: float = Field(DEFAULT_DEVICE_SETTINGS["temperature_max"], ge=-20, le=60)
    humidity_min: float = Field(DEFAULT_DEVICE_SETTINGS["humidity_min"], ge=0, le=100)
    humidity_max: float = Field(DEFAULT_DEVICE_SETTINGS["humidity_max"], ge=0, le=100)
    light_min_lux: float = Field(DEFAULT_DEVICE_SETTINGS["light_min_lux"], ge=0, le=5000)
    no_motion_minutes: int = Field(DEFAULT_DEVICE_SETTINGS["no_motion_minutes"], ge=1, le=180)
    collection_enabled: bool = DEFAULT_DEVICE_SETTINGS["collection_enabled"]
    auto_control: bool = DEFAULT_DEVICE_SETTINGS["auto_control"]
    sample_interval_seconds: int = Field(
        DEFAULT_DEVICE_SETTINGS["sample_interval_seconds"], ge=2, le=300
    )

    def merged(self, overrides: dict[str, Any]) -> DeviceSettings:
        return DeviceSettings(**{**self.model_dump(), **overrides})


class DeviceRegisterRequest(BaseModel):
    device_code: str = Field(
        min_length=3,
        max_length=64,
        pattern=r"^[A-Za-z0-9_-]+$",
        description="Stable hardware identifier, e.g. STUDY_DESK_001",
    )
    name: str = Field(default="Bàn học", min_length=1, max_length=120)


class DeviceUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    settings: dict[str, Any] | None = Field(
        default=None, description="Partial settings object, merged with current values"
    )


class DeviceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    device_code: str
    name: str
    status: DeviceStatusLiteral
    last_seen_at: UTCDateTime | None
    settings: DeviceSettings
    created_at: UTCDateTime


class DeviceRegisteredOut(DeviceOut):
    # Returned exactly once. The server only keeps a SHA-256 hash.
    device_key: str
    mqtt_username: str
    mqtt_topics: dict[str, str]


class DeviceStatusOut(BaseModel):
    id: str
    device_code: str
    status: DeviceStatusLiteral
    online: bool
    last_seen_at: UTCDateTime | None
    seconds_since_last_seen: int | None
    sample_interval_seconds: int
    collection_enabled: bool


CommandAction = Literal["set_led", "set_buzzer", "set_alerts", "set_thresholds", "ping"]


class CommandRequest(BaseModel):
    action: CommandAction
    value: StrictBool | dict[str, Any] | None = None


class CommandResponse(BaseModel):
    delivered: bool
    topic: str
    payload: dict[str, Any]
    detail: str | None = None


class SensorReadingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    device_id: str
    message_id: str
    temperature: float | None
    humidity: float | None
    light_raw: int | None
    light_lux: float | None
    motion_detected: bool
    recorded_at: UTCDateTime
    received_at: UTCDateTime


class ReadingPage(BaseModel):
    items: list[SensorReadingOut]
    total: int
    limit: int
    offset: int


class TelemetryIn(BaseModel):
    """Payload published by the ESP32 on `smartstudy/{device_code}/telemetry`."""

    message_id: str | None = Field(
        default=None,
        max_length=64,
        description="Idempotency key. Firmware should keep it stable when retrying.",
    )
    temperature: float | None = Field(default=None, ge=-40, le=80)
    humidity: float | None = Field(default=None, ge=0, le=100)
    light: int | None = Field(
        default=None, ge=0, le=4095, description="Raw LDR ADC value (0-4095)"
    )
    light_lux: float | None = Field(default=None, ge=0, le=100_000)
    motion_detected: bool = False
    timestamp: datetime | None = Field(
        default=None, description="Device time (ISO-8601). Server time is authoritative."
    )


class AlertOut(BaseModel):
    type: str
    title: str
    content: str


class TelemetryAccepted(BaseModel):
    stored: bool
    duplicate: bool
    collection_enabled: bool
    reading: SensorReadingOut | None = None
    alerts: list[AlertOut] = Field(default_factory=list)


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    type: str
    title: str
    content: str
    is_read: bool
    device_id: str | None
    created_at: UTCDateTime

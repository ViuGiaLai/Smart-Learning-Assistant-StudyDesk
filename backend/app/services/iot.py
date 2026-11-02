from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.time import utcnow
from app.db.models import (
    DEFAULT_DEVICE_SETTINGS,
    Device,
    Notification,
    SensorReading,
)
from app.schemas.device import SensorReadingOut, TelemetryIn
from app.services import alerts as alert_service
from app.services.realtime import manager
from app.services.sensors import estimate_lux
from app.services.stats import clamp_device_timestamp, reading_fingerprint

logger = logging.getLogger(__name__)


@dataclass
class IngestResult:
    stored: bool
    duplicate: bool
    collection_enabled: bool
    reading: SensorReading | None = None
    alerts: list[dict] = field(default_factory=list)


def device_settings(device: Device) -> dict:
    return {**DEFAULT_DEVICE_SETTINGS, **(device.settings or {})}


def serialize_reading(reading: SensorReading) -> dict:
    return SensorReadingOut.model_validate(reading).model_dump(mode="json")


async def ingest_telemetry(
    db: AsyncSession, device: Device, payload: TelemetryIn, *, source: str = "http"
) -> IngestResult:
    """Idempotent telemetry ingestion shared by MQTT and the HTTP fallback.

    * dedupe on (device_id, message_id)
    * server time is authoritative, device clock is clamped
    * respects the owner's "stop collecting" switch
    """
    now = utcnow()
    conf = device_settings(device)
    was_offline = device.status != "online"
    device.status = "online"
    device.last_seen_at = now

    message_id = (payload.message_id or "").strip()
    if not message_id:
        message_id = reading_fingerprint(payload.model_dump())

    if not conf.get("collection_enabled", True):
        await db.commit()
        if was_offline:
            await broadcast_status(device)
        return IngestResult(stored=False, duplicate=False, collection_enabled=False)

    # Fast path: reject resends before doing any work.
    existing = await db.scalar(
        select(SensorReading).where(
            SensorReading.device_id == device.id,
            SensorReading.message_id == message_id,
        )
    )
    if existing is not None:
        await db.commit()
        if was_offline:
            await broadcast_status(device)
        return IngestResult(
            stored=False,
            duplicate=True,
            collection_enabled=True,
            reading=existing,
        )

    light_raw = payload.light
    light_lux = payload.light_lux
    if light_lux is None and light_raw is not None:
        light_lux = estimate_lux(light_raw)

    reading = SensorReading(
        device_id=device.id,
        message_id=message_id[:64],
        temperature=payload.temperature,
        humidity=payload.humidity,
        light_raw=light_raw,
        light_lux=light_lux,
        motion_detected=payload.motion_detected,
        recorded_at=clamp_device_timestamp(
            payload.timestamp, max_skew_seconds=settings.max_clock_skew_seconds
        ),
        received_at=now,
    )
    db.add(reading)
    try:
        await db.flush()
    except IntegrityError:
        # Concurrent duplicate (MQTT retry racing an HTTP fallback).
        await db.rollback()
        existing = await db.scalar(
            select(SensorReading).where(
                SensorReading.device_id == device.id,
                SensorReading.message_id == message_id,
            )
        )
        return IngestResult(
            stored=False, duplicate=True, collection_enabled=True, reading=existing
        )

    created_alerts = await alert_service.evaluate_environment_alerts(db, device, reading)
    await db.commit()

    if was_offline:
        await broadcast_status(device)

    await manager.broadcast(
        device.id,
        {
            "event": "telemetry",
            "device_id": device.id,
            "source": source,
            "data": serialize_reading(reading),
            "alerts": created_alerts,
        },
    )
    for alert in created_alerts:
        await manager.broadcast(
            device.id,
            {"event": "alert", "device_id": device.id, "data": alert},
        )

    if created_alerts:
        # Avoid a missing-coroutine import cycle: the MQTT service is lazy here.
        await alert_service.auto_control_alert_outputs(device, created_alerts)

    return IngestResult(
        stored=True,
        duplicate=False,
        collection_enabled=True,
        reading=reading,
        alerts=created_alerts,
    )


async def broadcast_status(device: Device) -> None:
    await manager.broadcast(
        device.id,
        {
            "event": "device_status",
            "device_id": device.id,
            "data": {
                "status": device.status,
                "last_seen_at": device.last_seen_at.isoformat() + "Z"
                if device.last_seen_at
                else None,
            },
        },
    )


async def mark_stale_devices_offline(db: AsyncSession) -> int:
    """Called periodically by the offline watchdog."""
    cutoff = utcnow() - timedelta(seconds=settings.device_offline_after_seconds)
    result = await db.execute(
        select(Device).where(
            Device.status == "online",
            (Device.last_seen_at.is_(None)) | (Device.last_seen_at < cutoff),
        )
    )
    devices = list(result.scalars().all())
    for device in devices:
        device.status = "offline"
        db.add(
            Notification(
                user_id=device.user_id,
                device_id=device.id,
                type="device_offline",
                title="Thiết bị mất kết nối",
                content=f"Thiết bị {device.name} ({device.device_code}) không gửi dữ liệu "
                f"trong hơn {settings.device_offline_after_seconds} giây.",
            )
        )
    if devices:
        await db.commit()
        for device in devices:
            await broadcast_status(device)
    return len(devices)

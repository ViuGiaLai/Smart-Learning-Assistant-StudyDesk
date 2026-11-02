from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession, get_owned_device
from app.core.config import settings
from app.core.security import hash_device_key
from app.core.time import to_naive_utc, utcnow
from app.db.models import Device, SensorReading, new_device_key
from app.schemas.device import (
    CommandRequest,
    CommandResponse,
    DeviceOut,
    DeviceRegisteredOut,
    DeviceRegisterRequest,
    DeviceSettings,
    DeviceStatusOut,
    DeviceUpdateRequest,
    ReadingPage,
    SensorReadingOut,
)
from app.services.mqtt import mqtt_service

router = APIRouter(prefix="/devices", tags=["Devices"])


def _is_online(device: Device) -> bool:
    if device.status != "online" or device.last_seen_at is None:
        return False
    age = (utcnow() - device.last_seen_at).total_seconds()
    return age <= settings.device_offline_after_seconds


def _merged_settings(device: Device) -> dict[str, Any]:
    from app.db.models import DEFAULT_DEVICE_SETTINGS

    return {**DEFAULT_DEVICE_SETTINGS, **(device.settings or {})}


@router.post("/register", response_model=DeviceRegisteredOut, status_code=201)
async def register_device(
    payload: DeviceRegisterRequest, user: CurrentUser, db: DbSession
) -> DeviceRegisteredOut:
    device_code = payload.device_code.upper()
    if await db.scalar(select(Device.id).where(Device.device_code == device_code)):
        raise HTTPException(status_code=409, detail="Mã thiết bị đã tồn tại")

    device_key = new_device_key()
    device = Device(
        user_id=user.id,
        device_code=device_code,
        name=payload.name,
        device_key_hash=hash_device_key(device_key),
        settings=dict(DeviceSettings().model_dump()),
    )
    db.add(device)
    await db.commit()
    await db.refresh(device)

    base = DeviceOut.model_validate(device).model_dump()
    return DeviceRegisteredOut(
        **base,
        device_key=device_key,
        mqtt_username=device_code,
        mqtt_topics={
            "telemetry": f"{settings.mqtt_topic_prefix}/{device_code}/telemetry",
            "command": f"{settings.mqtt_topic_prefix}/{device_code}/command",
            "status": f"{settings.mqtt_topic_prefix}/{device_code}/status",
        },
    )


@router.get("", response_model=list[DeviceOut])
async def list_devices(user: CurrentUser, db: DbSession) -> list[DeviceOut]:
    result = await db.execute(
        select(Device).where(Device.user_id == user.id).order_by(Device.created_at)
    )
    return [DeviceOut.model_validate(device) for device in result.scalars().all()]


@router.get("/{device_id}/status", response_model=DeviceStatusOut)
async def device_status(device_id: str, user: CurrentUser, db: DbSession) -> DeviceStatusOut:
    device = await get_owned_device(device_id, user, db)
    conf = _merged_settings(device)
    seconds = (
        int((utcnow() - device.last_seen_at).total_seconds()) if device.last_seen_at else None
    )
    return DeviceStatusOut(
        id=device.id,
        device_code=device.device_code,
        status="online" if _is_online(device) else "offline",
        online=_is_online(device),
        last_seen_at=device.last_seen_at,
        seconds_since_last_seen=seconds,
        sample_interval_seconds=int(conf["sample_interval_seconds"]),
        collection_enabled=bool(conf["collection_enabled"]),
    )


@router.patch("/{device_id}", response_model=DeviceOut)
async def update_device(
    device_id: str, payload: DeviceUpdateRequest, user: CurrentUser, db: DbSession
) -> DeviceOut:
    device = await get_owned_device(device_id, user, db)
    if payload.name is not None:
        device.name = payload.name
    if payload.settings is not None:
        merged = _merged_settings(device)
        merged.update(payload.settings)
        try:
            validated = DeviceSettings.model_validate(merged)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        device.settings = validated.model_dump()
        await mqtt_service.send_command(
            device.device_code,
            {"action": "set_thresholds", "value": validated.model_dump()},
        )
    await db.commit()
    await db.refresh(device)
    return DeviceOut.model_validate(device)


@router.delete("/{device_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def delete_device(device_id: str, user: CurrentUser, db: DbSession) -> Response:
    device = await get_owned_device(device_id, user, db)
    await db.delete(device)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{device_id}/readings", response_model=ReadingPage)
async def list_readings(
    device_id: str,
    user: CurrentUser,
    db: DbSession,
    start: datetime | None = Query(default=None, alias="from"),
    end: datetime | None = Query(default=None, alias="to"),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> ReadingPage:
    device = await get_owned_device(device_id, user, db)

    filters = [SensorReading.device_id == device.id]
    start_naive = to_naive_utc(start)
    end_naive = to_naive_utc(end)
    if start_naive:
        filters.append(SensorReading.recorded_at >= start_naive)
    if end_naive:
        filters.append(SensorReading.recorded_at <= end_naive)

    total = await db.scalar(select(func.count(SensorReading.id)).where(*filters))
    result = await db.execute(
        select(SensorReading)
        .where(*filters)
        .order_by(SensorReading.recorded_at.desc())
        .limit(limit)
        .offset(offset)
    )
    items = [SensorReadingOut.model_validate(row) for row in result.scalars().all()]
    return ReadingPage(items=items, total=int(total or 0), limit=limit, offset=offset)


@router.get("/{device_id}/readings/latest", response_model=SensorReadingOut | None)
async def latest_reading(
    device_id: str, user: CurrentUser, db: DbSession
) -> SensorReadingOut | None:
    device = await get_owned_device(device_id, user, db)
    reading = await db.scalar(
        select(SensorReading)
        .where(SensorReading.device_id == device.id)
        .order_by(SensorReading.recorded_at.desc())
        .limit(1)
    )
    return SensorReadingOut.model_validate(reading) if reading else None


@router.post("/{device_id}/commands", response_model=CommandResponse, status_code=202)
async def send_command(
    device_id: str, payload: CommandRequest, user: CurrentUser, db: DbSession
) -> CommandResponse:
    device = await get_owned_device(device_id, user, db)
    topic = f"{settings.mqtt_topic_prefix}/{device.device_code}/command"

    if payload.action in {"set_led", "set_buzzer", "set_alerts"} and not isinstance(
        payload.value, bool
    ):
        raise HTTPException(status_code=422, detail="value phải là true/false")
    if payload.action == "set_thresholds":
        if not isinstance(payload.value, dict):
            raise HTTPException(status_code=422, detail="value phải là object ngưỡng")
        merged = _merged_settings(device)
        merged.update(payload.value)
        validated = DeviceSettings.model_validate(merged)
        device.settings = validated.model_dump()
        await db.commit()
        payload.value = validated.model_dump()

    delivered = await mqtt_service.send_command(
        device.device_code, {"action": payload.action, "value": payload.value}
    )
    return CommandResponse(
        delivered=delivered,
        topic=topic,
        payload={"action": payload.action, "value": payload.value},
        detail=None if delivered else "MQTT chưa kết nối; lệnh chưa được gửi tới thiết bị",
    )

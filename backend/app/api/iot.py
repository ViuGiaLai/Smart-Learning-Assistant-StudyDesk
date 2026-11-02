from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_device_by_credentials
from app.core.config import settings
from app.db.base import get_db
from app.db.models import Device, Notification
from app.schemas.device import NotificationOut, SensorReadingOut, TelemetryAccepted, TelemetryIn
from app.schemas.notification import DeviceAlertAccepted, DeviceAlertIn, PushResultOut
from app.services import alerts as alert_service
from app.services import fcm, iot
from app.services.realtime import manager
from app.services.sensors import estimate_lux

router = APIRouter(prefix="/iot", tags=["IoT ingestion"])


def _push_out(result: fcm.PushResult) -> PushResultOut:
    return PushResultOut(
        enabled=result.enabled,
        attempted=result.attempted,
        sent=result.sent,
        failed=result.failed,
        detail=result.detail,
    )


@router.post(
    "/telemetry",
    response_model=TelemetryAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    summary="HTTP fallback for devices that cannot use MQTT",
    description=(
        "Requires headers `X-Device-Code` and `X-Device-Key`. "
        "MQTT is the primary transport; this endpoint is useful on restricted Wi-Fi "
        "and for integration tests."
    ),
)
async def ingest_telemetry(
    payload: TelemetryIn,
    device: Device = Depends(get_device_by_credentials),
    db: AsyncSession = Depends(get_db),
) -> TelemetryAccepted:
    result = await iot.ingest_telemetry(db, device, payload, source="http")
    return TelemetryAccepted(
        stored=result.stored,
        duplicate=result.duplicate,
        collection_enabled=result.collection_enabled,
        reading=SensorReadingOut.model_validate(result.reading) if result.reading else None,
        alerts=result.alerts,
    )


@router.post(
    "/alerts",
    response_model=DeviceAlertAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    summary="ESP32-reported alert (LAB3)",
    description=(
        "Requires `X-Device-Code` and `X-Device-Key`. Stores telemetry, creates a "
        "notification and sends an FCM push to the owner's registered devices."
    ),
)
async def ingest_device_alert(
    payload: DeviceAlertIn,
    device: Device = Depends(get_device_by_credentials),
    db: AsyncSession = Depends(get_db),
) -> DeviceAlertAccepted:
    telemetry = TelemetryIn(
        message_id=payload.message_id,
        temperature=payload.temperature,
        humidity=payload.humidity,
        light=payload.light,
        light_lux=payload.light_lux,
        motion_detected=(
            payload.motion_detected
            if payload.motion_detected is not None
            else payload.motion
        ),
        timestamp=payload.timestamp,
    )
    result = await iot.ingest_telemetry(
        db, device, telemetry, source="http-alert", evaluate_alerts=False
    )

    alert_out = None
    push_out = PushResultOut(
        enabled=settings.fcm_enabled,
        attempted=0,
        sent=0,
        failed=0,
        detail="Không tạo cảnh báo mới",
    )

    if result.collection_enabled:
        light_lux = payload.light_lux
        if light_lux is None and payload.light is not None:
            light_lux = estimate_lux(payload.light)
        alert_type, title, content = alert_service.reported_alert_copy(
            payload.alert_type,
            temperature=payload.temperature,
            humidity=payload.humidity,
            light_lux=light_lux,
        )
        notification: Notification | None = await alert_service.create_reported_alert(
            db, device, alert_type, title, content
        )
        if notification is not None:
            alert_out = NotificationOut.model_validate(notification)
            push_out = _push_out(
                await fcm.send_to_user(
                    db,
                    device.user_id,
                    notification.title,
                    notification.content,
                    {
                        "type": notification.type,
                        "device_id": device.id,
                        "device_code": device.device_code,
                        "notification_id": notification.id,
                    },
                )
            )
            await manager.broadcast(
                device.id,
                {
                    "event": "alert",
                    "device_id": device.id,
                    "data": {
                        "type": notification.type,
                        "title": notification.title,
                        "content": notification.content,
                    },
                },
            )
        else:
            push_out.detail = "Cảnh báo đang trong thời gian chờ hoặc thu thập đang tắt"

    return DeviceAlertAccepted(
        stored=result.stored,
        duplicate=result.duplicate,
        reading=SensorReadingOut.model_validate(result.reading) if result.reading else None,
        alert=alert_out,
        push=push_out,
    )

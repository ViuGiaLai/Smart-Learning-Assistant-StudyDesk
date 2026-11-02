from __future__ import annotations

import logging
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.time import utcnow
from app.db.models import Device, Notification, SensorReading, StudySession

logger = logging.getLogger(__name__)


async def _already_alerted(
    db: AsyncSession, device_id: str, alert_type: str, cooldown_seconds: int
) -> bool:
    since = utcnow() - timedelta(seconds=cooldown_seconds)
    result = await db.execute(
        select(Notification.id)
        .where(
            Notification.device_id == device_id,
            Notification.type == alert_type,
            Notification.created_at >= since,
        )
        .limit(1)
    )
    return result.scalar_one_or_none() is not None


def _settings(device: Device) -> dict:
    from app.db.models import DEFAULT_DEVICE_SETTINGS

    return {**DEFAULT_DEVICE_SETTINGS, **(device.settings or {})}


async def evaluate_environment_alerts(
    db: AsyncSession, device: Device, reading: SensorReading
) -> list[dict]:
    """Create notifications for threshold violations, with a cooldown.

    Returns lightweight alert dicts for the WebSocket payload.
    """
    if not _settings(device).get("collection_enabled", True):
        return []

    thresholds = _settings(device)
    alerts: list[tuple[str, str, str]] = []

    temperature = reading.temperature
    if temperature is not None:
        if temperature > thresholds["temperature_max"]:
            alerts.append(
                (
                    "temperature_high",
                    "Nhiệt độ phòng đang cao",
                    f"Nhiệt độ {temperature:.1f}°C vượt ngưỡng "
                    f"{thresholds['temperature_max']:.0f}°C. Hãy mở cửa hoặc bật quạt.",
                )
            )
        elif temperature < thresholds["temperature_min"]:
            alerts.append(
                (
                    "temperature_low",
                    "Nhiệt độ phòng đang thấp",
                    f"Nhiệt độ {temperature:.1f}°C dưới ngưỡng "
                    f"{thresholds['temperature_min']:.0f}°C. Hãy giữ ấm khi học.",
                )
            )

    humidity = reading.humidity
    if humidity is not None:
        if humidity > thresholds["humidity_max"]:
            alerts.append(
                (
                    "humidity_high",
                    "Độ ẩm cao",
                    f"Độ ẩm {humidity:.0f}% vượt ngưỡng {thresholds['humidity_max']:.0f}%. "
                    "Phòng ẩm có thể gây mất tập trung.",
                )
            )
        elif humidity < thresholds["humidity_min"]:
            alerts.append(
                (
                    "humidity_low",
                    "Độ ẩm thấp",
                    f"Độ ẩm {humidity:.0f}% dưới ngưỡng {thresholds['humidity_min']:.0f}%. "
                    "Hãy bổ sung nước hoặc bật máy tạo ẩm.",
                )
            )

    light = reading.light_lux
    if light is not None and light < thresholds["light_min_lux"]:
        alerts.append(
            (
                "light_low",
                "Ánh sáng bàn học chưa đủ",
                f"Cường độ sáng khoảng {light:.0f} lux, thấp hơn ngưỡng "
                f"{thresholds['light_min_lux']:.0f} lux. Hãy bật hoặc điều chỉnh đèn bàn.",
            )
        )

    # "No motion while studying" needs a running session to avoid false alarms.
    running = await db.scalar(
        select(StudySession.id)
        .where(StudySession.user_id == device.user_id, StudySession.status == "running")
        .limit(1)
    )
    if running and not reading.motion_detected:
        window_start = utcnow() - timedelta(minutes=thresholds["no_motion_minutes"])
        last_motion = await db.scalar(
            select(SensorReading.recorded_at)
            .where(
                SensorReading.device_id == device.id,
                SensorReading.motion_detected.is_(True),
                SensorReading.recorded_at >= window_start,
            )
            .order_by(SensorReading.recorded_at.desc())
            .limit(1)
        )
        if last_motion is None:
            alerts.append(
                (
                    "no_motion",
                    "Không thấy chuyển động tại bàn học",
                    f"Đã {thresholds['no_motion_minutes']} phút không phát hiện chuyển động "
                    "trong phiên học. Bạn có đang tạm nghỉ không?",
                )
            )

    created: list[dict] = []
    for alert_type, title, content in alerts:
        if await _already_alerted(db, device.id, alert_type, settings.alert_cooldown_seconds):
            continue
        db.add(
            Notification(
                user_id=device.user_id,
                device_id=device.id,
                type=alert_type,
                title=title,
                content=content,
            )
        )
        created.append({"type": alert_type, "title": title, "content": content})

    if created:
        logger.info("device=%s alerts=%s", device.device_code, [a["type"] for a in created])
    return created


async def auto_control_alert_outputs(device: Device, alerts: list[dict]) -> None:
    """Turn the desk LED on when the environment needs attention.

    Imported lazily to avoid a circular import with the MQTT service.
    """
    from app.services.mqtt import mqtt_service

    if not _settings(device).get("auto_control", True) or not alerts:
        return
    await mqtt_service.send_command(device.device_code, {"action": "set_led", "value": True})


def reported_alert_copy(
    alert_type: str,
    *,
    temperature: float | None,
    humidity: float | None,
    light_lux: float | None,
) -> tuple[str, str, str]:
    """Map the firmware's alert code to a notification type/title/content."""
    normalized = alert_type.strip().upper().replace("-", "_")

    if normalized == "HIGH_TEMPERATURE":
        value = f"{temperature:.1f}°C" if temperature is not None else "cao"
        return (
            "temperature_high",
            "Nhiệt độ phòng đang cao",
            f"Thiết bị báo nhiệt độ {value}, vượt ngưỡng cài đặt. "
            "Hãy mở cửa hoặc bật quạt để dễ tập trung.",
        )
    if normalized == "LOW_TEMPERATURE":
        value = f"{temperature:.1f}°C" if temperature is not None else "thấp"
        return (
            "temperature_low",
            "Nhiệt độ phòng đang thấp",
            f"Thiết bị báo nhiệt độ {value}, dưới ngưỡng cài đặt. Hãy giữ ấm khi học.",
        )
    if normalized == "HIGH_HUMIDITY":
        value = f"{humidity:.0f}%" if humidity is not None else "cao"
        return (
            "humidity_high",
            "Độ ẩm cao",
            f"Thiết bị báo độ ẩm {value}, vượt ngưỡng cài đặt. Hãy thông gió phòng học.",
        )
    if normalized == "LOW_HUMIDITY":
        value = f"{humidity:.0f}%" if humidity is not None else "thấp"
        return (
            "humidity_low",
            "Độ ẩm thấp",
            f"Thiết bị báo độ ẩm {value}, dưới ngưỡng cài đặt. Hãy bổ sung nước.",
        )
    if normalized == "LOW_LIGHT":
        value = f"{light_lux:.0f} lux" if light_lux is not None else "thấp"
        return (
            "light_low",
            "Ánh sáng bàn học chưa đủ",
            f"Thiết bị báo cường độ sáng {value}, dưới ngưỡng cài đặt. Hãy bật đèn bàn.",
        )
    if normalized in {"MOTION_DETECTED", "MOTION"}:
        return (
            "motion_detected",
            "Phát hiện chuyển động tại bàn học",
            "Cảm biến PIR vừa phát hiện chuyển động. Nếu bạn đang học, hãy tiếp tục "
            "duy trì tập trung.",
        )
    if normalized == "DEVICE_OFFLINE":
        return (
            "device_offline",
            "Thiết bị mất kết nối",
            "Thiết bị báo mất kết nối. Hãy kiểm tra nguồn và Wi-Fi của ESP32.",
        )

    slug = normalized.lower()[:40] or "device_alert"
    return slug, "Cảnh báo từ thiết bị", f"Thiết bị báo sự kiện {alert_type}."


async def create_reported_alert(
    db: AsyncSession,
    device: Device,
    alert_type: str,
    title: str,
    content: str,
) -> Notification | None:
    """Create a notification reported by the device, respecting cooldown."""
    if not _settings(device).get("collection_enabled", True):
        return None
    if await _already_alerted(
        db, device.id, alert_type, settings.alert_cooldown_seconds
    ):
        return None

    notification = Notification(
        user_id=device.user_id,
        device_id=device.id,
        type=alert_type[:40],
        title=title[:200],
        content=content[:1000],
    )
    db.add(notification)
    await db.commit()
    await db.refresh(notification)
    logger.info("device=%s reported_alert=%s", device.device_code, alert_type)
    return notification

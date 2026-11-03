from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Response, status
from pydantic import BaseModel
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentAdmin, DbSession
from app.core.config import settings
from app.core.security import hash_device_key
from app.core.time import utcnow
from app.db.models import (
    DEFAULT_DEVICE_SETTINGS,
    AIConversation,
    Device,
    DeviceToken,
    Notification,
    SensorReading,
    StudyPlan,
    StudySession,
    User,
    new_device_key,
)
from app.schemas.admin import (
    AdminBroadcastRequest,
    AdminBroadcastResult,
    AdminCountItem,
    AdminDailyCount,
    AdminDailyReadings,
    AdminDeviceCommandResult,
    AdminDeviceDetail,
    AdminDeviceKeyOut,
    AdminDeviceOut,
    AdminDevicePage,
    AdminDeviceUpdate,
    AdminNotificationOut,
    AdminNotificationPage,
    AdminOverview,
    AdminOwnerOut,
    AdminPlanOut,
    AdminPlanPage,
    AdminReadingOut,
    AdminReadingPage,
    AdminSendRequest,
    AdminSendResult,
    AdminSessionOut,
    AdminSessionPage,
    AdminStatsOut,
    AdminSystemOut,
    AdminUserDetail,
    AdminUserOut,
    AdminUserPage,
    AdminUserUpdate,
)
from app.schemas.auth import UserOut
from app.schemas.device import CommandRequest, DeviceSettings
from app.schemas.notification import PushResultOut
from app.services import fcm
from app.services.mqtt import mqtt_service
from app.services.stats import (
    app_tz,
    local_date_key,
    local_day_bounds_utc,
    session_duration_seconds,
)

router = APIRouter(prefix="/admin", tags=["Administration"])

APP_VERSION = "0.1.0"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _is_online(device: Device, now: datetime | None = None) -> bool:
    if device.status != "online" or device.last_seen_at is None:
        return False
    now = now or utcnow()
    return (now - device.last_seen_at).total_seconds() <= settings.device_offline_after_seconds


def _online_condition(now: datetime) -> Any:
    cutoff = now - timedelta(seconds=settings.device_offline_after_seconds)
    return (Device.status == "online") & (Device.last_seen_at.is_not(None)) & (
        Device.last_seen_at >= cutoff
    )


def _merged_settings(device: Device) -> DeviceSettings:
    return DeviceSettings.model_validate(
        {**DEFAULT_DEVICE_SETTINGS, **(device.settings or {})}
    )


def _mqtt_topics(device_code: str) -> dict[str, str]:
    prefix = settings.mqtt_topic_prefix
    return {
        "telemetry": f"{prefix}/{device_code}/telemetry",
        "command": f"{prefix}/{device_code}/command",
        "status": f"{prefix}/{device_code}/status",
    }


def _owner(user: User) -> AdminOwnerOut:
    return AdminOwnerOut(id=user.id, email=user.email, name=user.name)


def _reading_out(reading: SensorReading, device: Device) -> AdminReadingOut:
    return AdminReadingOut(
        id=reading.id,
        device_id=device.id,
        device_code=device.device_code,
        device_name=device.name,
        temperature=reading.temperature,
        humidity=reading.humidity,
        light_raw=reading.light_raw,
        light_lux=reading.light_lux,
        motion_detected=reading.motion_detected,
        recorded_at=reading.recorded_at,
        received_at=reading.received_at,
    )


def _device_out(
    device: Device,
    owner: User,
    latest: SensorReading | None,
    readings_count: int,
    notifications_count: int,
) -> AdminDeviceOut:
    online = _is_online(device)
    return AdminDeviceOut(
        id=device.id,
        device_code=device.device_code,
        name=device.name,
        status="online" if online else "offline",
        online=online,
        owner=_owner(owner),
        last_seen_at=device.last_seen_at,
        created_at=device.created_at,
        settings=_merged_settings(device),
        latest_reading=_reading_out(latest, device) if latest else None,
        readings_count=readings_count,
        notifications_count=notifications_count,
    )


def _push_out(result: fcm.PushResult) -> PushResultOut:
    return PushResultOut(
        enabled=result.enabled,
        attempted=result.attempted,
        sent=result.sent,
        failed=result.failed,
        detail=result.detail,
    )


async def _count_map(
    db: AsyncSession, model, column, ids: list[str]
) -> dict[str, int]:
    if not ids:
        return {}
    rows = await db.execute(
        select(column, func.count(model.id)).where(column.in_(ids)).group_by(column)
    )
    return {str(key): int(count) for key, count in rows.all()}


async def _latest_user_seen(db: AsyncSession, ids: list[str]) -> dict[str, datetime]:
    if not ids:
        return {}
    rows = await db.execute(
        select(Device.user_id, func.max(Device.last_seen_at))
        .where(Device.user_id.in_(ids))
        .group_by(Device.user_id)
    )
    return {str(key): value for key, value in rows.all() if value is not None}


async def _user_out(db: AsyncSession, user: User) -> AdminUserOut:
    devices_count = await _count_map(db, Device, Device.user_id, [user.id])
    notifications_count = await _count_map(
        db, Notification, Notification.user_id, [user.id]
    )
    sessions_count = await _count_map(db, StudySession, StudySession.user_id, [user.id])
    plans_count = await _count_map(db, StudyPlan, StudyPlan.user_id, [user.id])
    last_seen = await _latest_user_seen(db, [user.id])
    return AdminUserOut(
        id=user.id,
        email=user.email,
        name=user.name,
        role=user.role,  # type: ignore[arg-type]
        supabase_id=user.supabase_id,
        daily_goal_minutes=user.daily_goal_minutes,
        created_at=user.created_at,
        devices_count=devices_count.get(user.id, 0),
        notifications_count=notifications_count.get(user.id, 0),
        sessions_count=sessions_count.get(user.id, 0),
        plans_count=plans_count.get(user.id, 0),
        last_seen_at=last_seen.get(user.id),
    )


def _device_query():
    """Device + owner + latest reading in one query."""
    latest_id = (
        select(SensorReading.id)
        .where(SensorReading.device_id == Device.id)
        .order_by(SensorReading.recorded_at.desc())
        .limit(1)
        .correlate(Device)
        .scalar_subquery()
    )
    return (
        select(Device, User, SensorReading)
        .join(User, Device.user_id == User.id)
        .outerjoin(SensorReading, SensorReading.id == latest_id)
    )


async def _device_rows(
    db: AsyncSession, filters: list[Any], *, offset: int = 0, limit: int = 100
) -> list[AdminDeviceOut]:
    rows = (
        await db.execute(
            _device_query()
            .where(*filters)
            .order_by(Device.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
    ).all()
    ids = [device.id for device, _, _ in rows]
    reading_counts = await _count_map(db, SensorReading, SensorReading.device_id, ids)
    notification_counts = await _count_map(
        db, Notification, Notification.device_id, ids
    )
    return [
        _device_out(
            device,
            owner,
            latest,
            reading_counts.get(device.id, 0),
            notification_counts.get(device.id, 0),
        )
        for device, owner, latest in rows
    ]


async def _device_detail(db: AsyncSession, device: Device) -> AdminDeviceDetail:
    owner = await db.get(User, device.user_id)
    if owner is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy chủ thiết bị")
    latest = await db.scalar(
        select(SensorReading)
        .where(SensorReading.device_id == device.id)
        .order_by(SensorReading.recorded_at.desc())
        .limit(1)
    )
    readings_count = int(
        await db.scalar(
            select(func.count(SensorReading.id)).where(
                SensorReading.device_id == device.id
            )
        )
        or 0
    )
    notifications_count = int(
        await db.scalar(
            select(func.count(Notification.id)).where(Notification.device_id == device.id)
        )
        or 0
    )
    since = utcnow() - timedelta(hours=24)
    readings_24h = int(
        await db.scalar(
            select(func.count(SensorReading.id)).where(
                SensorReading.device_id == device.id,
                SensorReading.received_at >= since,
            )
        )
        or 0
    )
    alerts_24h = int(
        await db.scalar(
            select(func.count(Notification.id)).where(
                Notification.device_id == device.id,
                Notification.created_at >= since,
            )
        )
        or 0
    )
    base = _device_out(
        device, owner, latest, readings_count, notifications_count
    )
    return AdminDeviceDetail(
        **base.model_dump(),
        readings_24h=readings_24h,
        alerts_24h=alerts_24h,
        mqtt_topics=_mqtt_topics(device.device_code),
    )


async def _notification_out(
    db: AsyncSession, notification: Notification
) -> AdminNotificationOut:
    user = await db.get(User, notification.user_id)
    device = (
        await db.get(Device, notification.device_id)
        if notification.device_id
        else None
    )
    return AdminNotificationOut(
        id=notification.id,
        user_id=notification.user_id,
        user_email=user.email if user else "",
        user_name=user.name if user else "",
        device_id=notification.device_id,
        device_code=device.device_code if device else None,
        type=notification.type,
        title=notification.title,
        content=notification.content,
        is_read=notification.is_read,
        created_at=notification.created_at,
    )


def _session_out(session: StudySession, user: User) -> AdminSessionOut:
    return AdminSessionOut(
        id=session.id,
        user_id=session.user_id,
        user_email=user.email,
        user_name=user.name,
        plan_id=session.plan_id,
        started_at=session.started_at,
        ended_at=session.ended_at,
        planned_minutes=session.planned_minutes,
        status=session.status,  # type: ignore[arg-type]
        duration_seconds=session_duration_seconds(session),
        created_at=session.created_at,
    )


def _plan_out(plan: StudyPlan, user: User) -> AdminPlanOut:
    return AdminPlanOut(
        id=plan.id,
        user_id=plan.user_id,
        user_email=user.email,
        user_name=user.name,
        title=plan.title,
        description=plan.description,
        scheduled_start=plan.scheduled_start,
        planned_minutes=plan.planned_minutes,
        status=plan.status,  # type: ignore[arg-type]
        reminder_sent_at=plan.reminder_sent_at,
        completed_at=plan.completed_at,
        created_at=plan.created_at,
    )


# ---------------------------------------------------------------------------
# Overview / stats / system
# ---------------------------------------------------------------------------
@router.get("/overview", response_model=AdminOverview)
async def overview(_admin: CurrentAdmin, db: DbSession) -> AdminOverview:
    now = utcnow()
    recent = (
        (
            await db.execute(
                select(User).order_by(User.created_at.desc()).limit(10)
            )
        )
        .scalars()
        .all()
    )
    return AdminOverview(
        users=int(await db.scalar(select(func.count(User.id))) or 0),
        admins=int(
            await db.scalar(
                select(func.count(User.id)).where(User.role == "admin")
            )
            or 0
        ),
        devices=int(await db.scalar(select(func.count(Device.id))) or 0),
        online_devices=int(
            await db.scalar(
                select(func.count(Device.id)).where(_online_condition(now))
            )
            or 0
        ),
        study_sessions=int(
            await db.scalar(select(func.count(StudySession.id))) or 0
        ),
        sensor_readings=int(
            await db.scalar(select(func.count(SensorReading.id))) or 0
        ),
        unread_notifications=int(
            await db.scalar(
                select(func.count(Notification.id)).where(
                    Notification.is_read.is_(False)
                )
            )
            or 0
        ),
        recent_users=[UserOut.model_validate(user) for user in recent],
    )


@router.get("/stats", response_model=AdminStatsOut)
async def stats(_admin: CurrentAdmin, db: DbSession) -> AdminStatsOut:
    now = utcnow()
    since_24h = now - timedelta(hours=24)
    week_start, _ = local_day_bounds_utc(-6)

    total_users = int(await db.scalar(select(func.count(User.id))) or 0)
    admins = int(
        await db.scalar(select(func.count(User.id)).where(User.role == "admin")) or 0
    )
    total_devices = int(await db.scalar(select(func.count(Device.id))) or 0)
    online_devices = int(
        await db.scalar(
            select(func.count(Device.id)).where(_online_condition(now))
        )
        or 0
    )
    total_readings = int(
        await db.scalar(select(func.count(SensorReading.id))) or 0
    )
    readings_24h = int(
        await db.scalar(
            select(func.count(SensorReading.id)).where(
                SensorReading.received_at >= since_24h
            )
        )
        or 0
    )
    alerts_24h = int(
        await db.scalar(
            select(func.count(Notification.id)).where(
                Notification.created_at >= since_24h
            )
        )
        or 0
    )
    unread_notifications = int(
        await db.scalar(
            select(func.count(Notification.id)).where(
                Notification.is_read.is_(False)
            )
        )
        or 0
    )
    active_sessions = int(
        await db.scalar(
            select(func.count(StudySession.id)).where(
                StudySession.status.in_(["running", "paused"])
            )
        )
        or 0
    )
    total_sessions = int(
        await db.scalar(select(func.count(StudySession.id))) or 0
    )
    total_plans = int(await db.scalar(select(func.count(StudyPlan.id))) or 0)
    total_tokens = int(await db.scalar(select(func.count(DeviceToken.id))) or 0)

    role_rows = await db.execute(
        select(User.role, func.count(User.id)).group_by(User.role)
    )
    users_by_role = [
        AdminCountItem(label=str(role or "unknown"), count=int(count))
        for role, count in role_rows.all()
    ]

    alert_rows = await db.execute(
        select(Notification.type, func.count(Notification.id))
        .where(Notification.created_at >= week_start)
        .group_by(Notification.type)
        .order_by(func.count(Notification.id).desc())
        .limit(20)
    )
    alerts_by_type = [
        AdminCountItem(label=str(kind or "unknown"), count=int(count))
        for kind, count in alert_rows.all()
    ]

    readings = (
        await db.execute(
            select(
                SensorReading.recorded_at,
                SensorReading.temperature,
                SensorReading.humidity,
                SensorReading.light_lux,
            ).where(SensorReading.recorded_at >= week_start)
        )
    ).all()
    alert_days = (
        await db.execute(
            select(Notification.created_at).where(
                Notification.created_at >= week_start
            )
        )
    ).all()
    user_days = (
        await db.execute(
            select(User.created_at).where(User.created_at >= week_start)
        )
    ).all()

    today = datetime.now(app_tz()).date()
    day_keys = [
        (today + timedelta(days=offset)).isoformat() for offset in range(-6, 1)
    ]
    reading_agg: dict[str, dict[str, Any]] = {
        key: {
            "readings": 0,
            "t_sum": 0.0,
            "t_count": 0,
            "h_sum": 0.0,
            "h_count": 0,
            "l_sum": 0.0,
            "l_count": 0,
        }
        for key in day_keys
    }
    for recorded_at, temperature, humidity, light_lux in readings:
        bucket = reading_agg.get(local_date_key(recorded_at))
        if bucket is None:
            continue
        bucket["readings"] += 1
        if temperature is not None:
            bucket["t_sum"] += float(temperature)
            bucket["t_count"] += 1
        if humidity is not None:
            bucket["h_sum"] += float(humidity)
            bucket["h_count"] += 1
        if light_lux is not None:
            bucket["l_sum"] += float(light_lux)
            bucket["l_count"] += 1

    readings_daily = [
        AdminDailyReadings(
            date=key,
            readings=bucket["readings"],
            avg_temperature=(
                round(bucket["t_sum"] / bucket["t_count"], 1)
                if bucket["t_count"]
                else None
            ),
            avg_humidity=(
                round(bucket["h_sum"] / bucket["h_count"], 1)
                if bucket["h_count"]
                else None
            ),
            avg_light_lux=(
                round(bucket["l_sum"] / bucket["l_count"], 1)
                if bucket["l_count"]
                else None
            ),
        )
        for key, bucket in reading_agg.items()
    ]

    alert_count_map = {key: 0 for key in day_keys}
    for (created_at,) in alert_days:
        key = local_date_key(created_at)
        if key in alert_count_map:
            alert_count_map[key] += 1
    alerts_daily = [
        AdminDailyCount(date=key, count=alert_count_map[key]) for key in day_keys
    ]

    user_count_map = {key: 0 for key in day_keys}
    for (created_at,) in user_days:
        key = local_date_key(created_at)
        if key in user_count_map:
            user_count_map[key] += 1
    users_daily = [
        AdminDailyCount(date=key, count=user_count_map[key]) for key in day_keys
    ]

    return AdminStatsOut(
        total_users=total_users,
        admins=admins,
        total_devices=total_devices,
        online_devices=online_devices,
        offline_devices=max(0, total_devices - online_devices),
        total_readings=total_readings,
        readings_24h=readings_24h,
        alerts_24h=alerts_24h,
        unread_notifications=unread_notifications,
        active_sessions=active_sessions,
        total_sessions=total_sessions,
        total_plans=total_plans,
        total_tokens=total_tokens,
        fcm_enabled=settings.fcm_enabled,
        mqtt_connected=mqtt_service.connected,
        ai_provider=settings.active_ai_provider,
        auth_provider=settings.auth_provider,
        environment=settings.environment,
        timezone=settings.app_timezone,
        generated_at=now,
        users_by_role=users_by_role,
        alerts_by_type=alerts_by_type,
        readings_daily=readings_daily,
        alerts_daily=alerts_daily,
        users_daily=users_daily,
    )


@router.get("/system", response_model=AdminSystemOut)
async def system(_admin: CurrentAdmin, db: DbSession) -> AdminSystemOut:
    database_kind = (
        "postgresql" if settings.database_url.startswith("postgresql") else "sqlite"
    )
    return AdminSystemOut(
        app_name=settings.app_name,
        version=APP_VERSION,
        environment=settings.environment,
        auth_provider=settings.auth_provider,
        ai_provider=settings.active_ai_provider,
        timezone=settings.app_timezone,
        api_prefix=settings.api_prefix,
        database=database_kind,
        mqtt_connected=mqtt_service.connected,
        mqtt_host=settings.mqtt_host,
        mqtt_topic_prefix=settings.mqtt_topic_prefix,
        fcm_enabled=settings.fcm_enabled,
        fcm_project_id=settings.firebase_project_id,
        total_users=int(await db.scalar(select(func.count(User.id))) or 0),
        total_devices=int(await db.scalar(select(func.count(Device.id))) or 0),
        total_tokens=int(await db.scalar(select(func.count(DeviceToken.id))) or 0),
        generated_at=utcnow(),
    )


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------
@router.get("/users", response_model=AdminUserPage)
async def list_users(
    _admin: CurrentAdmin,
    db: DbSession,
    search: str | None = Query(default=None, max_length=120),
    role: str | None = Query(default=None, pattern="^(student|admin)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> AdminUserPage:
    filters = []
    if search:
        pattern = f"%{search.strip()}%"
        filters.append(or_(User.email.ilike(pattern), User.name.ilike(pattern)))
    if role:
        filters.append(User.role == role)

    total = int(
        await db.scalar(select(func.count(User.id)).where(*filters)) or 0
    )
    users = (
        (
            await db.execute(
                select(User)
                .where(*filters)
                .order_by(User.created_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        )
        .scalars()
        .all()
    )
    items = [await _user_out(db, user) for user in users]
    return AdminUserPage(items=items, total=total, page=page, page_size=page_size)


@router.get("/users/{user_id}", response_model=AdminUserDetail)
async def user_detail(
    user_id: str, _admin: CurrentAdmin, db: DbSession
) -> AdminUserDetail:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy người dùng")

    devices = await _device_rows(db, [Device.user_id == user.id], limit=100)
    notification_rows = (
        (
            await db.execute(
                select(Notification)
                .where(Notification.user_id == user.id)
                .order_by(Notification.created_at.desc())
                .limit(10)
            )
        )
        .scalars()
        .all()
    )
    session_rows = (
        (
            await db.execute(
                select(StudySession)
                .where(StudySession.user_id == user.id)
                .order_by(StudySession.started_at.desc())
                .limit(10)
            )
        )
        .scalars()
        .all()
    )
    device_codes = {
        device.id: device.device_code
        for device in (
            await db.execute(select(Device).where(Device.user_id == user.id))
        )
        .scalars()
        .all()
    }
    return AdminUserDetail(
        user=await _user_out(db, user),
        devices=devices,
        recent_notifications=[
            AdminNotificationOut(
                id=item.id,
                user_id=item.user_id,
                user_email=user.email,
                user_name=user.name,
                device_id=item.device_id,
                device_code=device_codes.get(item.device_id or ""),
                type=item.type,
                title=item.title,
                content=item.content,
                is_read=item.is_read,
                created_at=item.created_at,
            )
            for item in notification_rows
        ],
        recent_sessions=[_session_out(item, user) for item in session_rows],
    )


@router.patch("/users/{user_id}", response_model=AdminUserOut)
async def update_user(
    user_id: str,
    payload: AdminUserUpdate,
    admin: CurrentAdmin,
    db: DbSession,
) -> AdminUserOut:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy người dùng")
    if user.id == admin.id and payload.role is not None and payload.role != "admin":
        raise HTTPException(
            status_code=400,
            detail="Không thể tự thu hồi quyền quản trị của chính mình",
        )
    if payload.name is not None:
        user.name = payload.name.strip()
    if payload.role is not None:
        user.role = payload.role
    if payload.daily_goal_minutes is not None:
        user.daily_goal_minutes = payload.daily_goal_minutes
    await db.commit()
    await db.refresh(user)
    return await _user_out(db, user)


class RoleUpdate(BaseModel):
    role: str


@router.patch("/users/{user_id}/role", response_model=UserOut)
async def update_role(
    user_id: str, payload: RoleUpdate, admin: CurrentAdmin, db: DbSession
) -> UserOut:
    if payload.role not in {"student", "admin"}:
        raise HTTPException(status_code=422, detail="role phải là student hoặc admin")
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy người dùng")
    if user.id == admin.id and payload.role != "admin":
        raise HTTPException(
            status_code=400, detail="Không thể tự thu hồi quyền quản trị của chính mình"
        )
    user.role = payload.role
    await db.commit()
    await db.refresh(user)
    return UserOut.model_validate(user)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: str, admin: CurrentAdmin, db: DbSession
) -> Response:
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Không thể xoá chính mình")
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy người dùng")

    device_ids = list(
        (await db.execute(select(Device.id).where(Device.user_id == user_id))).scalars()
    )
    await db.execute(
        delete(Notification).where(
            or_(
                Notification.user_id == user_id,
                Notification.device_id.in_(device_ids),
            )
        )
    )
    await db.execute(delete(DeviceToken).where(DeviceToken.user_id == user_id))
    await db.execute(
        delete(AIConversation).where(AIConversation.user_id == user_id)
    )
    await db.execute(delete(StudySession).where(StudySession.user_id == user_id))
    await db.execute(delete(StudyPlan).where(StudyPlan.user_id == user_id))
    if device_ids:
        await db.execute(
            delete(SensorReading).where(SensorReading.device_id.in_(device_ids))
        )
        await db.execute(delete(Device).where(Device.id.in_(device_ids)))
    await db.delete(user)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Devices / readings
# ---------------------------------------------------------------------------
@router.get("/devices", response_model=AdminDevicePage)
async def list_devices(
    _admin: CurrentAdmin,
    db: DbSession,
    search: str | None = Query(default=None, max_length=120),
    status_filter: str | None = Query(
        default=None, alias="status", pattern="^(online|offline)$"
    ),
    user_id: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> AdminDevicePage:
    now = utcnow()
    filters = []
    if search:
        pattern = f"%{search.strip()}%"
        filters.append(
            or_(
                Device.device_code.ilike(pattern),
                Device.name.ilike(pattern),
                User.email.ilike(pattern),
                User.name.ilike(pattern),
            )
        )
    if status_filter == "online":
        filters.append(_online_condition(now))
    elif status_filter == "offline":
        filters.append(~_online_condition(now))
    if user_id:
        filters.append(Device.user_id == user_id)

    total = int(
        await db.scalar(
            select(func.count(Device.id))
            .select_from(Device)
            .join(User, Device.user_id == User.id)
            .where(*filters)
        )
        or 0
    )
    items = await _device_rows(
        db, filters, offset=(page - 1) * page_size, limit=page_size
    )
    return AdminDevicePage(
        items=items, total=total, page=page, page_size=page_size
    )


@router.get("/devices/{device_id}", response_model=AdminDeviceDetail)
async def device_detail(
    device_id: str, _admin: CurrentAdmin, db: DbSession
) -> AdminDeviceDetail:
    device = await db.get(Device, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy thiết bị")
    return await _device_detail(db, device)


@router.patch("/devices/{device_id}", response_model=AdminDeviceDetail)
async def update_device(
    device_id: str,
    payload: AdminDeviceUpdate,
    _admin: CurrentAdmin,
    db: DbSession,
) -> AdminDeviceDetail:
    device = await db.get(Device, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy thiết bị")

    if payload.user_id is not None:
        owner = await db.get(User, payload.user_id)
        if owner is None:
            raise HTTPException(status_code=404, detail="Không tìm thấy chủ mới")
        device.user_id = owner.id
    if payload.name is not None:
        device.name = payload.name.strip()
    if payload.settings is not None:
        merged = {**_merged_settings(device).model_dump(), **payload.settings}
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
    return await _device_detail(db, device)


@router.delete("/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_device(
    device_id: str, _admin: CurrentAdmin, db: DbSession
) -> Response:
    device = await db.get(Device, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy thiết bị")
    await db.execute(
        delete(Notification).where(Notification.device_id == device.id)
    )
    await db.execute(
        delete(SensorReading).where(SensorReading.device_id == device.id)
    )
    await db.delete(device)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/devices/{device_id}/rotate-key", response_model=AdminDeviceKeyOut)
async def rotate_device_key(
    device_id: str, _admin: CurrentAdmin, db: DbSession
) -> AdminDeviceKeyOut:
    device = await db.get(Device, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy thiết bị")
    device_key = new_device_key()
    device.device_key_hash = hash_device_key(device_key)
    await db.commit()
    return AdminDeviceKeyOut(
        device_id=device.id,
        device_code=device.device_code,
        device_key=device_key,
        mqtt_topics=_mqtt_topics(device.device_code),
        detail="Key mới chỉ hiển thị một lần. Hãy dán vào firmware/config.h.",
    )


@router.post(
    "/devices/{device_id}/command", response_model=AdminDeviceCommandResult
)
async def send_device_command(
    device_id: str,
    payload: CommandRequest,
    _admin: CurrentAdmin,
    db: DbSession,
) -> AdminDeviceCommandResult:
    device = await db.get(Device, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy thiết bị")
    topic = f"{settings.mqtt_topic_prefix}/{device.device_code}/command"

    if payload.action in {"set_led", "set_buzzer", "set_alerts"} and not isinstance(
        payload.value, bool
    ):
        raise HTTPException(status_code=422, detail="value phải là true/false")
    if payload.action == "set_thresholds":
        if not isinstance(payload.value, dict):
            raise HTTPException(status_code=422, detail="value phải là object ngưỡng")
        merged = {**_merged_settings(device).model_dump(), **payload.value}
        validated = DeviceSettings.model_validate(merged)
        device.settings = validated.model_dump()
        await db.commit()
        payload.value = validated.model_dump()

    delivered = await mqtt_service.send_command(
        device.device_code, {"action": payload.action, "value": payload.value}
    )
    return AdminDeviceCommandResult(
        device_id=device.id,
        device_code=device.device_code,
        delivered=delivered,
        topic=topic,
        payload={"action": payload.action, "value": payload.value},
        detail=None
        if delivered
        else "MQTT chưa kết nối; lệnh chưa được gửi tới thiết bị",
    )


@router.get("/devices/{device_id}/readings", response_model=AdminReadingPage)
async def device_readings(
    device_id: str,
    _admin: CurrentAdmin,
    db: DbSession,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> AdminReadingPage:
    device = await db.get(Device, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy thiết bị")
    total = int(
        await db.scalar(
            select(func.count(SensorReading.id)).where(
                SensorReading.device_id == device.id
            )
        )
        or 0
    )
    rows = (
        (
            await db.execute(
                select(SensorReading)
                .where(SensorReading.device_id == device.id)
                .order_by(SensorReading.recorded_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        )
        .scalars()
        .all()
    )
    return AdminReadingPage(
        items=[_reading_out(row, device) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/readings", response_model=AdminReadingPage)
async def list_readings(
    _admin: CurrentAdmin,
    db: DbSession,
    device_id: str | None = Query(default=None),
    user_id: str | None = Query(default=None),
    hours: int = Query(default=24, ge=1, le=720),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> AdminReadingPage:
    since = utcnow() - timedelta(hours=hours)
    filters = [SensorReading.recorded_at >= since]
    if device_id:
        filters.append(SensorReading.device_id == device_id)
    if user_id:
        filters.append(Device.user_id == user_id)

    total = int(
        await db.scalar(
            select(func.count(SensorReading.id))
            .select_from(SensorReading)
            .join(Device, SensorReading.device_id == Device.id)
            .where(*filters)
        )
        or 0
    )
    rows = (
        await db.execute(
            select(SensorReading, Device)
            .join(Device, SensorReading.device_id == Device.id)
            .where(*filters)
            .order_by(SensorReading.recorded_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()
    return AdminReadingPage(
        items=[_reading_out(reading, device) for reading, device in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------
@router.get("/notifications", response_model=AdminNotificationPage)
async def list_notifications(
    _admin: CurrentAdmin,
    db: DbSession,
    user_id: str | None = Query(default=None),
    device_id: str | None = Query(default=None),
    type_filter: str | None = Query(default=None, alias="type", max_length=40),
    unread_only: bool = Query(default=False),
    search: str | None = Query(default=None, max_length=120),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> AdminNotificationPage:
    filters = []
    if user_id:
        filters.append(Notification.user_id == user_id)
    if device_id:
        filters.append(Notification.device_id == device_id)
    if type_filter:
        filters.append(Notification.type == type_filter)
    if unread_only:
        filters.append(Notification.is_read.is_(False))
    if search:
        pattern = f"%{search.strip()}%"
        filters.append(
            or_(
                Notification.title.ilike(pattern),
                Notification.content.ilike(pattern),
            )
        )

    total = int(
        await db.scalar(select(func.count(Notification.id)).where(*filters)) or 0
    )
    rows = (
        await db.execute(
            select(Notification, User, Device)
            .join(User, Notification.user_id == User.id)
            .outerjoin(Device, Notification.device_id == Device.id)
            .where(*filters)
            .order_by(Notification.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()
    items = [
        AdminNotificationOut(
            id=notification.id,
            user_id=notification.user_id,
            user_email=user.email,
            user_name=user.name,
            device_id=notification.device_id,
            device_code=device.device_code if device else None,
            type=notification.type,
            title=notification.title,
            content=notification.content,
            is_read=notification.is_read,
            created_at=notification.created_at,
        )
        for notification, user, device in rows
    ]
    return AdminNotificationPage(
        items=items, total=total, page=page, page_size=page_size
    )


@router.post("/notifications/send", response_model=AdminSendResult)
async def send_notification(
    payload: AdminSendRequest, _admin: CurrentAdmin, db: DbSession
) -> AdminSendResult:
    target = await db.get(User, payload.user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy người dùng")

    notification = Notification(
        user_id=target.id,
        type=payload.type,
        title=payload.title,
        content=payload.body,
    )
    db.add(notification)
    await db.commit()
    await db.refresh(notification)

    result = await fcm.send_to_user(
        db,
        target.id,
        notification.title,
        notification.content,
        {
            "type": notification.type,
            "notification_id": notification.id,
            "source": "admin",
        },
    )
    return AdminSendResult(
        notification=await _notification_out(db, notification),
        push=_push_out(result),
    )


@router.post("/notifications/broadcast", response_model=AdminBroadcastResult)
async def broadcast_notification(
    payload: AdminBroadcastRequest, _admin: CurrentAdmin, db: DbSession
) -> AdminBroadcastResult:
    user_query = select(User)
    if payload.user_ids is not None:
        if not payload.user_ids:
            raise HTTPException(
                status_code=400, detail="Danh sách người nhận đang trống"
            )
        user_query = user_query.where(User.id.in_(payload.user_ids))
    users = list((await db.execute(user_query)).scalars().all())
    if not users:
        raise HTTPException(status_code=400, detail="Không có người nhận hợp lệ")

    user_ids = [user.id for user in users]
    notifications = [
        Notification(
            user_id=user.id,
            type=payload.type,
            title=payload.title,
            content=payload.body,
        )
        for user in users
    ]
    db.add_all(notifications)
    await db.commit()

    tokens = list(
        (
            await db.execute(
                select(DeviceToken.token).where(DeviceToken.user_id.in_(user_ids))
            )
        )
        .scalars()
        .all()
    )
    result = await fcm.send_to_tokens(
        tokens,
        payload.title,
        payload.body,
        {"type": payload.type, "source": "admin_broadcast"},
    )
    if result.invalid_tokens:
        await db.execute(
            delete(DeviceToken).where(DeviceToken.token.in_(result.invalid_tokens))
        )
        await db.commit()

    return AdminBroadcastResult(
        recipients=len(users),
        created=len(notifications),
        push=_push_out(result),
    )


# ---------------------------------------------------------------------------
# Study sessions / plans
# ---------------------------------------------------------------------------
@router.get("/sessions", response_model=AdminSessionPage)
async def list_sessions(
    _admin: CurrentAdmin,
    db: DbSession,
    user_id: str | None = Query(default=None),
    status_filter: str | None = Query(
        default=None,
        alias="status",
        pattern="^(running|paused|completed|cancelled)$",
    ),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> AdminSessionPage:
    filters = []
    if user_id:
        filters.append(StudySession.user_id == user_id)
    if status_filter:
        filters.append(StudySession.status == status_filter)

    total = int(
        await db.scalar(select(func.count(StudySession.id)).where(*filters)) or 0
    )
    rows = (
        await db.execute(
            select(StudySession, User)
            .join(User, StudySession.user_id == User.id)
            .where(*filters)
            .order_by(StudySession.started_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()
    return AdminSessionPage(
        items=[_session_out(session, user) for session, user in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/plans", response_model=AdminPlanPage)
async def list_plans(
    _admin: CurrentAdmin,
    db: DbSession,
    user_id: str | None = Query(default=None),
    status_filter: str | None = Query(
        default=None,
        alias="status",
        pattern="^(pending|in_progress|completed|cancelled)$",
    ),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> AdminPlanPage:
    filters = []
    if user_id:
        filters.append(StudyPlan.user_id == user_id)
    if status_filter:
        filters.append(StudyPlan.status == status_filter)

    total = int(
        await db.scalar(select(func.count(StudyPlan.id)).where(*filters)) or 0
    )
    rows = (
        await db.execute(
            select(StudyPlan, User)
            .join(User, StudyPlan.user_id == User.id)
            .where(*filters)
            .order_by(StudyPlan.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()
    return AdminPlanPage(
        items=[_plan_out(plan, user) for plan, user in rows],
        total=total,
        page=page,
        page_size=page_size,
    )

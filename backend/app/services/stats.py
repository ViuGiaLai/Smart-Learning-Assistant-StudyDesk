from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta, tzinfo
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.time import to_naive_utc, utcnow
from app.db.models import StudyPlan, StudySession, User
from app.schemas.study import DailyStat, StudyStatsOut

UTC = UTC


def session_duration_seconds(session: StudySession, now: datetime | None = None) -> int:
    """Server-authoritative focus duration, including a currently running block."""
    total = session.accumulated_seconds or 0
    if session.status == "running" and session.last_resumed_at is not None:
        now = now or utcnow()
        total += max(0, int((now - session.last_resumed_at).total_seconds()))
    return max(0, total)


def app_tz() -> tzinfo:
    try:
        return ZoneInfo(settings.app_timezone)
    except Exception:  # noqa: BLE001 - missing tzdata or invalid config
        return UTC


def local_day_bounds_utc(day_offset: int = 0) -> tuple[datetime, datetime]:
    """Naive-UTC bounds for a local calendar day in the app timezone."""
    tz = app_tz()
    now_local = datetime.now(tz)
    start_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(
        days=day_offset
    )
    end_local = start_local + timedelta(days=1) - timedelta(microseconds=1)
    start_utc = start_local.astimezone(UTC).replace(tzinfo=None)
    end_utc = end_local.astimezone(UTC).replace(tzinfo=None)
    return start_utc, end_utc


def local_date_key(moment: datetime) -> str:
    return moment.replace(tzinfo=UTC).astimezone(app_tz()).date().isoformat()


async def get_study_stats(db: AsyncSession, user: User) -> StudyStatsOut:
    now = utcnow()
    week_start, _ = local_day_bounds_utc(-6)
    today_start, today_end = local_day_bounds_utc(0)
    tz = app_tz()

    result = await db.execute(
        select(StudySession).where(StudySession.user_id == user.id)
    )
    sessions = list(result.scalars().all())

    today_seconds = 0
    today_count = 0
    week_seconds = 0
    week_count = 0
    total_seconds = 0
    completed = 0
    daily: dict[str, list[int]] = {}

    for session in sessions:
        duration = session_duration_seconds(session, now)
        total_seconds += duration
        if session.status == "completed":
            completed += 1

        started = session.started_at
        if started is None:
            continue
        if today_start <= started <= today_end:
            today_seconds += duration
            today_count += 1
        if started >= week_start:
            week_seconds += duration
            week_count += 1
            bucket = daily.setdefault(local_date_key(started), [0, 0])
            bucket[0] += duration
            bucket[1] += 1

    daily_stats: list[DailyStat] = []
    today_local = datetime.now(tz).date()
    for offset in range(-6, 1):
        key = (today_local + timedelta(days=offset)).isoformat()
        seconds, count = daily.get(key, [0, 0])
        daily_stats.append(DailyStat(date=key, focused_seconds=seconds, sessions=count))

    plans_total = await db.scalar(
        select(func.count(StudyPlan.id)).where(StudyPlan.user_id == user.id)
    )
    plans_completed = await db.scalar(
        select(func.count(StudyPlan.id)).where(
            StudyPlan.user_id == user.id, StudyPlan.status == "completed"
        )
    )

    goal_seconds = max(1, user.daily_goal_minutes * 60)
    return StudyStatsOut(
        today_focused_seconds=today_seconds,
        today_sessions=today_count,
        week_focused_seconds=week_seconds,
        week_sessions=week_count,
        total_focused_seconds=total_seconds,
        completed_sessions=completed,
        plans_total=int(plans_total or 0),
        plans_completed=int(plans_completed or 0),
        goal_completion_rate=round(min(100.0, today_seconds / goal_seconds * 100), 1),
        daily_goal_minutes=user.daily_goal_minutes,
        daily=daily_stats,
        timezone=settings.app_timezone,
    )


def reading_fingerprint(payload: dict) -> str:
    """Fallback idempotency key for firmware that does not send message_id."""
    raw = "|".join(
        str(payload.get(key, ""))
        for key in ("temperature", "humidity", "light", "motion_detected", "timestamp")
    )
    return "auto_" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:40]


def clamp_device_timestamp(value: datetime | None, *, max_skew_seconds: int) -> datetime:
    """Never trust the ESP32 RTC. Reject timestamps far in the future/past."""
    now = utcnow()
    candidate = to_naive_utc(value)
    if candidate is None:
        return now
    if abs((candidate - now).total_seconds()) > max_skew_seconds:
        return now
    return candidate

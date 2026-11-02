#!/usr/bin/env python
"""Seed a demo account so the app has something to show immediately.

Usage (from backend/):
    python -m scripts.seed_demo
    python -m scripts.seed_demo --reset

Demo login: demo@smartstudy.vn / demo12345
Device code: STUDY_DESK_001 (key printed at the end, HTTP fallback only)
"""
from __future__ import annotations

import argparse
import asyncio
import random
from datetime import timedelta

from sqlalchemy import delete, select

from app.core.security import hash_device_key, hash_password
from app.core.time import utcnow
from app.db.base import SessionLocal, init_db
from app.db.models import (
    DEFAULT_DEVICE_SETTINGS,
    AIConversation,
    Device,
    Notification,
    SensorReading,
    StudyPlan,
    StudySession,
    User,
)
from app.services.sensors import estimate_lux

DEMO_EMAIL = "demo@smartstudy.vn"
DEMO_PASSWORD = "demo12345"
DEMO_NAME = "Minh Anh"
DEVICE_CODE = "STUDY_DESK_001"
DEVICE_KEY = "sk_demo_study_desk_key_001"


async def reset_demo(db) -> None:
    user = await db.scalar(select(User).where(User.email == DEMO_EMAIL))
    if user is None:
        return
    device_ids = list(
        (await db.execute(select(Device.id).where(Device.user_id == user.id))).scalars()
    )
    if device_ids:
        await db.execute(delete(SensorReading).where(SensorReading.device_id.in_(device_ids)))
        await db.execute(delete(Notification).where(Notification.device_id.in_(device_ids)))
    await db.execute(delete(Notification).where(Notification.user_id == user.id))
    await db.execute(delete(AIConversation).where(AIConversation.user_id == user.id))
    await db.execute(delete(StudySession).where(StudySession.user_id == user.id))
    await db.execute(delete(StudyPlan).where(StudyPlan.user_id == user.id))
    await db.execute(delete(Device).where(Device.user_id == user.id))
    await db.execute(delete(User).where(User.id == user.id))
    await db.commit()
    print("Removed previous demo data.")


async def seed() -> None:
    await init_db()
    async with SessionLocal() as db:
        existing = await db.scalar(select(Device).where(Device.device_code == DEVICE_CODE))
        if existing is not None:
            print(
                f"Device {DEVICE_CODE} already exists (owner {existing.user_id}). "
                "Run with --reset to recreate the demo."
            )
            return

        user = await db.scalar(select(User).where(User.email == DEMO_EMAIL))
        if user is None:
            user = User(
                email=DEMO_EMAIL,
                name=DEMO_NAME,
                password_hash=hash_password(DEMO_PASSWORD),
                daily_goal_minutes=120,
            )
            db.add(user)
            await db.flush()

        device = Device(
            user_id=user.id,
            device_code=DEVICE_CODE,
            name="Bàn học",
            device_key_hash=hash_device_key(DEVICE_KEY),
            status="online",
            last_seen_at=utcnow(),
            settings=dict(DEFAULT_DEVICE_SETTINGS),
        )
        db.add(device)
        await db.flush()

        # ~2 hours of readings, one every 2 minutes.
        now = utcnow()
        readings: list[SensorReading] = []
        for index in range(60):
            minutes_ago = (59 - index) * 2
            daylight = 60 + index * 4 + random.randint(-10, 10)
            raw = max(0, min(4095, daylight * 6))
            readings.append(
                SensorReading(
                    device_id=device.id,
                    message_id=f"seed-{index:04d}",
                    temperature=round(27.0 + random.uniform(-1.2, 2.6), 1),
                    humidity=round(62.0 + random.uniform(-6, 8), 0),
                    light_raw=raw,
                    light_lux=estimate_lux(raw),
                    motion_detected=random.random() > 0.35,
                    recorded_at=now - timedelta(minutes=minutes_ago),
                    received_at=now - timedelta(minutes=minutes_ago),
                )
            )
        db.add_all(readings)

        today = now.replace(hour=9, minute=0, second=0, microsecond=0)
        plan_done = StudyPlan(
            user_id=user.id,
            title="Ôn tập React Native",
            description="Navigation, state management và gọi API",
            planned_minutes=50,
            status="completed",
            completed_at=today + timedelta(minutes=50),
            created_at=today - timedelta(days=1),
        )
        plan_next = StudyPlan(
            user_id=user.id,
            title="Luyện nghe tiếng Anh",
            description="Nghe 1 bài TED-Ed và ghi chú từ mới",
            planned_minutes=25,
            status="pending",
            created_at=now - timedelta(hours=2),
        )
        db.add_all([plan_done, plan_next])
        await db.flush()

        db.add(
            StudySession(
                user_id=user.id,
                plan_id=plan_done.id,
                started_at=today,
                ended_at=today + timedelta(minutes=50),
                accumulated_seconds=50 * 60,
                last_resumed_at=None,
                planned_minutes=50,
                status="completed",
                created_at=today,
            )
        )
        db.add(
            StudySession(
                user_id=user.id,
                started_at=now - timedelta(hours=3),
                ended_at=now - timedelta(hours=2, minutes=35),
                accumulated_seconds=25 * 60,
                last_resumed_at=None,
                planned_minutes=25,
                status="completed",
                created_at=now - timedelta(hours=3),
            )
        )
        db.add(
            Notification(
                user_id=user.id,
                device_id=device.id,
                type="light_low",
                title="Ánh sáng bàn học chưa đủ",
                content="Cường độ sáng khoảng 98 lux, thấp hơn ngưỡng 150 lux. Hãy bật đèn bàn.",
                created_at=now - timedelta(minutes=18),
            )
        )
        await db.commit()

        print("Demo data created.")
        print(f"  Login      : {DEMO_EMAIL} / {DEMO_PASSWORD}")
        print(f"  Device code: {DEVICE_CODE}")
        print(f"  Device key : {DEVICE_KEY}  (HTTP fallback only, not needed for MQTT demo)")


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reset", action="store_true", help="Delete previous demo data first")
    args = parser.parse_args()

    if args.reset:
        await init_db()
        async with SessionLocal() as db:
            await reset_demo(db)
    await seed()


if __name__ == "__main__":
    asyncio.run(main())

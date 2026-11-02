from __future__ import annotations

import asyncio
from datetime import timedelta

from fastapi.testclient import TestClient

from app.core.time import utcnow
from app.db.base import SessionLocal
from app.services import reminders


def test_due_plan_creates_one_reminder(client: TestClient, auth: dict) -> None:
    start = (utcnow() + timedelta(minutes=2)).isoformat() + "Z"
    plan = client.post(
        "/api/study-plans",
        json={"title": "Ôn Python", "scheduled_start": start, "planned_minutes": 25},
        headers=auth,
    )
    assert plan.status_code == 201, plan.text

    async def run_once() -> int:
        async with SessionLocal() as db:
            return await reminders.send_due_study_reminders(db)

    assert asyncio.run(run_once()) == 1
    assert asyncio.run(run_once()) == 0

    notifications = client.get("/api/notifications", headers=auth).json()
    assert [item["type"] for item in notifications].count("study_reminder") == 1

from __future__ import annotations

import asyncio
from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.api import study
from app.core.time import utcnow
from app.db.base import SessionLocal
from app.db.models import StudySession, User


def _record_publisher(monkeypatch, calls: list[tuple[str, str, object]], delivered: bool = True):
    async def fake_send(device_code: str, command: dict) -> bool:
        calls.append((device_code, command.get("action"), command.get("value")))
        return delivered

    monkeypatch.setattr(study.mqtt_service, "send_command", fake_send)
    monkeypatch.setattr(study, "BUZZER_ON_SECONDS", 0.01)


def test_ring_buzzer_pulses_online_device(
    client: TestClient, auth: dict, device: dict, monkeypatch
) -> None:
    calls: list[tuple[str, str, object]] = []
    _record_publisher(monkeypatch, calls)

    async def scenario() -> None:
        async with SessionLocal() as db:
            user = await db.scalar(select(User).where(User.email == "student@example.com"))
            assert user is not None
            await study._ring_buzzer(db, user.id)
            await asyncio.sleep(0.05)

    asyncio.run(scenario())

    assert [call[1] for call in calls] == ["set_buzzer", "set_buzzer"]
    assert [call[2] for call in calls] == [True, False]
    assert {call[0] for call in calls} == {device["device_code"]}


def test_ring_buzzer_skips_when_broker_is_down(
    client: TestClient, auth: dict, device: dict, monkeypatch
) -> None:
    calls: list[tuple[str, str, object]] = []
    _record_publisher(monkeypatch, calls, delivered=False)

    async def scenario() -> None:
        async with SessionLocal() as db:
            user = await db.scalar(select(User).where(User.email == "student@example.com"))
            assert user is not None
            await study._ring_buzzer(db, user.id)

    asyncio.run(scenario())

    # Không gửi được lệnh bật thì không lên lịch tắt (tránh bật còi vô hạn).
    assert [call[2] for call in calls] == [True]


def test_finish_at_planned_time_rings_buzzer(
    client: TestClient, auth: dict, device: dict, monkeypatch
) -> None:
    calls: list[tuple[str, str, object]] = []
    _record_publisher(monkeypatch, calls)

    started = client.post(
        "/api/study-sessions/start", json={"planned_minutes": 1}, headers=auth
    )
    assert started.status_code == 201, started.text
    session_id = started.json()["id"]

    async def backdate() -> None:
        async with SessionLocal() as db:
            session = await db.get(StudySession, session_id)
            assert session is not None
            session.started_at = utcnow() - timedelta(minutes=2)
            session.last_resumed_at = utcnow() - timedelta(minutes=2)
            await db.commit()

    asyncio.run(backdate())

    finished = client.post(f"/api/study-sessions/{session_id}/finish", headers=auth)
    assert finished.status_code == 200, finished.text
    assert finished.json()["status"] == "completed"
    assert calls, "hết giờ phải gửi lệnh bật còi"
    assert calls[0][2] is True
    assert {call[1] for call in calls} == {"set_buzzer"}


def test_finish_early_does_not_ring_buzzer(
    client: TestClient, auth: dict, device: dict, monkeypatch
) -> None:
    calls: list[tuple[str, str, object]] = []
    _record_publisher(monkeypatch, calls)

    started = client.post(
        "/api/study-sessions/start", json={"planned_minutes": 25}, headers=auth
    )
    assert started.status_code == 201, started.text
    session_id = started.json()["id"]

    finished = client.post(f"/api/study-sessions/{session_id}/finish", headers=auth)
    assert finished.status_code == 200, finished.text

    cancelled = client.post(
        "/api/study-sessions/start", json={"planned_minutes": 1}, headers=auth
    )
    assert cancelled.status_code == 201, cancelled.text
    client.post(
        f"/api/study-sessions/{cancelled.json()['id']}/finish?cancelled=true", headers=auth
    )

    assert calls == []

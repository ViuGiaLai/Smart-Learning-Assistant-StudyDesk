from __future__ import annotations

import asyncio

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db.base import SessionLocal
from app.db.models import User


def _promote(email: str = "student@example.com") -> None:
    async def run() -> None:
        async with SessionLocal() as db:
            user = await db.scalar(select(User).where(User.email == email))
            assert user is not None
            user.role = "admin"
            await db.commit()

    asyncio.run(run())


def test_admin_console_endpoints(client: TestClient, auth: dict, device: dict) -> None:
    _promote()
    headers = auth
    device_id = device["id"]

    # Ingestion gives the console something real to display.
    ingest = client.post(
        "/api/iot/telemetry",
        json={
            "message_id": "admin-console-1",
            "temperature": 24.5,
            "humidity": 52,
            "light_lux": 480,
            "motion_detected": False,
        },
        headers={
            "X-Device-Code": device["device_code"],
            "X-Device-Key": device["device_key"],
        },
    )
    assert ingest.status_code == 202, ingest.text

    plan = client.post(
        "/api/study-plans",
        json={"title": "Ôn thi", "planned_minutes": 30},
        headers=headers,
    )
    assert plan.status_code == 201, plan.text
    session = client.post(
        "/api/study-sessions/start",
        json={"planned_minutes": 30},
        headers=headers,
    )
    assert session.status_code == 201, session.text

    stats = client.get("/api/admin/stats", headers=headers)
    assert stats.status_code == 200, stats.text
    body = stats.json()
    assert body["total_users"] == 1
    assert body["total_devices"] == 1
    assert body["total_readings"] >= 1
    assert body["active_sessions"] == 1
    assert body["users_by_role"][0]["label"] == "admin"
    assert len(body["readings_daily"]) == 7

    users = client.get("/api/admin/users", headers=headers)
    assert users.status_code == 200, users.text
    assert users.json()["total"] == 1
    assert users.json()["items"][0]["devices_count"] == 1

    user_id = users.json()["items"][0]["id"]
    detail = client.get(f"/api/admin/users/{user_id}", headers=headers)
    assert detail.status_code == 200, detail.text
    assert detail.json()["user"]["id"] == user_id
    assert detail.json()["devices"][0]["device_code"] == device["device_code"]

    devices = client.get("/api/admin/devices", headers=headers)
    assert devices.status_code == 200, devices.text
    assert devices.json()["total"] == 1
    assert devices.json()["items"][0]["latest_reading"]["temperature"] == 24.5

    device_detail = client.get(f"/api/admin/devices/{device_id}", headers=headers)
    assert device_detail.status_code == 200, device_detail.text
    assert device_detail.json()["readings_24h"] >= 1
    assert device_detail.json()["mqtt_topics"]["telemetry"]

    readings = client.get("/api/admin/readings?hours=24", headers=headers)
    assert readings.status_code == 200, readings.text
    assert readings.json()["total"] >= 1

    command = client.post(
        f"/api/admin/devices/{device_id}/command",
        json={"action": "set_led", "value": True},
        headers=headers,
    )
    assert command.status_code == 200, command.text
    assert command.json()["delivered"] is False

    rotated = client.post(
        f"/api/admin/devices/{device_id}/rotate-key", headers=headers
    )
    assert rotated.status_code == 200, rotated.text
    new_key = rotated.json()["device_key"]
    assert new_key.startswith("sk_")

    old_key_ingest = client.post(
        "/api/iot/telemetry",
        json={"message_id": "old-key", "temperature": 24},
        headers={
            "X-Device-Code": device["device_code"],
            "X-Device-Key": device["device_key"],
        },
    )
    assert old_key_ingest.status_code == 401

    new_key_ingest = client.post(
        "/api/iot/telemetry",
        json={"message_id": "new-key", "temperature": 24},
        headers={
            "X-Device-Code": device["device_code"],
            "X-Device-Key": new_key,
        },
    )
    assert new_key_ingest.status_code == 202, new_key_ingest.text

    sent = client.post(
        "/api/admin/notifications/send",
        json={
            "user_id": user_id,
            "title": "Thông báo từ admin",
            "body": "Kiểm tra gửi một người",
        },
        headers=headers,
    )
    assert sent.status_code == 200, sent.text
    assert sent.json()["notification"]["title"] == "Thông báo từ admin"

    broadcast = client.post(
        "/api/admin/notifications/broadcast",
        json={"title": "Thông báo toàn trường", "body": "Hệ thống bảo trì 22:00"},
        headers=headers,
    )
    assert broadcast.status_code == 200, broadcast.text
    assert broadcast.json()["recipients"] == 1
    assert broadcast.json()["created"] == 1
    assert broadcast.json()["push"]["enabled"] is False

    notifications = client.get("/api/admin/notifications", headers=headers)
    assert notifications.status_code == 200, notifications.text
    assert notifications.json()["total"] >= 2
    assert notifications.json()["items"][0]["user_email"]

    sessions = client.get("/api/admin/sessions", headers=headers)
    assert sessions.status_code == 200, sessions.text
    assert sessions.json()["total"] == 1

    plans = client.get("/api/admin/plans", headers=headers)
    assert plans.status_code == 200, plans.text
    assert plans.json()["total"] == 1

    system = client.get("/api/admin/system", headers=headers)
    assert system.status_code == 200, system.text
    assert system.json()["database"] == "sqlite"
    assert system.json()["auth_provider"] == "local"


def test_admin_user_management(client: TestClient, auth: dict) -> None:
    _promote()
    other = client.post(
        "/api/auth/register",
        json={
            "email": "other@example.com",
            "name": "Other",
            "password": "password123",
        },
    )
    assert other.status_code == 201, other.text
    other_id = other.json()["user"]["id"]

    updated = client.patch(
        f"/api/admin/users/{other_id}",
        json={"name": "Đã đổi tên", "role": "admin", "daily_goal_minutes": 90},
        headers=auth,
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["name"] == "Đã đổi tên"
    assert updated.json()["role"] == "admin"
    assert updated.json()["daily_goal_minutes"] == 90

    me = client.get("/api/auth/me", headers=auth).json()
    self_delete = client.delete(f"/api/admin/users/{me['id']}", headers=auth)
    assert self_delete.status_code == 400

    deleted = client.delete(f"/api/admin/users/{other_id}", headers=auth)
    assert deleted.status_code == 204, deleted.text

    missing = client.get(f"/api/admin/users/{other_id}", headers=auth)
    assert missing.status_code == 404


def test_local_jwt_is_rejected_when_supabase_is_enabled(
    client: TestClient, auth: dict, monkeypatch
) -> None:
    from app.core.config import settings

    monkeypatch.setattr(settings, "auth_provider", "supabase")
    monkeypatch.setattr(settings, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(settings, "supabase_publishable_key", "sb_publishable_test")

    response = client.get("/api/auth/me", headers=auth)
    assert response.status_code == 401

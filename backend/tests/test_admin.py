from __future__ import annotations

import asyncio

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db.base import SessionLocal
from app.db.models import User


def _promote(email: str) -> None:
    async def run() -> None:
        async with SessionLocal() as db:
            user = await db.scalar(select(User).where(User.email == email))
            assert user is not None
            user.role = "admin"
            await db.commit()

    asyncio.run(run())


def test_admin_endpoints_require_admin_role(client: TestClient, auth: dict) -> None:
    forbidden = client.get("/api/admin/overview", headers=auth)
    assert forbidden.status_code == 403

    _promote("student@example.com")

    overview = client.get("/api/admin/overview", headers=auth)
    assert overview.status_code == 200, overview.text
    body = overview.json()
    assert body["users"] == 1
    assert body["admins"] == 1
    assert body["recent_users"][0]["role"] == "admin"

    me = client.get("/api/auth/me", headers=auth).json()
    assert me["role"] == "admin"

    demote_self = client.patch(
        f"/api/admin/users/{me['id']}/role",
        json={"role": "student"},
        headers=auth,
    )
    assert demote_self.status_code == 400

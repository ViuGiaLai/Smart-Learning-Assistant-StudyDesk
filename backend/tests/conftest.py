from __future__ import annotations

import os
from pathlib import Path

# Tests must not inherit the developer's .env (Postgres, MQTT enabled, etc.).
os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("MQTT_ENABLED", "false")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./test_smartstudy.db")
os.environ.setdefault("AUTH_PROVIDER", "local")
os.environ.setdefault("SUPABASE_URL", "")
os.environ.setdefault("GROQ_API_KEY", "")
os.environ.setdefault("GEMINI_API_KEY", "")
os.environ.setdefault("FIREBASE_CREDENTIALS_FILE", "")
# Pin the topic prefix: the demo .env uses a random prefix, and the API tests
# assert on the topic strings returned by /api/devices.
os.environ["MQTT_TOPIC_PREFIX"] = "smartstudy"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db.base import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(autouse=True)
def clean_database():
    """Fresh schema per test, isolated from the dev database."""
    import asyncio

    async def reset() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(reset())
    yield


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def auth(client: TestClient) -> dict[str, str]:
    response = client.post(
        "/api/auth/register",
        json={"email": "student@example.com", "name": "Minh", "password": "password123"},
    )
    assert response.status_code == 201, response.text
    token = response.json()["tokens"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def device(client: TestClient, auth: dict[str, str]) -> dict:
    response = client.post(
        "/api/devices/register",
        json={"device_code": "STUDY_DESK_001", "name": "Bàn học"},
        headers=auth,
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture(scope="session", autouse=True)
def _cleanup_db_file():
    yield
    db_file = Path("test_smartstudy.db")
    if db_file.exists():
        try:
            db_file.unlink()
        except PermissionError:
            pass

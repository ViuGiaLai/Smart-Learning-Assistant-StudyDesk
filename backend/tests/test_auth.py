from __future__ import annotations

from fastapi.testclient import TestClient


def test_register_login_refresh_and_me(client: TestClient) -> None:
    register = client.post(
        "/api/auth/register",
        json={"email": "Lan@Example.com", "name": "Lan", "password": "password123"},
    )
    assert register.status_code == 201, register.text
    body = register.json()
    assert body["user"]["email"] == "lan@example.com"
    assert body["tokens"]["access_token"]
    assert body["tokens"]["expires_in"] == 3600

    duplicate = client.post(
        "/api/auth/register",
        json={"email": "lan@example.com", "name": "Lan", "password": "password123"},
    )
    assert duplicate.status_code == 409

    bad_login = client.post(
        "/api/auth/login", json={"email": "lan@example.com", "password": "wrong-password"}
    )
    assert bad_login.status_code == 401

    login = client.post(
        "/api/auth/login", json={"email": "lan@example.com", "password": "password123"}
    )
    assert login.status_code == 200
    refresh_token = login.json()["tokens"]["refresh_token"]

    refreshed = client.post("/api/auth/refresh", json={"refresh_token": refresh_token})
    assert refreshed.status_code == 200
    new_access = refreshed.json()["access_token"]

    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {new_access}"})
    assert me.status_code == 200
    assert me.json()["name"] == "Lan"


def test_access_token_cannot_be_used_as_refresh_token(client: TestClient) -> None:
    register = client.post(
        "/api/auth/register",
        json={"email": "a@example.com", "name": "A", "password": "password123"},
    )
    access = register.json()["tokens"]["access_token"]
    response = client.post("/api/auth/refresh", json={"refresh_token": access})
    assert response.status_code == 401


def test_protected_endpoint_requires_token(client: TestClient) -> None:
    assert client.get("/api/devices").status_code == 401
    assert client.get("/api/devices", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_health(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_supabase_register_waits_for_email_confirmation(
    client: TestClient, monkeypatch
) -> None:
    from app.core.config import settings
    from app.services import supabase_auth

    async def fake_sign_up(
        email: str,
        password: str,
        name: str,
        redirect_to: str | None = None,
    ) -> dict:
        return {
            "id": "8f14e45f-ceea-467f-a8da-9f4b2c3d4e5f",
            "email": email,
            "user_metadata": {"name": name},
            "created_at": "2026-11-02T00:00:00Z",
        }

    monkeypatch.setattr(settings, "auth_provider", "supabase")
    monkeypatch.setattr(settings, "supabase_url", "https://demo.supabase.co")
    monkeypatch.setattr(settings, "supabase_publishable_key", "sb_publishable_test")
    monkeypatch.setattr(supabase_auth, "sign_up", fake_sign_up)

    response = client.post(
        "/api/auth/register",
        json={
            "email": "new@example.com",
            "name": "Người mới",
            "password": "password123",
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["tokens"] is None
    assert body["requires_email_confirmation"] is True
    assert body["user"]["name"] == "Người mới"
    assert body["user"]["role"] == "student"


def _enable_supabase(monkeypatch) -> None:
    from app.core.config import settings

    monkeypatch.setattr(settings, "auth_provider", "supabase")
    monkeypatch.setattr(settings, "supabase_url", "https://demo.supabase.co")
    monkeypatch.setattr(settings, "supabase_publishable_key", "sb_publishable_test")


def test_password_recovery_requires_supabase(client: TestClient) -> None:
    response = client.post(
        "/api/auth/forgot-password", json={"email": "someone@example.com"}
    )
    assert response.status_code == 503


def test_forgot_password_sends_recovery_email_with_deep_link(
    client: TestClient, monkeypatch
) -> None:
    from app.services import supabase_auth

    captured: dict[str, str | None] = {}

    async def fake_recover(email: str, redirect_to: str | None = None) -> dict:
        captured["email"] = email
        captured["redirect_to"] = redirect_to
        return {}

    _enable_supabase(monkeypatch)
    monkeypatch.setattr(supabase_auth, "recover", fake_recover)

    response = client.post(
        "/api/auth/forgot-password", json={"email": "Someone@Example.com"}
    )
    assert response.status_code == 202, response.text
    assert captured["email"] == "someone@example.com"
    assert captured["redirect_to"] == "smartstudy://reset-password"
    # Never reveal whether the address exists.
    assert "nếu email đã đăng ký" in response.json()["detail"].lower()


def test_forgot_password_does_not_leak_unknown_email(
    client: TestClient, monkeypatch
) -> None:
    from app.services import supabase_auth
    from app.services.supabase_auth import SupabaseAuthError

    async def fake_recover(email: str, redirect_to: str | None = None) -> dict:
        raise SupabaseAuthError(422, "User not found")

    _enable_supabase(monkeypatch)
    monkeypatch.setattr(supabase_auth, "recover", fake_recover)

    response = client.post(
        "/api/auth/forgot-password", json={"email": "ghost@example.com"}
    )
    assert response.status_code == 202
    assert "ghost@example.com" not in response.json()["detail"]


def test_reset_password_uses_recovery_token(client: TestClient, monkeypatch) -> None:
    from app.services import supabase_auth

    captured: dict[str, str] = {}

    async def fake_update(access_token: str, new_password: str) -> dict:
        captured["token"] = access_token
        captured["password"] = new_password
        return {}

    _enable_supabase(monkeypatch)
    monkeypatch.setattr(supabase_auth, "update_password", fake_update)

    response = client.post(
        "/api/auth/reset-password",
        json={"access_token": "r" * 40, "new_password": "newpassword123"},
    )
    assert response.status_code == 200, response.text
    assert captured == {"token": "r" * 40, "password": "newpassword123"}


def test_reset_password_rejects_expired_link(client: TestClient, monkeypatch) -> None:
    from app.services import supabase_auth
    from app.services.supabase_auth import SupabaseAuthError

    async def fake_update(access_token: str, new_password: str) -> dict:
        raise SupabaseAuthError(401, "Liên kết đặt lại mật khẩu đã hết hạn")

    _enable_supabase(monkeypatch)
    monkeypatch.setattr(supabase_auth, "update_password", fake_update)

    response = client.post(
        "/api/auth/reset-password",
        json={"access_token": "r" * 40, "new_password": "newpassword123"},
    )
    assert response.status_code == 401
    assert "hết hạn" in response.json()["detail"]


def test_resend_confirmation_is_idempotent(client: TestClient, monkeypatch) -> None:
    from app.services import supabase_auth

    sent: list[str] = []

    async def fake_resend(email: str) -> dict:
        sent.append(email)
        return {}

    _enable_supabase(monkeypatch)
    monkeypatch.setattr(supabase_auth, "resend_confirmation", fake_resend)

    response = client.post(
        "/api/auth/resend-confirmation", json={"email": "new@example.com"}
    )
    assert response.status_code == 202
    assert sent == ["new@example.com"]

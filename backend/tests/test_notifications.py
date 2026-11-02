from __future__ import annotations

from fastapi.testclient import TestClient


def _token() -> str:
    return "fcm-test-token-" + "x" * 40


def test_register_send_and_history(client: TestClient, auth: dict) -> None:
    registered = client.post(
        "/api/notifications/register-device",
        json={"token": _token(), "platform": "android"},
        headers=auth,
    )
    assert registered.status_code == 200, registered.text
    assert registered.json()["registered"] is True

    sent = client.post(
        "/api/notifications/send",
        json={"title": "Nhắc học", "body": "Đã đến giờ học môn Lập trình Python."},
        headers=auth,
    )
    assert sent.status_code == 200, sent.text
    body = sent.json()
    assert body["notification"]["title"] == "Nhắc học"
    assert body["push"]["enabled"] is False
    assert body["push"]["detail"]

    history = client.get("/api/notifications", headers=auth)
    assert history.status_code == 200
    assert any(item["title"] == "Nhắc học" for item in history.json())

    removed = client.request(
        "DELETE",
        "/api/notifications/register-device",
        json={"token": _token()},
        headers=auth,
    )
    assert removed.status_code == 200
    assert removed.json()["unregistered"] is True


def test_send_to_user_requires_admin(client: TestClient, auth: dict) -> None:
    me = client.get("/api/auth/me", headers=auth).json()
    response = client.post(
        "/api/notifications/send-to-user",
        json={"user_id": me["id"], "title": "Admin", "body": "Chỉ admin gửi được"},
        headers=auth,
    )
    assert response.status_code == 403


def test_register_token_validates_length(client: TestClient, auth: dict) -> None:
    response = client.post(
        "/api/notifications/register-device",
        json={"token": "short", "platform": "android"},
        headers=auth,
    )
    assert response.status_code == 422

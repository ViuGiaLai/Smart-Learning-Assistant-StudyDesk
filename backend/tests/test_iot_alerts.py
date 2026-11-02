from __future__ import annotations

from fastapi.testclient import TestClient


def _alert(message_id: str, alert_type: str = "HIGH_TEMPERATURE") -> dict:
    return {
        "device_id": "STUDY_DESK_001",
        "message_id": message_id,
        "temperature": 35.5,
        "humidity": 70,
        "light": 120,
        "motion": 1,
        "alert_type": alert_type,
    }


def _headers(device: dict) -> dict[str, str]:
    return {
        "X-Device-Code": device["device_code"],
        "X-Device-Key": device["device_key"],
    }


def test_device_alert_creates_notification_and_reading(
    client: TestClient, auth: dict, device: dict
) -> None:
    response = client.post(
        "/api/iot/alerts", json=_alert("alert-1"), headers=_headers(device)
    )
    assert response.status_code == 202, response.text
    body = response.json()
    assert body["stored"] is True
    assert body["duplicate"] is False
    assert body["alert"]["type"] == "temperature_high"
    assert body["push"]["enabled"] is False

    notifications = client.get("/api/notifications", headers=auth).json()
    assert notifications[0]["type"] == "temperature_high"
    assert "35.5" in notifications[0]["content"]

    latest = client.get(f"/api/devices/{device['id']}/readings/latest", headers=auth)
    assert latest.json()["message_id"] == "alert-1"

    repeat = client.post(
        "/api/iot/alerts", json=_alert("alert-2"), headers=_headers(device)
    )
    assert repeat.status_code == 202
    assert repeat.json()["alert"] is None

    notifications = client.get("/api/notifications", headers=auth).json()
    assert [item["type"] for item in notifications].count("temperature_high") == 1


def test_device_alert_requires_device_key(
    client: TestClient, device: dict
) -> None:
    response = client.post(
        "/api/iot/alerts",
        json=_alert("alert-bad"),
        headers={
            "X-Device-Code": device["device_code"],
            "X-Device-Key": "sk_wrong",
        },
    )
    assert response.status_code == 401

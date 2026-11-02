from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect


def _telemetry(message_id: str, **overrides) -> dict:
    payload = {
        "message_id": message_id,
        "temperature": 29.5,
        "humidity": 68,
        "light": 120,
        "motion_detected": True,
        "timestamp": "2026-11-01T20:30:00Z",
    }
    payload.update(overrides)
    return payload


def _device_headers(device: dict) -> dict[str, str]:
    return {
        "X-Device-Code": device["device_code"],
        "X-Device-Key": device["device_key"],
    }


def test_register_device_returns_key_and_topics(
    client: TestClient, auth: dict, device: dict
) -> None:
    assert device["device_key"].startswith("sk_")
    assert device["mqtt_topics"]["telemetry"] == "smartstudy/STUDY_DESK_001/telemetry"
    assert device["settings"]["light_min_lux"] == 150.0

    status = client.get(f"/api/devices/{device['id']}/status", headers=auth)
    assert status.status_code == 200
    assert status.json()["online"] is False


def test_telemetry_is_idempotent_and_estimates_lux(
    client: TestClient, auth: dict, device: dict
) -> None:
    first = client.post(
        "/api/iot/telemetry", json=_telemetry("msg-1"), headers=_device_headers(device)
    )
    assert first.status_code == 202, first.text
    body = first.json()
    assert body["stored"] is True
    assert body["duplicate"] is False
    assert body["reading"]["light_lux"] is not None
    assert body["reading"]["light_lux"] < 5

    # Resent message (MQTT QoS 1 retry) must not create a second row.
    second = client.post(
        "/api/iot/telemetry", json=_telemetry("msg-1"), headers=_device_headers(device)
    )
    assert second.status_code == 202
    assert second.json()["duplicate"] is True
    assert second.json()["stored"] is False

    page = client.get(f"/api/devices/{device['id']}/readings", headers=auth)
    assert page.status_code == 200
    assert page.json()["total"] == 1

    latest = client.get(f"/api/devices/{device['id']}/readings/latest", headers=auth)
    assert latest.json()["message_id"] == "msg-1"

    status = client.get(f"/api/devices/{device['id']}/status", headers=auth)
    assert status.json()["online"] is True


def test_device_credentials_are_checked(client: TestClient, device: dict) -> None:
    bad = client.post(
        "/api/iot/telemetry",
        json=_telemetry("msg-bad"),
        headers={"X-Device-Code": device["device_code"], "X-Device-Key": "sk_wrong"},
    )
    assert bad.status_code == 401


def test_low_light_creates_one_alert_per_cooldown(
    client: TestClient, auth: dict, device: dict
) -> None:
    first = client.post(
        "/api/iot/telemetry", json=_telemetry("msg-1"), headers=_device_headers(device)
    ).json()
    assert [alert["type"] for alert in first["alerts"]] == ["light_low"]

    second = client.post(
        "/api/iot/telemetry", json=_telemetry("msg-2"), headers=_device_headers(device)
    ).json()
    assert second["alerts"] == []

    notifications = client.get("/api/notifications", headers=auth, params={"unread_only": True})
    assert notifications.status_code == 200
    types = [item["type"] for item in notifications.json()]
    assert types.count("light_low") == 1


def test_collection_switch_stops_storing(
    client: TestClient, auth: dict, device: dict
) -> None:
    updated = client.patch(
        f"/api/devices/{device['id']}",
        json={"settings": {"collection_enabled": False}},
        headers=auth,
    )
    assert updated.status_code == 200
    assert updated.json()["settings"]["collection_enabled"] is False

    response = client.post(
        "/api/iot/telemetry", json=_telemetry("msg-off"), headers=_device_headers(device)
    )
    assert response.status_code == 202
    assert response.json()["stored"] is False
    assert response.json()["collection_enabled"] is False

    page = client.get(f"/api/devices/{device['id']}/readings", headers=auth)
    assert page.json()["total"] == 0


def test_other_users_cannot_read_or_command(
    client: TestClient, device: dict
) -> None:
    other = client.post(
        "/api/auth/register",
        json={"email": "other@example.com", "name": "Other", "password": "password123"},
    )
    headers = {"Authorization": f"Bearer {other.json()['tokens']['access_token']}"}

    assert client.get(f"/api/devices/{device['id']}/readings", headers=headers).status_code == 404
    assert (
        client.post(
            f"/api/devices/{device['id']}/commands",
            json={"action": "set_led", "value": True},
            headers=headers,
        ).status_code
        == 404
    )


def test_command_reports_mqtt_unavailable(client: TestClient, auth: dict, device: dict) -> None:
    response = client.post(
        f"/api/devices/{device['id']}/commands",
        json={"action": "set_led", "value": True},
        headers=auth,
    )
    assert response.status_code == 202
    body = response.json()
    assert body["topic"] == "smartstudy/STUDY_DESK_001/command"
    assert body["delivered"] is False


def test_command_validates_value(client: TestClient, auth: dict, device: dict) -> None:
    response = client.post(
        f"/api/devices/{device['id']}/commands",
        json={"action": "set_led", "value": "yes"},
        headers=auth,
    )
    assert response.status_code == 422


def test_websocket_snapshot_and_auth(client: TestClient, auth: dict, device: dict) -> None:
    client.post(
        "/api/iot/telemetry", json=_telemetry("msg-ws"), headers=_device_headers(device)
    )
    token = auth["Authorization"].split(" ", 1)[1]
    with client.websocket_connect(f"/ws/devices/{device['id']}?token={token}") as ws:
        snapshot = ws.receive_json()
        assert snapshot["event"] == "snapshot"
        assert snapshot["data"]["latest_reading"]["message_id"] == "msg-ws"
        ws.send_text("ping")
        assert ws.receive_json()["event"] == "pong"

    # Token of another user must be rejected.
    other = client.post(
        "/api/auth/register",
        json={"email": "ws@example.com", "name": "WS", "password": "password123"},
    )
    other_token = other.json()["tokens"]["access_token"]
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(
            f"/ws/devices/{device['id']}?token={other_token}"
        ) as ws:
            ws.receive_json()

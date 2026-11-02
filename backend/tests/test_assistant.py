from __future__ import annotations

from fastapi.testclient import TestClient


def test_context_without_device(client: TestClient, auth: dict) -> None:
    response = client.get("/api/assistant/context", headers=auth)
    assert response.status_code == 200
    body = response.json()
    assert body["device_online"] is False
    assert body["latest_temperature"] is None
    assert any("thiết bị" in suggestion.lower() for suggestion in body["suggestions"])


def test_chat_uses_rule_based_fallback_without_gemini_key(
    client: TestClient, auth: dict, device: dict
) -> None:
    client.post(
        "/api/iot/telemetry",
        json={
            "message_id": "ai-1",
            "temperature": 33.2,
            "humidity": 80,
            "light": 100,
            "motion_detected": True,
        },
        headers={"X-Device-Code": device["device_code"], "X-Device-Key": device["device_key"]},
    )

    response = client.post(
        "/api/assistant/chat",
        json={"message": "Môi trường học của tôi thế nào?"},
        headers=auth,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["source"] == "rule_based"
    assert body["conversation_id"]
    assert "33.2" in body["answer"]
    assert body["suggestions"]
    assert "không phải tư vấn y tế" in body["answer"]

    history = client.get("/api/assistant/history", headers=auth)
    assert history.status_code == 200
    assert len(history.json()) == 1

    follow_up = client.post(
        "/api/assistant/chat",
        json={
            "message": "Gợi ý thêm giúp tôi",
            "conversation_id": body["conversation_id"],
        },
        headers=auth,
    )
    assert follow_up.json()["conversation_id"] == body["conversation_id"]

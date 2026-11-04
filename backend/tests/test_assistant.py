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


def test_chat_passes_conversation_history_to_model(
    client: TestClient, auth: dict, monkeypatch
) -> None:
    from app.services import ai

    captured: list[list[dict[str, str]]] = []

    async def fake_groq(
        context: dict, message: str, history: list[dict[str, str]] | None = None
    ) -> str:
        captured.append(list(history or []))
        return "Trả lời ngắn gọn"

    monkeypatch.setattr(ai.settings, "groq_api_key", "test-key")
    monkeypatch.setattr(ai, "_call_groq", fake_groq)

    first = client.post(
        "/api/assistant/chat", json={"message": "Câu hỏi đầu tiên"}, headers=auth
    )
    assert first.status_code == 200, first.text
    conversation_id = first.json()["conversation_id"]
    assert captured[0] == []

    follow_up = client.post(
        "/api/assistant/chat",
        json={"message": "Hỏi tiếp", "conversation_id": conversation_id},
        headers=auth,
    )
    assert follow_up.status_code == 200, follow_up.text
    assert captured[1][0] == {"role": "user", "content": "Câu hỏi đầu tiên"}
    assert captured[1][1]["role"] == "assistant"


def test_clean_answer_keeps_bold_markup() -> None:
    from app.services.ai import _clean_answer

    assert _clean_answer("**Đậm** và `code`\n## Tiêu đề\n\n\nHết  ") == (
        "**Đậm** và code\nTiêu đề\n\nHết"
    )


def test_chat_prefers_groq_when_configured(
    client: TestClient, auth: dict, monkeypatch
) -> None:
    from app.services import ai

    async def fake_groq(
        context: dict, message: str, history: list[dict[str, str]] | None = None
    ) -> str:
        return "Trả lời từ Groq"

    monkeypatch.setattr(ai.settings, "groq_api_key", "test-key")
    monkeypatch.setattr(ai, "_call_groq", fake_groq)

    response = client.post(
        "/api/assistant/chat",
        json={"message": "Xin chào"},
        headers=auth,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["source"] == "groq"
    assert body["model"] == ai.settings.groq_model
    assert body["answer"] == "Trả lời từ Groq"

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import UTCDateTime


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    conversation_id: str | None = None


class ChatResponse(BaseModel):
    conversation_id: str
    answer: str
    suggestions: list[str] = Field(default_factory=list)
    source: Literal["groq", "gemini", "rule_based"]
    model: str
    created_at: UTCDateTime


class AssistantContextOut(BaseModel):
    """Optional helper endpoint used by the app to render the context chip."""

    latest_temperature: float | None
    latest_humidity: float | None
    latest_light_lux: float | None
    device_online: bool
    today_focused_seconds: int
    suggestions: list[str]

from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.schemas.assistant import AssistantContextOut, ChatRequest, ChatResponse
from app.services.ai import build_context, chat, rule_based_suggestions
from app.services.sensors import estimate_lux

router = APIRouter(prefix="/assistant", tags=["AI assistant"])


@router.post("/chat", response_model=ChatResponse)
async def assistant_chat(
    payload: ChatRequest, user: CurrentUser, db: DbSession
) -> ChatResponse:
    return await chat(db, user, payload.message, payload.conversation_id)


@router.get("/context", response_model=AssistantContextOut)
async def assistant_context(user: CurrentUser, db: DbSession) -> AssistantContextOut:
    context = await build_context(db, user)
    env = context.get("environment") or {}
    device = context.get("device") or {}

    light = env.get("light_lux")
    if light is None and env.get("light_raw") is not None:
        light = estimate_lux(env["light_raw"])

    study = context.get("study") or {}
    return AssistantContextOut(
        latest_temperature=env.get("temperature_c"),
        latest_humidity=env.get("humidity_pct"),
        latest_light_lux=light,
        device_online=device.get("status") == "online",
        today_focused_seconds=int(study.get("today_focused_minutes", 0) * 60),
        suggestions=rule_based_suggestions(context),
    )


@router.get("/history")
async def assistant_history(
    user: CurrentUser, db: DbSession, limit: int = 20
) -> list[dict]:
    from app.db.models import AIConversation

    result = await db.execute(
        select(AIConversation)
        .where(AIConversation.user_id == user.id)
        .order_by(AIConversation.created_at.desc())
        .limit(min(limit, 100))
    )
    return [
        {
            "id": row.id,
            "conversation_id": row.conversation_id,
            "question": row.question,
            "response": row.response,
            "created_at": row.created_at.isoformat() + "Z",
        }
        for row in result.scalars().all()
    ]

from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.time import iso_z, utcnow
from app.db.models import AIConversation, Device, SensorReading, StudyPlan, StudySession, User
from app.schemas.assistant import ChatResponse
from app.services.sensors import estimate_lux
from app.services.stats import get_study_stats

logger = logging.getLogger(__name__)

SYSTEM_INSTRUCTION = """Bạn là trợ lý học tập trong ứng dụng Smart Learning Assistant,
luôn trả lời bằng tiếng Việt.

Mục tiêu: giúp người học hiểu đúng câu hỏi và biết việc cần làm tiếp theo.

Quy tắc trả lời:
- Trả lời TRỰC TIẾP vào đúng câu hỏi ngay câu đầu tiên; không chào hỏi dài dòng,
  không nhắc lại câu hỏi.
- Ngắn gọn: tối đa 120 từ (3-5 câu) hoặc tối đa 4 gạch đầu dòng. Không giải thích lan man,
  không liệt kê số liệu không được hỏi.
- Chỉ nêu số liệu có trong "Dữ liệu người học" và chỉ khi liên quan đến câu hỏi; không bịa
  số liệu, không tự tính toán ngoài dữ liệu.
- Nếu câu hỏi mơ hồ: đưa câu trả lời hữu ích ngắn nhất, rồi hỏi lại đúng một câu để làm rõ.
- Nếu câu hỏi ngoài phạm vi học tập: trả lời ngắn trong hiểu biết chung, rồi hướng về việc học
  nếu phù hợp.
- Cảm biến không phải thiết bị y tế: không chẩn đoán, không tư vấn y tế; nếu có triệu chứng,
  khuyên gặp chuyên gia y tế.
- Không khuyến khích học quá sức; nhắc nghỉ ngắn khi phiên học kéo dài.
- Không dùng markdown ngoài **in đậm**: chỉ dùng **...** để làm nổi bật 1-2 giá trị quan trọng
  nhất; không dùng ##, bảng hay backtick. Chỉ dùng gạch đầu dòng khi liệt kê bước làm.
- Nếu chỉ là lời chào hoặc cảm ơn: đáp lại một câu ngắn và gợi ý một việc nên làm tiếp theo."""

# How many previous turns to send back to the model so follow-up questions
# ("gợi ý thêm", "vậy còn cách nào khác?") stay on topic.
HISTORY_TURNS = 4
HISTORY_QUESTION_CHARS = 800
HISTORY_ANSWER_CHARS = 600


def _context_block(context: dict[str, Any]) -> str:
    return (
        "Dữ liệu người học (chỉ tham khảo, bỏ qua nếu không liên quan đến câu hỏi):\n"
        + json.dumps(context, ensure_ascii=False, default=str)
    )


async def build_context(db: AsyncSession, user: User) -> dict[str, Any]:
    devices = list(
        (
            await db.execute(
                select(Device).where(Device.user_id == user.id).order_by(Device.created_at)
            )
        )
        .scalars()
        .all()
    )
    device = devices[0] if devices else None

    latest: SensorReading | None = None
    if device is not None:
        latest = await db.scalar(
            select(SensorReading)
            .where(SensorReading.device_id == device.id)
            .order_by(SensorReading.recorded_at.desc())
            .limit(1)
        )

    stats = await get_study_stats(db, user)
    active_session = await db.scalar(
        select(StudySession).where(
            StudySession.user_id == user.id, StudySession.status == "running"
        )
    )
    plans = list(
        (
            await db.execute(
                select(StudyPlan)
                .where(
                    StudyPlan.user_id == user.id,
                    StudyPlan.status.in_(["pending", "in_progress"]),
                )
                .order_by(StudyPlan.created_at)
                .limit(5)
            )
        )
        .scalars()
        .all()
    )

    context: dict[str, Any] = {
        "user": {"name": user.name, "daily_goal_minutes": user.daily_goal_minutes},
        "device": None,
        "environment": None,
        "study": {
            "today_focused_minutes": round(stats.today_focused_seconds / 60, 1),
            "today_sessions": stats.today_sessions,
            "week_focused_minutes": round(stats.week_focused_seconds / 60, 1),
            "goal_completion_rate": stats.goal_completion_rate,
            "active_session_minutes": (
                round(_running_minutes(active_session), 1) if active_session else 0
            ),
        },
        "plans": [
            {
                "title": plan.title,
                "planned_minutes": plan.planned_minutes,
                "status": plan.status,
            }
            for plan in plans
        ],
    }
    if device is not None:
        thresholds = device.settings or {}
        context["device"] = {
            "name": device.name,
            "status": device.status,
            "last_seen_at": iso_z(device.last_seen_at),
        }
        if latest is not None:
            context["environment"] = {
                "temperature_c": latest.temperature,
                "humidity_pct": latest.humidity,
                "light_raw": latest.light_raw,
                "light_lux": latest.light_lux
                if latest.light_lux is not None
                else estimate_lux(latest.light_raw),
                "motion_detected": latest.motion_detected,
                "recorded_at": iso_z(latest.recorded_at),
                "thresholds": {
                    "temperature_min": thresholds.get("temperature_min"),
                    "temperature_max": thresholds.get("temperature_max"),
                    "humidity_min": thresholds.get("humidity_min"),
                    "humidity_max": thresholds.get("humidity_max"),
                    "light_min_lux": thresholds.get("light_min_lux"),
                },
            }
    return context


def _running_minutes(session: StudySession) -> float:
    from app.services.stats import session_duration_seconds

    return session_duration_seconds(session) / 60


def rule_based_suggestions(context: dict[str, Any]) -> list[str]:
    suggestions: list[str] = []
    device = context.get("device")
    env = context.get("environment")

    if device is None:
        suggestions.append("Đăng ký thiết bị bàn học để nhận gợi ý về môi trường học.")
        return suggestions
    if device.get("status") != "online":
        suggestions.append("Thiết bị đang offline: kiểm tra nguồn và kết nối Wi-Fi của ESP32.")

    if env:
        thresholds = env.get("thresholds") or {}
        light = env.get("light_lux")
        if light is not None and thresholds.get("light_min_lux") is not None:
            if light < thresholds["light_min_lux"]:
                suggestions.append(
                    f"Ánh sáng khoảng {light:.0f} lux, dưới ngưỡng "
                    f"{thresholds['light_min_lux']:.0f} lux — hãy bật đèn bàn."
                )
        temperature = env.get("temperature_c")
        if temperature is not None and thresholds.get("temperature_max") is not None:
            if temperature > thresholds["temperature_max"]:
                suggestions.append(
                    f"Nhiệt độ {temperature:.1f}°C đang cao — mở cửa hoặc bật quạt để dễ tập trung."
                )
            elif thresholds.get("temperature_min") is not None and (
                temperature < thresholds["temperature_min"]
            ):
                suggestions.append(f"Nhiệt độ {temperature:.1f}°C đang thấp — giữ ấm khi học.")
        humidity = env.get("humidity_pct")
        if humidity is not None and thresholds.get("humidity_max") is not None:
            if humidity > thresholds["humidity_max"]:
                suggestions.append(f"Độ ẩm {humidity:.0f}% cao — thông gió phòng học.")
    else:
        suggestions.append("Chưa có dữ liệu cảm biến cho thiết bị này.")

    study = context.get("study") or {}
    today_minutes = study.get("today_focused_minutes", 0)
    goal = (context.get("user") or {}).get("daily_goal_minutes", 120)
    if today_minutes < goal:
        remaining = max(0, round(goal - today_minutes))
        suggestions.append(
            f"Hôm nay bạn đã học {today_minutes:.0f}/{goal} phút — còn khoảng {remaining} phút "
            "để đạt mục tiêu. Thử một phiên Pomodoro 25 phút."
        )
    else:
        suggestions.append("Bạn đã đạt mục tiêu hôm nay — nghỉ ngơi để giữ nhịp học bền vững.")
    if study.get("active_session_minutes", 0) >= 50:
        suggestions.append("Bạn đã tập trung khá lâu — hãy nghỉ 5 phút trước khi tiếp tục.")
    return suggestions[:5]


def _fallback_answer(context: dict[str, Any], suggestions: list[str]) -> str:
    study = context.get("study") or {}
    env = context.get("environment")
    parts = [
        f"Chào {context['user']['name']}! Hôm nay bạn đã tập trung "
        f"{study.get('today_focused_minutes', 0):.0f} phút trong "
        f"{study.get('today_sessions', 0)} phiên học."
    ]
    if env:
        parts.append(
            "Môi trường hiện tại: "
            f"{env.get('temperature_c') or '—'}°C, "
            f"{env.get('humidity_pct') or '—'}% độ ẩm, "
            f"khoảng {env.get('light_lux') or 0:.0f} lux."
        )
    else:
        parts.append("Hiện chưa có dữ liệu cảm biến mới từ bàn học.")
    if suggestions:
        parts.append("Gợi ý: " + " ".join(suggestions[:2]))
    parts.append(
        "(Trả lời tự động vì chưa cấu hình khóa AI. Dữ liệu cảm biến chỉ mang tính tham khảo, "
        "không phải tư vấn y tế.)"
    )
    return "\n\n".join(parts)


async def _load_history(
    db: AsyncSession, user: User, conversation_id: str | None
) -> list[dict[str, str]]:
    """Return the last few Q/A turns of this conversation, oldest first."""
    if not conversation_id:
        return []
    rows = (
        (
            await db.execute(
                select(AIConversation)
                .where(
                    AIConversation.user_id == user.id,
                    AIConversation.conversation_id == conversation_id,
                )
                .order_by(AIConversation.created_at.desc())
                .limit(HISTORY_TURNS)
            )
        )
        .scalars()
        .all()
    )
    history: list[dict[str, str]] = []
    for row in reversed(rows):
        history.append({"role": "user", "content": row.question[:HISTORY_QUESTION_CHARS]})
        history.append({"role": "assistant", "content": row.response[:HISTORY_ANSWER_CHARS]})
    return history


def _clean_answer(text: str) -> str:
    """Tidy assistant output while keeping the **bold** markers the app renders."""
    cleaned = text.replace("__", "").replace("`", "")
    cleaned = re.sub(r"^\s*#{1,6}\s*", "", cleaned, flags=re.MULTILINE)
    cleaned = "\n".join(line.rstrip() for line in cleaned.splitlines())
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


async def _call_groq(
    context: dict[str, Any], message: str, history: list[dict[str, str]] | None = None
) -> str | None:
    if not settings.groq_api_key:
        return None
    messages: list[dict[str, str]] = [
        {"role": "system", "content": f"{SYSTEM_INSTRUCTION}\n\n{_context_block(context)}"}
    ]
    messages.extend(history or [])
    messages.append({"role": "user", "content": message})
    payload = {
        "model": settings.groq_model,
        "temperature": 0.3,
        "max_tokens": 800,
        "messages": messages,
    }
    if settings.groq_model.startswith("openai/gpt-oss"):
        # Reasoning models spend tokens on hidden reasoning; "low" keeps
        # latency and verbosity down for short chat answers.
        payload["reasoning_effort"] = "low"
    try:
        async with httpx.AsyncClient(timeout=settings.ai_timeout_seconds) as client:
            response = await client.post(
                f"{settings.groq_base_url.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {settings.groq_api_key}"},
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
        choices = data.get("choices") or []
        if not choices:
            logger.warning("Groq returned no choices")
            return None
        text = (choices[0].get("message") or {}).get("content") or ""
        return text.strip() or None
    except Exception as exc:  # noqa: BLE001 - fall back instead of failing chat
        logger.warning("Groq call failed: %s", exc)
        return None


async def _call_gemini(
    context: dict[str, Any], message: str, history: list[dict[str, str]] | None = None
) -> str | None:
    if not settings.gemini_api_key:
        return None
    contents = [
        {
            "role": "user" if turn["role"] == "user" else "model",
            "parts": [{"text": turn["content"]}],
        }
        for turn in (history or [])
    ]
    contents.append({"role": "user", "parts": [{"text": message}]})
    url = f"{settings.gemini_base_url}/models/{settings.gemini_model}:generateContent"
    payload = {
        "systemInstruction": {
            "parts": [{"text": f"{SYSTEM_INSTRUCTION}\n\n{_context_block(context)}"}]
        },
        "contents": contents,
        "generationConfig": {"temperature": 0.3, "maxOutputTokens": 420},
    }
    try:
        async with httpx.AsyncClient(timeout=settings.ai_timeout_seconds) as client:
            response = await client.post(
                url,
                headers={"x-goog-api-key": settings.gemini_api_key},
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
        candidates = data.get("candidates") or []
        if not candidates:
            logger.warning("Gemini returned no candidates: %s", data.get("promptFeedback"))
            return None
        parts = candidates[0].get("content", {}).get("parts", [])
        text = "".join(part.get("text", "") for part in parts).strip()
        return text or None
    except Exception as exc:  # noqa: BLE001 - never break chat on provider errors
        logger.warning("Gemini call failed: %s", exc)
        return None


async def chat(
    db: AsyncSession,
    user: User,
    message: str,
    conversation_id: str | None = None,
) -> ChatResponse:
    context = await build_context(db, user)
    suggestions = rule_based_suggestions(context)
    history = await _load_history(db, user, conversation_id)

    answer: str | None = None
    source = "rule_based"
    model = "rule-based"
    providers: list[str] = []
    if settings.ai_provider in {"auto", "groq"} and settings.groq_api_key:
        providers.append("groq")
    if settings.ai_provider in {"auto", "gemini"} and settings.gemini_api_key:
        providers.append("gemini")

    for provider in providers:
        if provider == "groq":
            answer = await _call_groq(context, message, history)
            if answer:
                source, model = "groq", settings.groq_model
        else:
            answer = await _call_gemini(context, message, history)
            if answer:
                source, model = "gemini", settings.gemini_model
        if answer:
            break

    if answer:
        answer = _clean_answer(answer)
    else:
        answer = _fallback_answer(context, suggestions)

    conversation_id = conversation_id or str(uuid.uuid4())
    db.add(
        AIConversation(
            user_id=user.id,
            conversation_id=conversation_id,
            question=message[:4000],
            response=answer[:8000],
            context=context,
        )
    )
    await db.commit()

    return ChatResponse(
        conversation_id=conversation_id,
        answer=answer,
        suggestions=suggestions,
        source=source,
        model=model,
        created_at=utcnow(),
    )

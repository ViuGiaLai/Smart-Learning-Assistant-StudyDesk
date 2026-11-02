from __future__ import annotations

import json
import logging
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

SYSTEM_INSTRUCTION = """Bạn là trợ lý học tập của ứng dụng Smart Learning Assistant.
Nhiệm vụ: giúp sinh viên lập kế hoạch, duy trì tập trung và cải thiện môi trường học tập.

Quy tắc bắt buộc:
- Trả lời bằng tiếng Việt, ngắn gọn, thực tế, tối đa khoảng 250 từ.
- Chỉ dùng dữ liệu cảm biến được cung cấp; không bịa số liệu.
- Cảm biến môi trường không phải thiết bị y tế. Không chẩn đoán bệnh, không đưa lời khuyên
  y tế. Nếu người dùng mô tả triệu chứng, khuyên họ gặp chuyên gia y tế.
- Gợi ý thay đổi môi trường dựa trên ngưỡng người dùng đã cấu hình.
- Khuyến khích nghỉ ngơi hợp lý, không khuyến khích học quá sức.
- Nếu thiếu dữ liệu, nói rõ là chưa có dữ liệu thay vì suy đoán."""


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
        parts.append("Gợi ý: " + " ".join(suggestions[:3]))
    parts.append(
        "(Trả lời tự động vì chưa cấu hình GROQ_API_KEY hoặc GEMINI_API_KEY. "
        "Dữ liệu cảm biến chỉ mang tính tham khảo, không phải tư vấn y tế.)"
    )
    return "\n\n".join(parts)


async def _call_groq(context: dict[str, Any], message: str) -> str | None:
    if not settings.groq_api_key:
        return None
    prompt = (
        "Dữ liệu người học (JSON):\n"
        f"{json.dumps(context, ensure_ascii=False, default=str)}\n\n"
        f"Câu hỏi của người học: {message}"
    )
    payload = {
        "model": settings.groq_model,
        "temperature": 0.4,
        "max_tokens": 900,
        "messages": [
            {"role": "system", "content": SYSTEM_INSTRUCTION},
            {"role": "user", "content": prompt},
        ],
    }
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


async def _call_gemini(context: dict[str, Any], message: str) -> str | None:
    if not settings.gemini_api_key:
        return None
    prompt = (
        "Dữ liệu người học (JSON):\n"
        f"{json.dumps(context, ensure_ascii=False, default=str)}\n\n"
        f"Câu hỏi của người học: {message}"
    )
    url = f"{settings.gemini_base_url}/models/{settings.gemini_model}:generateContent"
    payload = {
        "systemInstruction": {"parts": [{"text": SYSTEM_INSTRUCTION}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.4, "maxOutputTokens": 900},
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
            answer = await _call_groq(context, message)
            if answer:
                source, model = "groq", settings.groq_model
        else:
            answer = await _call_gemini(context, message)
            if answer:
                source, model = "gemini", settings.gemini_model
        if answer:
            break

    if not answer:
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

from __future__ import annotations

import logging
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.db.models import Notification, StudyPlan
from app.services import fcm

logger = logging.getLogger(__name__)


async def send_due_study_reminders(db: AsyncSession) -> int:
    """Create and push at most one reminder per plan.

    Runs every minute from the lifespan task. A 5-minute look-ahead matches the
    app's reminder expectation without needing a scheduler service.
    """
    now = utcnow()
    window_end = now + timedelta(minutes=5)
    overdue_limit = now - timedelta(hours=1)

    plans = list(
        (
            await db.execute(
                select(StudyPlan)
                .where(
                    StudyPlan.status == "pending",
                    StudyPlan.reminder_sent_at.is_(None),
                    StudyPlan.scheduled_start.is_not(None),
                    StudyPlan.scheduled_start <= window_end,
                    StudyPlan.scheduled_start >= overdue_limit,
                )
                .order_by(StudyPlan.scheduled_start)
            )
        )
        .scalars()
        .all()
    )
    if not plans:
        return 0

    created: list[tuple[str, str, Notification]] = []
    for plan in plans:
        title = f"Đã đến giờ học: {plan.title}"[:200]
        notification = Notification(
            user_id=plan.user_id,
            type="study_reminder",
            title=title,
            content=(
                f"Kế hoạch “{plan.title}” đã đến giờ. Mở ứng dụng để bắt đầu "
                f"phiên tập trung {plan.planned_minutes} phút."
            )[:1000],
        )
        plan.reminder_sent_at = now
        db.add(notification)
        created.append((plan.user_id, plan.id, notification))

    await db.commit()

    for user_id, plan_id, notification in created:
        await fcm.send_to_user(
            db,
            user_id,
            notification.title,
            notification.content,
            {"type": "study_reminder", "plan_id": plan_id},
        )

    logger.info("study_reminders=%s", len(created))
    return len(created)

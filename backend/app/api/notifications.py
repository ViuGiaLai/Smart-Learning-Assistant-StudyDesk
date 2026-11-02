from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select, update

from app.api.deps import CurrentUser, DbSession
from app.db.models import Notification
from app.schemas.device import NotificationOut

router = APIRouter(prefix="/notifications", tags=["Notifications"])


@router.get("", response_model=list[NotificationOut])
async def list_notifications(
    user: CurrentUser,
    db: DbSession,
    unread_only: bool = False,
    limit: int = Query(default=30, ge=1, le=100),
) -> list[NotificationOut]:
    query = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        query = query.where(Notification.is_read.is_(False))
    result = await db.execute(
        query.order_by(Notification.created_at.desc()).limit(limit)
    )
    return [NotificationOut.model_validate(row) for row in result.scalars().all()]


@router.post("/{notification_id}/read", response_model=NotificationOut)
async def mark_read(
    notification_id: str, user: CurrentUser, db: DbSession
) -> NotificationOut:
    notification = await db.get(Notification, notification_id)
    if notification is None or notification.user_id != user.id:
        raise HTTPException(status_code=404, detail="Không tìm thấy thông báo")
    notification.is_read = True
    await db.commit()
    await db.refresh(notification)
    return NotificationOut.model_validate(notification)


@router.post("/read-all")
async def mark_all_read(user: CurrentUser, db: DbSession) -> dict[str, int]:
    result = await db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.is_read.is_(False))
        .values(is_read=True)
    )
    await db.commit()
    return {"updated": result.rowcount or 0}

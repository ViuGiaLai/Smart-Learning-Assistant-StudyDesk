from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import delete, select, update

from app.api.deps import CurrentAdmin, CurrentUser, DbSession
from app.core.time import utcnow
from app.db.models import DeviceToken, Notification, User
from app.schemas.device import NotificationOut
from app.schemas.notification import (
    DeviceTokenIn,
    DeviceTokenRegistered,
    DeviceTokenRemove,
    DeviceTokenRemoved,
    PushDeliveryOut,
    PushRequest,
    PushResultOut,
    SendToUserRequest,
)
from app.services import fcm

router = APIRouter(prefix="/notifications", tags=["Notifications"])


def _push_out(result: fcm.PushResult) -> PushResultOut:
    return PushResultOut(
        enabled=result.enabled,
        attempted=result.attempted,
        sent=result.sent,
        failed=result.failed,
        detail=result.detail,
    )


async def _create_and_push(
    db, user_id: str, payload: PushRequest
) -> PushDeliveryOut:
    notification = Notification(
        user_id=user_id,
        type=payload.type,
        title=payload.title,
        content=payload.body,
    )
    db.add(notification)
    await db.commit()
    await db.refresh(notification)

    data = {"type": notification.type, "notification_id": notification.id}
    if payload.data:
        data.update(payload.data)
    result = await fcm.send_to_user(
        db, user_id, notification.title, notification.content, data
    )
    return PushDeliveryOut(
        notification=NotificationOut.model_validate(notification),
        push=_push_out(result),
    )


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
    result = await db.execute(query.order_by(Notification.created_at.desc()).limit(limit))
    return [NotificationOut.model_validate(row) for row in result.scalars().all()]


@router.post("/register-device", response_model=DeviceTokenRegistered)
async def register_device(
    payload: DeviceTokenIn, user: CurrentUser, db: DbSession
) -> DeviceTokenRegistered:
    token = payload.token.strip()
    existing = await db.scalar(select(DeviceToken).where(DeviceToken.token == token))
    if existing is None:
        db.add(
            DeviceToken(
                user_id=user.id,
                token=token,
                platform=payload.platform,
            )
        )
    else:
        # A shared/reset phone must always deliver to the current account only.
        existing.user_id = user.id
        existing.platform = payload.platform
        existing.last_seen_at = utcnow()
    await db.commit()
    return DeviceTokenRegistered(registered=True, platform=payload.platform)


@router.delete("/register-device", response_model=DeviceTokenRemoved)
async def unregister_device(
    payload: DeviceTokenRemove, user: CurrentUser, db: DbSession
) -> DeviceTokenRemoved:
    result = await db.execute(
        delete(DeviceToken).where(
            DeviceToken.token == payload.token.strip(),
            DeviceToken.user_id == user.id,
        )
    )
    await db.commit()
    return DeviceTokenRemoved(unregistered=bool(result.rowcount))


@router.post("/send", response_model=PushDeliveryOut)
async def send_to_self(
    payload: PushRequest, user: CurrentUser, db: DbSession
) -> PushDeliveryOut:
    """Create a notification and push it to the current user's devices."""
    return await _create_and_push(db, user.id, payload)


@router.post("/send-to-user", response_model=PushDeliveryOut)
async def send_to_user(
    payload: SendToUserRequest, _admin: CurrentAdmin, db: DbSession
) -> PushDeliveryOut:
    target = await db.get(User, payload.user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy người dùng")
    return await _create_and_push(db, target.id, payload)


@router.post("/read-all")
async def mark_all_read(user: CurrentUser, db: DbSession) -> dict[str, int]:
    result = await db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.is_read.is_(False))
        .values(is_read=True)
    )
    await db.commit()
    return {"updated": result.rowcount or 0}


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

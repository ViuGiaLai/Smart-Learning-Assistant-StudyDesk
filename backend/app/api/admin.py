from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select

from app.api.deps import CurrentAdmin, DbSession
from app.db.models import Device, SensorReading, StudySession, User
from app.schemas.auth import UserOut

router = APIRouter(prefix="/admin", tags=["Administration"])


class AdminOverview(BaseModel):
    users: int
    admins: int
    devices: int
    study_sessions: int
    sensor_readings: int
    recent_users: list[UserOut]


class RoleUpdate(BaseModel):
    role: Literal["student", "admin"]


async def _count(db, model) -> int:
    return int(await db.scalar(select(func.count()).select_from(model)) or 0)


@router.get("/overview", response_model=AdminOverview)
async def overview(_admin: CurrentAdmin, db: DbSession) -> AdminOverview:
    recent = (
        (
            await db.execute(
                select(User).order_by(User.created_at.desc()).limit(10)
            )
        )
        .scalars()
        .all()
    )
    return AdminOverview(
        users=await _count(db, User),
        admins=int(
            await db.scalar(
                select(func.count()).select_from(User).where(User.role == "admin")
            )
            or 0
        ),
        devices=await _count(db, Device),
        study_sessions=await _count(db, StudySession),
        sensor_readings=await _count(db, SensorReading),
        recent_users=[UserOut.model_validate(user) for user in recent],
    )


@router.patch("/users/{user_id}/role", response_model=UserOut)
async def update_role(
    user_id: str, payload: RoleUpdate, admin: CurrentAdmin, db: DbSession
) -> UserOut:
    target = await db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy người dùng")
    if target.id == admin.id and payload.role != "admin":
        raise HTTPException(
            status_code=400, detail="Không thể tự thu hồi quyền quản trị của chính mình"
        )
    target.role = payload.role
    await db.commit()
    await db.refresh(target)
    return UserOut.model_validate(target)

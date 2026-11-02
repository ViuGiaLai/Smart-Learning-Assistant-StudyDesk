from __future__ import annotations

from typing import Annotated

import jwt
from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import decode_token, verify_device_key
from app.db.base import get_db
from app.db.models import Device, User
from app.services.supabase_auth import (
    SupabaseAuthError,
    sync_user_from_claims,
    verify_access_token,
)

bearer_scheme = HTTPBearer(auto_error=False)


async def resolve_user_from_token(db: AsyncSession, token: str) -> User | None:
    """Resolve an access token issued locally or by Supabase Auth."""

    try:
        payload = decode_token(token, "access")
    except jwt.PyJWTError:
        payload = None

    if payload is not None:
        return await db.get(User, payload["sub"])

    if not settings.supabase_auth_enabled:
        return None

    try:
        claims = await verify_access_token(token)
    except SupabaseAuthError:
        return None
    return await sync_user_from_claims(db, claims)


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token không hợp lệ hoặc đã hết hạn",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None:
        raise unauthorized
    user = await resolve_user_from_token(db, credentials.credentials)
    if user is None:
        raise unauthorized
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
DbSession = Annotated[AsyncSession, Depends(get_db)]


async def get_current_admin(user: CurrentUser) -> User:
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Chỉ quản trị viên có quyền truy cập chức năng này",
        )
    return user


CurrentAdmin = Annotated[User, Depends(get_current_admin)]


async def get_owned_device(device_id: str, user: User, db: AsyncSession) -> Device:
    device = await db.get(Device, device_id)
    if device is None or device.user_id != user.id:
        raise HTTPException(status_code=404, detail="Không tìm thấy thiết bị")
    return device


async def get_device_by_credentials(
    db: Annotated[AsyncSession, Depends(get_db)],
    x_device_code: Annotated[str | None, Header(alias="X-Device-Code")] = None,
    x_device_key: Annotated[str | None, Header(alias="X-Device-Key")] = None,
) -> Device:
    if not x_device_code or not x_device_key:
        raise HTTPException(status_code=401, detail="Thiếu X-Device-Code hoặc X-Device-Key")
    device = await db.scalar(select(Device).where(Device.device_code == x_device_code))
    if device is None or not verify_device_key(x_device_key, device.device_key_hash):
        raise HTTPException(status_code=401, detail="Thông tin thiết bị không hợp lệ")
    return device

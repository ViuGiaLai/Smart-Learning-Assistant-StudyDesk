from __future__ import annotations

import logging
from datetime import datetime

import jwt
from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession
from app.core.config import settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.core.time import utcnow
from app.db.models import User
from app.schemas.auth import (
    AuthResponse,
    ForgotPasswordRequest,
    LoginRequest,
    MessageOut,
    RefreshRequest,
    RegisterRequest,
    ResendConfirmationRequest,
    ResetPasswordRequest,
    TokenPair,
    UserOut,
)
from app.services import supabase_auth
from app.services.supabase_auth import SupabaseAuthError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["Authentication"])


def _tokens(user_id: str) -> TokenPair:
    return TokenPair(
        access_token=create_access_token(user_id),
        refresh_token=create_refresh_token(user_id),
        expires_in=settings.access_token_minutes * 60,
    )


def _supabase_tokens(data: dict) -> TokenPair:
    access = data.get("access_token")
    refresh = data.get("refresh_token")
    if not access or not refresh:
        raise HTTPException(
            status_code=502, detail="Supabase Auth không trả về token hợp lệ"
        )
    return TokenPair(
        access_token=str(access),
        refresh_token=str(refresh),
        expires_in=int(data.get("expires_in") or 3600),
    )


def _pending_user(email: str, name: str, raw: dict) -> UserOut:
    created_at = raw.get("created_at") or utcnow()
    if isinstance(created_at, str):
        try:
            created_at = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        except ValueError:
            created_at = utcnow()
    return UserOut(
        id=str(raw.get("id") or email),
        email=email,
        name=(name or email.split("@")[0])[:120],
        role="student",
        created_at=created_at,
    )


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, db: DbSession) -> AuthResponse:
    email = payload.email.lower()
    name = payload.name.strip()

    if settings.supabase_auth_enabled:
        try:
            data = await supabase_auth.sign_up(
                email,
                payload.password,
                name,
                redirect_to=settings.email_confirmation_redirect_url,
            )
        except SupabaseAuthError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

        session_user = data.get("user") or data
        if data.get("access_token"):
            user = await supabase_auth.sync_user_from_payload(db, session_user)
            return AuthResponse(
                user=UserOut.model_validate(user),
                tokens=_supabase_tokens(data),
                requires_email_confirmation=False,
            )

        # Supabase has "Confirm email" enabled: the account exists, but no
        # session is issued until the user clicks the link in their inbox.
        return AuthResponse(
            user=_pending_user(email, name, session_user),
            tokens=None,
            requires_email_confirmation=True,
        )

    if await db.scalar(select(func.count(User.id)).where(User.email == email)):
        raise HTTPException(status_code=409, detail="Email đã được đăng ký")

    user = User(
        email=email,
        name=name,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return AuthResponse(user=UserOut.model_validate(user), tokens=_tokens(user.id))


@router.post("/login", response_model=AuthResponse)
async def login(payload: LoginRequest, db: DbSession) -> AuthResponse:
    email = payload.email.lower()

    if settings.supabase_auth_enabled:
        try:
            data = await supabase_auth.sign_in(email, payload.password)
        except SupabaseAuthError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        user = await supabase_auth.sync_user_from_payload(db, data.get("user") or {})
        return AuthResponse(
            user=UserOut.model_validate(user),
            tokens=_supabase_tokens(data),
            requires_email_confirmation=False,
        )

    user = await db.scalar(select(User).where(User.email == email))
    if (
        user is None
        or user.password_hash is None
        or not verify_password(payload.password, user.password_hash)
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Email hoặc mật khẩu không đúng"
        )
    return AuthResponse(user=UserOut.model_validate(user), tokens=_tokens(user.id))


@router.post("/refresh", response_model=TokenPair)
async def refresh(payload: RefreshRequest, db: DbSession) -> TokenPair:
    if settings.supabase_auth_enabled:
        try:
            data = await supabase_auth.refresh(payload.refresh_token)
        except SupabaseAuthError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        return _supabase_tokens(data)

    try:
        data = decode_token(payload.refresh_token, "refresh")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Refresh token không hợp lệ") from None
    user = await db.get(User, data["sub"])
    if user is None:
        raise HTTPException(status_code=401, detail="Tài khoản không tồn tại")
    return _tokens(user.id)


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)


# ---------------------------------------------------------------------------
# Password recovery / email confirmation
# ---------------------------------------------------------------------------
def _require_supabase_for_email() -> None:
    if not settings.supabase_auth_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Chức năng gửi email cần Supabase Auth. "
                "Đặt AUTH_PROVIDER=supabase và cấu hình SUPABASE_URL/KEY."
            ),
        )


@router.post(
    "/forgot-password",
    response_model=MessageOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def forgot_password(payload: ForgotPasswordRequest) -> MessageOut:
    _require_supabase_for_email()
    email = payload.email.lower()
    try:
        await supabase_auth.recover(email, settings.password_reset_redirect_url)
    except SupabaseAuthError as exc:
        # Rate limits and outages must be visible; unknown emails must not be.
        if exc.status_code in {429, 502}:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        logger.warning("forgot-password ignored failure for %s: %s", email, exc.detail)
    return MessageOut(
        detail=(
            "Nếu email đã đăng ký, Supabase đã gửi liên kết đặt lại mật khẩu. "
            "Hãy kiểm tra hộp thư (cả mục Spam)."
        )
    )


@router.post("/reset-password", response_model=MessageOut)
async def reset_password(payload: ResetPasswordRequest) -> MessageOut:
    _require_supabase_for_email()
    try:
        await supabase_auth.update_password(
            payload.access_token, payload.new_password
        )
    except SupabaseAuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return MessageOut(
        detail="Đã đặt lại mật khẩu. Hãy đăng nhập bằng mật khẩu mới."
    )


@router.post(
    "/resend-confirmation",
    response_model=MessageOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def resend_confirmation(payload: ResendConfirmationRequest) -> MessageOut:
    _require_supabase_for_email()
    email = payload.email.lower()
    try:
        await supabase_auth.resend_confirmation(email)
    except SupabaseAuthError as exc:
        if exc.status_code in {429, 502}:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        logger.warning("resend-confirmation ignored failure for %s: %s", email, exc.detail)
    return MessageOut(
        detail=(
            "Nếu tài khoản chưa xác nhận, Supabase đã gửi lại email xác nhận. "
            "Hãy kiểm tra hộp thư (cả mục Spam)."
        )
    )

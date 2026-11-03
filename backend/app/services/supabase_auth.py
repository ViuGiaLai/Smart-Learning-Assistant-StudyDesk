"""Supabase Auth (GoTrue) integration.

The mobile app signs in through this backend, so the publishable key never has
to ship with the app. Supabase issues the access/refresh tokens; this module
exchanges credentials with GoTrue and verifies access tokens for the API.
"""

from __future__ import annotations

import asyncio
import logging
from functools import lru_cache
from typing import Any
from urllib.parse import quote

import httpx
import jwt
from jwt import PyJWKClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import User

logger = logging.getLogger(__name__)


class SupabaseAuthError(Exception):
    """Credential or transport failure while talking to Supabase Auth."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _require_config() -> str:
    if not settings.supabase_auth_enabled:
        raise SupabaseAuthError(503, "Supabase Auth chưa được cấu hình")
    return settings.supabase_auth_base_url


def _headers() -> dict[str, str]:
    key = settings.supabase_publishable_key or ""
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def _raise_for_auth_failure(response: httpx.Response) -> None:
    if response.is_success:
        return

    try:
        data = response.json()
    except ValueError:
        data = {}

    code = str(data.get("error_code") or data.get("code") or "").lower()
    message = str(
        data.get("msg") or data.get("error_description") or data.get("error") or ""
    )
    text = message.lower()

    if code == "invalid_credentials" or "invalid login credentials" in text:
        detail = "Email hoặc mật khẩu không đúng"
        status = 401
    elif code == "email_address_invalid" or "email address" in text and "invalid" in text:
        detail = "Email không hợp lệ hoặc không được Supabase chấp nhận"
        status = 422
    elif code == "email_not_confirmed" or "email not confirmed" in text:
        detail = (
            "Email chưa được xác nhận. Hãy mở hộp thư, bấm liên kết xác nhận "
            "rồi đăng nhập lại."
        )
        status = 403
    elif code in {"user_already_exists", "email_exists"} or "already registered" in text:
        detail = "Email đã được đăng ký"
        status = 409
    elif code == "same_password" or "different from the old" in text:
        detail = "Mật khẩu mới phải khác mật khẩu hiện tại"
        status = 422
    elif code in {"weak_password"} or ("password" in text and "least" in text):
        detail = "Mật khẩu chưa đáp ứng yêu cầu bảo mật tối thiểu"
        status = 422
    elif code in {"bad_jwt", "invalid_token", "otp_expired", "invalid_claims"} or (
        "invalid jwt" in text or "token is malformed" in text or "token has expired" in text
    ):
        detail = (
            "Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn. "
            "Hãy yêu cầu gửi lại email."
        )
        status = 401
    elif response.status_code == 429 or code in {
        "over_email_send_rate_limit",
        "over_request_rate_limit",
    }:
        detail = "Quá nhiều yêu cầu xác thực. Vui lòng thử lại sau ít phút."
        status = 429
    else:
        logger.warning(
            "Supabase Auth error %s: %s", response.status_code, response.text[:300]
        )
        detail = "Supabase Auth tạm thời không phản hồi. Vui lòng thử lại."
        status = 502

    raise SupabaseAuthError(status, detail)


async def _request(
    method: str,
    path: str,
    payload: dict[str, Any],
    *,
    access_token: str | None = None,
) -> dict[str, Any]:
    base = _require_config()
    headers = _headers()
    if access_token:
        # User-scoped calls (reset password) must use the user JWT, not the
        # publishable key.
        headers["Authorization"] = f"Bearer {access_token}"
    try:
        async with httpx.AsyncClient(timeout=settings.supabase_timeout_seconds) as client:
            response = await client.request(
                method, f"{base}/auth/v1{path}", headers=headers, json=payload
            )
    except httpx.HTTPError as exc:
        raise SupabaseAuthError(
            502, "Không kết nối được Supabase Auth. Kiểm tra mạng rồi thử lại."
        ) from exc

    _raise_for_auth_failure(response)
    try:
        data = response.json()
    except ValueError as exc:
        raise SupabaseAuthError(502, "Supabase Auth trả về dữ liệu không hợp lệ") from exc
    if not isinstance(data, dict):
        raise SupabaseAuthError(502, "Supabase Auth trả về dữ liệu không hợp lệ")
    return data


async def _post(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    return await _request("POST", path, payload)



async def sign_up(
    email: str,
    password: str,
    name: str,
    redirect_to: str | None = None,
) -> dict[str, Any]:
    path = "/signup"
    if redirect_to:
        path = f"{path}?redirect_to={quote(redirect_to, safe='')}"
    return await _post(
        path,
        {"email": email, "password": password, "data": {"name": name}},
    )


async def sign_in(email: str, password: str) -> dict[str, Any]:
    return await _post(
        "/token?grant_type=password", {"email": email, "password": password}
    )


async def refresh(refresh_token: str) -> dict[str, Any]:
    return await _post(
        "/token?grant_type=refresh_token", {"refresh_token": refresh_token}
    )


async def recover(email: str, redirect_to: str | None = None) -> dict[str, Any]:
    """Send a password recovery email (GoTrue intentionally returns 200 for
    unknown addresses so the endpoint cannot be used to enumerate accounts)."""
    path = "/recover"
    if redirect_to:
        path = f"{path}?redirect_to={quote(redirect_to, safe='')}"
    return await _post(path, {"email": email})


async def resend_confirmation(email: str) -> dict[str, Any]:
    """Re-send the "confirm your email" message for an unconfirmed signup."""
    return await _post("/resend", {"type": "signup", "email": email})


async def update_password(access_token: str, new_password: str) -> dict[str, Any]:
    """Set a new password using the short-lived recovery access token."""
    return await _request(
        "PUT", "/user", {"password": new_password}, access_token=access_token
    )



# ---------------------------------------------------------------------------
# Access token verification
# ---------------------------------------------------------------------------
@lru_cache(maxsize=4)
def _jwks_client(url: str) -> PyJWKClient:
    # Supabase rotates signing keys; the client caches them for an hour.
    return PyJWKClient(url, cache_keys=True, lifespan=3600)


def _decode_access_token_sync(token: str) -> dict[str, Any]:
    base = _require_config()
    issuer = f"{base}/auth/v1"
    header = jwt.get_unverified_header(token)
    algorithm = str(header.get("alg") or "")

    if algorithm == "HS256":
        # Legacy Supabase projects sign access tokens with the JWT secret.
        if not settings.supabase_jwt_secret:
            raise jwt.InvalidTokenError("Missing Supabase JWT secret")
        key: Any = settings.supabase_jwt_secret
        algorithms = ["HS256"]
    elif algorithm in {"ES256", "RS256"}:
        client = _jwks_client(f"{base}/auth/v1/.well-known/jwks.json")
        key = client.get_signing_key_from_jwt(token).key
        algorithms = [algorithm]
    else:
        raise jwt.InvalidAlgorithmError("Unsupported Supabase signing algorithm")

    payload = jwt.decode(
        token,
        key,
        algorithms=algorithms,
        audience="authenticated",
        issuer=issuer,
        options={"require": ["exp", "sub"]},
    )
    if not payload.get("sub"):
        raise jwt.InvalidTokenError("Missing subject")
    return payload


async def verify_access_token(token: str) -> dict[str, Any]:
    if not settings.supabase_auth_enabled:
        raise SupabaseAuthError(401, "Supabase Auth chưa được cấu hình")
    try:
        return await asyncio.to_thread(_decode_access_token_sync, token)
    except jwt.PyJWTError as exc:
        raise SupabaseAuthError(
            401, "Token Supabase không hợp lệ hoặc đã hết hạn"
        ) from exc
    except httpx.HTTPError as exc:
        raise SupabaseAuthError(
            502, "Không tải được khóa xác thực Supabase"
        ) from exc


# ---------------------------------------------------------------------------
# Local profile sync
# ---------------------------------------------------------------------------
async def sync_supabase_user(
    db: AsyncSession,
    *,
    subject: str,
    email: str | None,
    name: str | None,
) -> User:
    """Return the local profile for a Supabase user, creating it on first use.

    Accounts created before the Supabase migration are linked by email so their
    plans, sessions and devices are preserved.
    """

    normalized_email = (email or "").strip().lower()
    user = await db.scalar(select(User).where(User.supabase_id == subject))
    if user is not None:
        return user

    if normalized_email:
        user = await db.scalar(select(User).where(User.email == normalized_email))
        if user is not None:
            if not user.supabase_id:
                user.supabase_id = subject
                await db.commit()
                await db.refresh(user)
            return user

    fallback_email = normalized_email or f"{subject}@users.noreply.supabase.co"
    fallback_name = (name or fallback_email.split("@")[0])[:120]
    user = User(
        id=subject,
        supabase_id=subject,
        email=fallback_email,
        name=fallback_name,
        password_hash=None,
        role="student",
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        # Two first requests can race; keep the row created by the winner.
        await db.rollback()
        user = await db.scalar(select(User).where(User.supabase_id == subject))
        if user is None:
            raise
        return user
    await db.refresh(user)
    return user


def _name_from_metadata(metadata: dict[str, Any] | None) -> str | None:
    if not metadata:
        return None
    name = metadata.get("name") or metadata.get("full_name")
    return str(name)[:120] if name else None


async def sync_user_from_payload(db: AsyncSession, payload: dict[str, Any]) -> User:
    """Sync from a GoTrue session/user payload."""
    subject = str(payload.get("id") or payload.get("sub") or "")
    if not subject:
        raise SupabaseAuthError(502, "Supabase Auth không trả về mã người dùng")
    return await sync_supabase_user(
        db,
        subject=subject,
        email=payload.get("email"),
        name=_name_from_metadata(payload.get("user_metadata")),
    )


async def sync_user_from_claims(db: AsyncSession, claims: dict[str, Any]) -> User:
    """Sync from verified access-token claims."""
    subject = str(claims.get("sub") or "")
    if not subject:
        raise SupabaseAuthError(401, "Token Supabase thiếu mã người dùng")
    return await sync_supabase_user(
        db,
        subject=subject,
        email=claims.get("email"),
        name=_name_from_metadata(claims.get("user_metadata")),
    )

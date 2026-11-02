"""Firebase Cloud Messaging (HTTP v1) without the heavy Admin SDK.

The service account stays on the server. We sign a short-lived OAuth assertion
with PyJWT, cache the access token, and POST each message to the FCM v1 API.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
import jwt
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import DeviceToken

logger = logging.getLogger(__name__)

FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
_TOKEN_REFRESH_MARGIN_SECONDS = 60


@dataclass(slots=True)
class PushResult:
    enabled: bool
    attempted: int = 0
    sent: int = 0
    failed: int = 0
    detail: str | None = None
    invalid_tokens: list[str] = field(default_factory=list)


_credentials: dict[str, Any] | None = None
_credentials_error: str | None = None
_access_token_value: str | None = None
_access_token_expiry: float = 0.0
_token_lock = asyncio.Lock()


def _load_credentials() -> dict[str, Any] | None:
    global _credentials, _credentials_error

    if _credentials is not None:
        return _credentials

    path_value = settings.firebase_credentials_file
    if not path_value:
        _credentials_error = "Chưa đặt FIREBASE_CREDENTIALS_FILE"
        return None

    path = Path(path_value)
    if not path.is_file():
        _credentials_error = f"Không tìm thấy file {path_value}"
        logger.warning("FCM credentials file not found: %s", path_value)
        return None

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        _credentials_error = "File service account không đọc được"
        logger.warning("Cannot read FCM credentials: %s", type(exc).__name__)
        return None

    if not data.get("client_email") or not data.get("private_key") or not data.get("project_id"):
        _credentials_error = "Service account thiếu client_email/private_key/project_id"
        logger.warning("FCM credentials are incomplete")
        return None

    _credentials = data
    _credentials_error = None
    return data


def reset_credentials_cache() -> None:
    """Used by tests after changing settings."""
    global _credentials, _credentials_error, _access_token_value, _access_token_expiry

    _credentials = None
    _credentials_error = None
    _access_token_value = None
    _access_token_expiry = 0.0


async def _get_access_token(credentials: dict[str, Any], *, force: bool = False) -> str:
    global _access_token_value, _access_token_expiry

    now = time.time()
    if (
        not force
        and _access_token_value
        and now < _access_token_expiry - _TOKEN_REFRESH_MARGIN_SECONDS
    ):
        return _access_token_value

    async with _token_lock:
        now = time.time()
        if (
            not force
            and _access_token_value
            and now < _access_token_expiry - _TOKEN_REFRESH_MARGIN_SECONDS
        ):
            return _access_token_value

        token_uri = str(credentials.get("token_uri") or "https://oauth2.googleapis.com/token")
        assertion = jwt.encode(
            {
                "iss": credentials["client_email"],
                "scope": FCM_SCOPE,
                "aud": token_uri,
                "iat": int(now),
                "exp": int(now + 3600),
            },
            credentials["private_key"],
            algorithm="RS256",
        )
        async with httpx.AsyncClient(timeout=settings.fcm_timeout_seconds) as client:
            response = await client.post(
                token_uri,
                data={
                    "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                    "assertion": assertion,
                },
            )
        if response.status_code != 200:
            raise RuntimeError(f"FCM OAuth HTTP {response.status_code}")

        payload = response.json()
        access_token = payload.get("access_token")
        if not access_token:
            raise RuntimeError("FCM OAuth response has no access_token")
        _access_token_value = str(access_token)
        _access_token_expiry = now + int(payload.get("expires_in") or 3600)
        return _access_token_value


async def _send_one(
    client: httpx.AsyncClient,
    *,
    token: str,
    access_token: str,
    project_id: str,
    title: str,
    body: str,
    data: dict[str, str],
) -> tuple[bool, bool, str | None]:
    payload = {
        "message": {
            "token": token,
            "notification": {"title": title, "body": body},
            "data": data,
            "android": {
                "priority": "high",
                "notification": {
                    "channel_id": "study-alerts",
                    "sound": "default",
                },
            },
        }
    }
    try:
        response = await client.post(
            f"https://fcm.googleapis.com/v1/projects/{project_id}/messages:send",
            headers={"Authorization": f"Bearer {access_token}"},
            json=payload,
        )
    except httpx.HTTPError as exc:
        logger.warning("FCM transport failed: %s", type(exc).__name__)
        return False, False, type(exc).__name__

    if response.status_code == 200:
        return True, False, None

    error_code = ""
    try:
        error = (response.json() or {}).get("error") or {}
        error_code = str(error.get("status") or "")
        for detail in error.get("details") or []:
            if isinstance(detail, dict) and detail.get("errorCode"):
                error_code = str(detail["errorCode"])
    except ValueError:
        pass

    invalid = response.status_code == 404 or error_code == "UNREGISTERED"
    logger.warning(
        "FCM send failed: status=%s code=%s", response.status_code, error_code or "unknown"
    )
    return False, invalid, error_code or f"HTTP {response.status_code}"


async def send_to_tokens(
    tokens: list[str],
    title: str,
    body: str,
    data: dict[str, Any] | None = None,
) -> PushResult:
    unique_tokens = list(dict.fromkeys(token for token in tokens if token))
    credentials = _load_credentials()
    if credentials is None:
        return PushResult(
            enabled=False,
            detail=_credentials_error or "FCM chưa được cấu hình",
        )

    if not unique_tokens:
        return PushResult(
            enabled=True,
            detail="Chưa có thiết bị nào đăng ký nhận thông báo",
        )

    project_id = settings.firebase_project_id or str(credentials.get("project_id") or "")
    if not project_id:
        return PushResult(enabled=False, detail="Thiếu Firebase project_id")

    try:
        access_token = await _get_access_token(credentials)
    except Exception as exc:  # noqa: BLE001 - never break the request on push
        logger.warning("FCM access token failed: %s", type(exc).__name__)
        return PushResult(
            enabled=True,
            attempted=len(unique_tokens),
            failed=len(unique_tokens),
            detail="Không lấy được quyền gửi FCM",
        )

    data_payload = {
        str(key): str(value)
        for key, value in (data or {}).items()
        if value is not None
    }
    sent = 0
    failed = 0
    invalid: list[str] = []

    async with httpx.AsyncClient(timeout=settings.fcm_timeout_seconds) as client:
        for token in unique_tokens:
            ok, is_invalid, error = await _send_one(
                client,
                token=token,
                access_token=access_token,
                project_id=project_id,
                title=title,
                body=body,
                data=data_payload,
            )
            if ok:
                sent += 1
            else:
                failed += 1
                if is_invalid:
                    invalid.append(token)
                logger.debug("FCM token failed: %s", error)

    return PushResult(
        enabled=True,
        attempted=len(unique_tokens),
        sent=sent,
        failed=failed,
        detail=None if failed == 0 else f"{failed}/{len(unique_tokens)} thiết bị gửi thất bại",
        invalid_tokens=invalid,
    )


async def send_to_user(
    db: AsyncSession,
    user_id: str,
    title: str,
    body: str,
    data: dict[str, Any] | None = None,
) -> PushResult:
    rows = list(
        (
            await db.execute(
                select(DeviceToken).where(DeviceToken.user_id == user_id)
            )
        )
        .scalars()
        .all()
    )
    if not rows:
        return PushResult(
            enabled=_load_credentials() is not None,
            detail="Chưa có thiết bị đăng ký nhận thông báo",
        )

    result = await send_to_tokens([row.token for row in rows], title, body, data)
    if result.invalid_tokens:
        await db.execute(
            delete(DeviceToken).where(DeviceToken.token.in_(result.invalid_tokens))
        )
        await db.commit()
    return result

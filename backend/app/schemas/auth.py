from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.schemas.common import UTCDateTime


class RegisterRequest(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class RefreshRequest(BaseModel):
    refresh_token: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    # Access token from the Supabase recovery deep link (one-time use).
    access_token: str = Field(min_length=20, max_length=4096)
    new_password: str = Field(min_length=8, max_length=128)


class ResendConfirmationRequest(BaseModel):
    email: EmailStr


class MessageOut(BaseModel):
    detail: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: EmailStr
    name: str
    role: Literal["student", "admin"] = "student"
    created_at: UTCDateTime


class AuthResponse(BaseModel):
    user: UserOut
    # Null when Supabase requires email confirmation before issuing a session.
    tokens: TokenPair | None = None
    requires_email_confirmation: bool = False

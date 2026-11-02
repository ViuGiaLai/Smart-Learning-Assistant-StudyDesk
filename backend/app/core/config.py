from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables / .env."""

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", case_sensitive=False
    )

    app_name: str = "Smart Learning Assistant API"
    environment: Literal["development", "test", "production"] = "development"
    api_prefix: str = "/api"

    # Database -------------------------------------------------------------
    # Production: postgresql+asyncpg://user:pass@host:5432/db
    # Local/test: sqlite+aiosqlite:///./smartstudy.db
    database_url: str = (
        "postgresql+asyncpg://smartstudy:smartstudy@localhost:5432/smartstudy"
    )

    # Auth -----------------------------------------------------------------
    # "local" keeps the original email/password + JWT flow (tests, offline dev).
    # "supabase" delegates credentials to Supabase Auth; this API verifies the
    # resulting access tokens and still returns its own UserOut profile.
    auth_provider: Literal["local", "supabase"] = "local"
    jwt_secret: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 60
    refresh_token_days: int = 14

    # Supabase -------------------------------------------------------------
    supabase_url: str | None = None
    supabase_publishable_key: str | None = None
    # Only needed for legacy projects that still sign access tokens with HS256.
    supabase_jwt_secret: str | None = None
    supabase_timeout_seconds: float = 20.0

    # CORS: comma separated list, "*" allows all (dev only)
    cors_origins: str = "*"

    # MQTT -----------------------------------------------------------------
    mqtt_enabled: bool = True
    mqtt_host: str = "localhost"
    mqtt_port: int = 1883
    mqtt_username: str | None = None
    mqtt_password: str | None = None
    mqtt_use_tls: bool = False
    mqtt_topic_prefix: str = "smartstudy"
    mqtt_client_id: str = "smartstudy-backend"

    # IoT ------------------------------------------------------------------
    device_offline_after_seconds: int = 90
    alert_cooldown_seconds: int = 600
    max_clock_skew_seconds: int = 86_400
    default_sample_interval_seconds: int = 10

    # AI -------------------------------------------------------------------
    # "auto" prefers Groq, then Gemini, then the rule-based fallback.
    ai_provider: Literal["auto", "groq", "gemini"] = "auto"
    groq_api_key: str | None = None
    groq_model: str = "openai/gpt-oss-120b"
    groq_base_url: str = "https://api.groq.com/openai/v1"
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.5-flash"
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta"
    ai_timeout_seconds: float = 20.0

    # Push notifications ---------------------------------------------------
    # Firebase service account (server only). Empty = push disabled.
    firebase_credentials_file: str | None = None
    firebase_project_id: str | None = None
    fcm_timeout_seconds: float = 15.0

    # Misc -----------------------------------------------------------------
    app_timezone: str = "Asia/Ho_Chi_Minh"
    seed_demo: bool = False
    log_level: str = Field(default="INFO")

    @property
    def supabase_auth_enabled(self) -> bool:
        return (
            self.auth_provider == "supabase"
            and bool(self.supabase_url)
            and bool(self.supabase_publishable_key)
        )

    @property
    def supabase_auth_base_url(self) -> str:
        return (self.supabase_url or "").rstrip("/")

    @property
    def active_ai_provider(self) -> str:
        if self.ai_provider == "groq":
            return "groq" if self.groq_api_key else "rule_based"
        if self.ai_provider == "gemini":
            return "gemini" if self.gemini_api_key else "rule_based"
        if self.groq_api_key:
            return "groq"
        if self.gemini_api_key:
            return "gemini"
        return "rule_based"

    @property
    def fcm_enabled(self) -> bool:
        return bool(self.firebase_credentials_file) and Path(
            self.firebase_credentials_file
        ).is_file()

    @property
    def cors_origin_list(self) -> list[str]:
        if self.cors_origins.strip() == "*":
            return ["*"]
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

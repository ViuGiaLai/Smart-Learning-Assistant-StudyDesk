from __future__ import annotations

from collections.abc import AsyncIterator
from urllib.parse import urlsplit

from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from app.core.config import settings

_is_sqlite = settings.database_url.startswith("sqlite")
_engine_kwargs: dict = {"echo": False}
if _is_sqlite:
    # SQLite + TestClient/uvicorn can hop event loops; no pooled connections.
    _engine_kwargs["poolclass"] = NullPool
else:
    _engine_kwargs["pool_pre_ping"] = True
    _url = urlsplit(settings.database_url)
    _host = (_url.hostname or "").lower()
    if _host.endswith(".supabase.co") or _host.endswith(".supabase.com"):
        # Supabase requires TLS. Transaction pooler (6543) also needs prepared
        # statements disabled; session pooler (5432) works with the defaults.
        _connect_args: dict = {"ssl": "require"}
        if _url.port == 6543:
            _connect_args["statement_cache_size"] = 0
        _engine_kwargs["connect_args"] = _connect_args

engine = create_async_engine(settings.database_url, **_engine_kwargs)

SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


async def init_db() -> None:
    """Create tables for the MVP.

    In production this should be replaced by Alembic migrations
    (see docs/03-api.md#database-migrations).
    """
    from app.db import models  # noqa: F401  (register metadata)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_ensure_compat_columns)


def _ensure_compat_columns(sync_conn) -> None:
    """Add columns introduced after the first MVP deployment.

    The project has no Alembic yet; this keeps existing SQLite/Postgres
    databases usable without a destructive reset.
    """
    inspector = inspect(sync_conn)
    if "users" not in inspector.get_table_names():
        return
    user_columns = {column["name"]: column for column in inspector.get_columns("users")}
    columns = set(user_columns)
    if "role" not in columns:
        sync_conn.execute(
            text("ALTER TABLE users ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'student'")
        )
    if "supabase_id" not in columns:
        sync_conn.execute(text("ALTER TABLE users ADD COLUMN supabase_id VARCHAR(36)"))
        sync_conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_supabase_id "
                "ON users (supabase_id)"
            )
        )
    password_column = user_columns.get("password_hash")
    if (
        password_column is not None
        and not password_column.get("nullable", True)
        and sync_conn.dialect.name == "postgresql"
    ):
        # Supabase accounts have no local password hash.
        sync_conn.execute(
            text("ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL")
        )

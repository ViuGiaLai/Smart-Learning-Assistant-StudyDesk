from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import admin, assistant, auth, devices, iot, notifications, study, ws
from app.core.config import settings
from app.db.base import SessionLocal, engine, init_db
from app.services import iot as iot_service
from app.services import reminders
from app.services.mqtt import mqtt_service

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


async def _offline_watchdog() -> None:
    """Mark devices offline when their last heartbeat is too old."""
    while True:
        # Sleep first: the first sweep is never urgent and this keeps shutdown clean.
        await asyncio.sleep(20)
        try:
            async with SessionLocal() as db:
                await iot_service.mark_stale_devices_offline(db)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("Offline watchdog failed")


async def _study_reminder_watchdog() -> None:
    """Push reminders for plans that start within the next few minutes."""
    while True:
        await asyncio.sleep(60)
        try:
            async with SessionLocal() as db:
                await reminders.send_due_study_reminders(db)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("Study reminder watchdog failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await mqtt_service.start()
    watchdog = asyncio.create_task(_offline_watchdog(), name="offline-watchdog")
    reminder_task = asyncio.create_task(
        _study_reminder_watchdog(), name="study-reminder-watchdog"
    )
    if settings.jwt_secret == "dev-secret-change-me":
        logger.warning(
            "JWT_SECRET is still the development default. Set a random value "
            "before exposing this API on the internet."
        )
    logger.info(
        "API ready (env=%s, auth=%s, mqtt=%s, fcm=%s)",
        settings.environment,
        settings.auth_provider,
        settings.mqtt_enabled,
        settings.fcm_enabled,
    )
    try:
        yield
    finally:
        watchdog.cancel()
        reminder_task.cancel()
        with suppress(asyncio.CancelledError):
            await watchdog
        with suppress(asyncio.CancelledError):
            await reminder_task
        await mqtt_service.stop()
        with suppress(Exception):
            await engine.dispose()


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description=(
        "Backend cho Smart Learning Assistant: quản lý học tập, nhận dữ liệu ESP32 "
        "qua MQTT/HTTP, cảnh báo môi trường và trợ lý AI."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix=settings.api_prefix)
app.include_router(admin.router, prefix=settings.api_prefix)
app.include_router(devices.router, prefix=settings.api_prefix)
app.include_router(iot.router, prefix=settings.api_prefix)
app.include_router(study.router, prefix=settings.api_prefix)
app.include_router(study.plans_router, prefix=settings.api_prefix)
app.include_router(notifications.router, prefix=settings.api_prefix)
app.include_router(assistant.router, prefix=settings.api_prefix)
app.include_router(ws.router)


@app.get("/health", tags=["System"])
async def health() -> dict:
    return {
        "status": "ok",
        "environment": settings.environment,
        "mqtt_connected": mqtt_service.connected,
        "auth_provider": settings.auth_provider,
        "ai_enabled": settings.active_ai_provider != "rule_based",
        "ai_provider": settings.active_ai_provider,
        "push_enabled": settings.fcm_enabled,
        "timezone": settings.app_timezone,
    }

from __future__ import annotations

import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.api.deps import resolve_user_from_token
from app.db.base import SessionLocal
from app.db.models import Device, SensorReading
from app.schemas.device import SensorReadingOut
from app.services.realtime import manager

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Realtime"])


@router.websocket("/ws/devices/{device_id}")
async def device_websocket(websocket: WebSocket, device_id: str, token: str | None = None) -> None:
    """Realtime telemetry stream.

    Auth is performed before `accept()` so an unauthorised client never gets a
    connection. The mobile app passes the access token as `?token=<jwt>`.
    """
    if not token:
        await websocket.close(code=4401)
        return

    async with SessionLocal() as db:
        user = await resolve_user_from_token(db, token)
        if user is None:
            await websocket.close(code=4401)
            return
        device = await db.get(Device, device_id)
        if device is None or device.user_id != user.id:
            await websocket.close(code=4403)
            return

        reading = await db.scalar(
            select(SensorReading)
            .where(SensorReading.device_id == device.id)
            .order_by(SensorReading.recorded_at.desc())
            .limit(1)
        )
        snapshot = {
            "event": "snapshot",
            "device_id": device.id,
            "data": {
                "status": device.status,
                "last_seen_at": device.last_seen_at.isoformat() + "Z"
                if device.last_seen_at
                else None,
                "latest_reading": SensorReadingOut.model_validate(reading).model_dump(mode="json")
                if reading
                else None,
            },
        }

    await manager.connect(device_id, websocket)
    await websocket.send_json(snapshot)
    try:
        while True:
            message = await websocket.receive_text()
            if message.strip().lower() == "ping":
                await websocket.send_json({"event": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001 - client vanished
        logger.debug("WS error for device %s", device_id, exc_info=True)
    finally:
        await manager.disconnect(device_id, websocket)

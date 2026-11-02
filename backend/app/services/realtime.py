from __future__ import annotations

import asyncio
import logging
from collections import defaultdict

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Tracks WebSocket subscribers per device.

    The MQTT listener runs in the same event loop, so broadcasting is a plain
    await. Every payload is a JSON-serializable dict.
    """

    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect(self, device_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections[device_id].add(websocket)
        logger.info("WS connected device=%s total=%s", device_id, len(self._connections[device_id]))

    async def disconnect(self, device_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections[device_id].discard(websocket)
            if not self._connections[device_id]:
                self._connections.pop(device_id, None)

    async def broadcast(self, device_id: str, payload: dict) -> None:
        async with self._lock:
            subscribers = list(self._connections.get(device_id, ()))
        stale: list[WebSocket] = []
        for websocket in subscribers:
            try:
                await websocket.send_json(payload)
            except Exception:  # noqa: BLE001 - a dead socket must not break ingestion
                stale.append(websocket)
        for websocket in stale:
            await self.disconnect(device_id, websocket)


manager = ConnectionManager()

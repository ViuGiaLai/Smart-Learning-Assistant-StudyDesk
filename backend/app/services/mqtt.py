from __future__ import annotations

import asyncio
import json
import logging
import ssl
import threading
from datetime import UTC, datetime
from typing import Any

import paho.mqtt.client as mqtt
from sqlalchemy import select

from app.core.config import settings
from app.core.time import utcnow
from app.db.base import SessionLocal
from app.db.models import Device
from app.schemas.device import TelemetryIn
from app.services import iot

logger = logging.getLogger(__name__)


class MqttService:
    """MQTT bridge that is safe on Windows as well as Linux.

    The backend used to depend on ``aiomqtt``, which calls
    ``loop.add_reader()``. The default Windows event loop (Proactor) does not
    implement that method, so MQTT never connected when running uvicorn
    directly on Windows. Paho's own network thread works on every platform;
    incoming messages are handed to the asyncio loop through a queue so that
    database work still happens in the application loop, in order.
    """

    def __init__(self) -> None:
        self._client: mqtt.Client | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._queue: asyncio.Queue[tuple[str, bytes]] | None = None
        self._consumer: asyncio.Task | None = None
        self._connected = threading.Event()
        self._stopping = False

    @property
    def connected(self) -> bool:
        return self._connected.is_set()

    # -- lifecycle ---------------------------------------------------------
    async def start(self) -> None:
        if not settings.mqtt_enabled:
            logger.info("MQTT disabled by configuration")
            return
        if self._client is not None:
            return

        self._stopping = False
        self._loop = asyncio.get_running_loop()
        self._queue = asyncio.Queue(maxsize=500)
        self._consumer = asyncio.create_task(self._consume(), name="mqtt-consumer")

        client = mqtt.Client(
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
            client_id=f"{settings.mqtt_client_id}-{utcnow().timestamp():.0f}",
            protocol=mqtt.MQTTv311,
        )
        if settings.mqtt_username:
            client.username_pw_set(settings.mqtt_username, settings.mqtt_password)
        if settings.mqtt_use_tls:
            client.tls_set_context(ssl.create_default_context())
        client.will_set(
            topic=f"{settings.mqtt_topic_prefix}/backend/status",
            payload=json.dumps({"status": "offline"}),
            qos=1,
            retain=True,
        )
        client.on_connect = self._on_connect
        client.on_disconnect = self._on_disconnect
        client.on_connect_fail = self._on_connect_fail
        client.on_message = self._on_message
        client.reconnect_delay_set(min_delay=1, max_delay=30)
        client.max_queued_messages_set(200)

        try:
            # connect_async + loop_start gives automatic reconnect in a
            # daemon thread, so the API can start even when the broker is down.
            client.connect_async(settings.mqtt_host, settings.mqtt_port, keepalive=30)
            client.loop_start()
        except Exception as exc:  # noqa: BLE001 - broker may be unreachable
            logger.warning("MQTT start failed: %s", exc)
            client = None
        self._client = client

    async def stop(self) -> None:
        self._stopping = True
        if self._consumer is not None:
            self._consumer.cancel()
            try:
                await self._consumer
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
            self._consumer = None
        client = self._client
        self._client = None
        if client is not None:
            try:
                client.disconnect()
            except Exception:  # noqa: BLE001
                pass
            try:
                client.loop_stop()
            except Exception:  # noqa: BLE001
                pass
        self._connected.clear()
        self._queue = None

    # -- paho callbacks (network thread) -----------------------------------
    def _on_connect(
        self,
        client: mqtt.Client,
        userdata: Any,
        flags: mqtt.ConnectFlags,
        reason_code: mqtt.ReasonCode,
        properties: mqtt.Properties | None = None,
    ) -> None:
        if reason_code == 0:
            self._connected.set()
            client.subscribe(
                f"{settings.mqtt_topic_prefix}/+/telemetry",
                qos=1,
            )
            client.subscribe(
                f"{settings.mqtt_topic_prefix}/+/status",
                qos=1,
            )
            client.publish(
                f"{settings.mqtt_topic_prefix}/backend/status",
                json.dumps({"status": "online"}),
                qos=1,
                retain=True,
            )
            logger.info(
                "MQTT connected to %s:%s", settings.mqtt_host, settings.mqtt_port
            )
        else:
            self._connected.clear()
            logger.warning("MQTT connection refused: %s", reason_code)

    def _on_disconnect(
        self,
        client: mqtt.Client,
        userdata: Any,
        flags: mqtt.DisconnectFlags,
        reason_code: mqtt.ReasonCode,
        properties: mqtt.Properties | None = None,
    ) -> None:
        self._connected.clear()
        if not self._stopping:
            logger.warning("MQTT disconnected (%s); paho will retry", reason_code)

    def _on_connect_fail(self, client: mqtt.Client, userdata: Any) -> None:
        self._connected.clear()
        if not self._stopping:
            logger.warning("MQTT connect failed; retrying in background")

    def _on_message(
        self, client: mqtt.Client, userdata: Any, message: mqtt.MQTTMessage
    ) -> None:
        loop = self._loop
        if loop is None or loop.is_closed() or self._queue is None:
            return
        topic = str(message.topic)
        payload = bytes(message.payload)

        def enqueue() -> None:
            queue = self._queue
            if queue is None:
                return
            if queue.full():
                # Keep the newest data; drop the oldest queued packet.
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            queue.put_nowait((topic, payload))

        try:
            loop.call_soon_threadsafe(enqueue)
        except RuntimeError:
            # Loop is shutting down.
            pass

    async def _consume(self) -> None:
        queue = self._queue
        if queue is None:
            return
        while True:
            topic, raw = await queue.get()
            try:
                await self._handle_message(topic, raw)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 - one bad message must not stop MQTT
                logger.exception("Failed to handle MQTT message on %s", topic)

    # -- inbound -----------------------------------------------------------
    async def _handle_message(self, topic: str, raw: bytes) -> None:
        # Topics are "<prefix>/<device_code>/<kind>" (3 segments). Strip the
        # prefix first instead of splitting the whole topic, so a prefix that
        # itself contains "/" keeps working.
        prefix = settings.mqtt_topic_prefix.strip("/")
        head = f"{prefix}/"
        if not topic.startswith(head):
            return
        parts = topic[len(head):].split("/")
        if len(parts) != 2 or not all(parts):
            logger.debug("Ignoring unsupported topic %s", topic)
            return
        device_code, kind = parts
        if device_code == "backend":
            # Our own retained status (e.g. "<prefix>/backend/status").
            return

        try:
            payload: dict[str, Any] = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            logger.warning("Invalid JSON on %s", topic)
            return

        async with SessionLocal() as db:
            device = await db.scalar(
                select(Device).where(Device.device_code == device_code)
            )
            if device is None:
                logger.warning("Telemetry from unknown device %s", device_code)
                return

            if kind == "telemetry":
                telemetry = TelemetryIn.model_validate(payload)
                await iot.ingest_telemetry(db, device, telemetry, source="mqtt")
            elif kind == "status":
                status = str(payload.get("status", "offline"))
                device.status = "online" if status == "online" else "offline"
                device.last_seen_at = utcnow()
                await db.commit()
                await iot.broadcast_status(device)

    # -- outbound ----------------------------------------------------------
    async def send_command(self, device_code: str, command: dict[str, Any]) -> bool:
        client = self._client
        if not settings.mqtt_enabled or client is None or not self.connected:
            return False
        topic = f"{settings.mqtt_topic_prefix}/{device_code}/command"
        payload = {
            **command,
            "issued_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        }
        try:
            info = client.publish(topic, payload=json.dumps(payload), qos=1)
            return info.rc == mqtt.MQTT_ERR_SUCCESS
        except Exception:  # noqa: BLE001
            logger.exception("Failed to publish command to %s", topic)
            return False

    async def publish_status(self, device_code: str, status: str) -> None:
        client = self._client
        if client is None or not self.connected:
            return
        try:
            client.publish(
                f"{settings.mqtt_topic_prefix}/{device_code}/status",
                payload=json.dumps({"status": status, "source": "backend"}),
                qos=1,
                retain=True,
            )
        except Exception:  # noqa: BLE001
            logger.exception("Failed to publish status for %s", device_code)


mqtt_service = MqttService()

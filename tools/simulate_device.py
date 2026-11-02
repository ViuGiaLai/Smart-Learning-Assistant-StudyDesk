#!/usr/bin/env python
"""Publish fake study-desk telemetry so the app can be demoed without hardware.

MQTT (default):
    python tools/simulate_device.py --device-code STUDY_DESK_001 \
        --host localhost --scenario normal

HTTP fallback (needs the device key shown when registering the device):
    python tools/simulate_device.py --http http://localhost:8000 \
        --device-code STUDY_DESK_001 --device-key sk_...
"""
from __future__ import annotations

import argparse
import json
import random
import time
from datetime import datetime, timezone

import httpx
import paho.mqtt.client as mqtt

SCENARIOS = {
    "normal": {"temperature": (24.0, 28.0), "humidity": (45.0, 62.0), "light": (2100, 3600)},
    "low_light": {"temperature": (25.0, 29.0), "humidity": (50.0, 68.0), "light": (30, 120)},
    "hot": {"temperature": (31.0, 35.0), "humidity": (65.0, 82.0), "light": (2100, 3400)},
}


def telemetry(device_code: str, scenario: str, message_id: str) -> dict:
    config = SCENARIOS[scenario]
    temperature = round(random.uniform(*config["temperature"]), 1)
    humidity = round(random.uniform(*config["humidity"]), 1)
    light = random.randint(*config["light"])
    return {
        "device_id": device_code,
        "message_id": message_id,
        "temperature": temperature,
        "humidity": humidity,
        "light": light,
        "motion_detected": random.random() > 0.2,
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


def run_http(args: argparse.Namespace) -> None:
    headers = {"X-Device-Code": args.device_code, "X-Device-Key": args.device_key}
    with httpx.Client(timeout=10) as client:
        counter = 0
        while True:
            counter += 1
            payload = telemetry(args.device_code, args.scenario, f"sim-{int(time.time())}-{counter}")
            response = client.post(f"{args.http}/api/iot/telemetry", json=payload, headers=headers)
            print(response.status_code, response.text)
            if args.once:
                return
            time.sleep(args.interval)


def run_mqtt(args: argparse.Namespace) -> None:
    topic = f"{args.prefix}/{args.device_code}/telemetry"
    command_topic = f"{args.prefix}/{args.device_code}/command"

    def on_connect(client, userdata, flags, reason_code, properties=None):
        print(f"MQTT connected (rc={reason_code})")
        client.subscribe(command_topic)

    def on_message(client, userdata, message):
        print(f"Command received: {message.payload.decode(errors='replace')}")

    client = mqtt.Client(
        mqtt.CallbackAPIVersion.VERSION2,
        client_id=f"sim-{args.device_code}",
    )
    if args.username:
        client.username_pw_set(args.username, args.password)
    client.on_connect = on_connect
    client.on_message = on_message
    client.will_set(
        f"{args.prefix}/{args.device_code}/status",
        json.dumps({"status": "offline"}),
        retain=True,
    )
    client.connect(args.host, args.port, keepalive=30)
    client.loop_start()
    status_info = client.publish(
        f"{args.prefix}/{args.device_code}/status",
        json.dumps({"status": "online"}),
        qos=1,
        retain=True,
    )
    status_info.wait_for_publish(timeout=5)

    counter = 0
    try:
        while True:
            counter += 1
            payload = telemetry(args.device_code, args.scenario, f"sim-{int(time.time())}-{counter}")
            info = client.publish(topic, json.dumps(payload), qos=1)
            try:
                info.wait_for_publish(timeout=5)
            except (RuntimeError, ValueError) as exc:
                # Public brokers drop long-lived connections now and then.
                # paho reconnects in its network thread, so just skip this
                # sample instead of crashing the whole demo.
                print(f"publish failed ({exc}); waiting for reconnect", flush=True)
                time.sleep(2)
                continue
            print(f"-> {topic} {json.dumps(payload, ensure_ascii=False)}")
            if args.once:
                # Let the broker deliver the reading before we close the socket,
                # and keep the retained status "online" so a one-shot demo does
                # not immediately mark the device offline.
                time.sleep(1.5)
                return
            time.sleep(args.interval)
    finally:
        if not args.once:
            try:
                client.publish(
                    f"{args.prefix}/{args.device_code}/status",
                    json.dumps({"status": "offline"}),
                    qos=1,
                    retain=True,
                ).wait_for_publish(timeout=5)
            except (RuntimeError, ValueError):
                pass
        try:
            client.loop_stop()
            client.disconnect()
        except Exception:  # noqa: BLE001 - best-effort cleanup
            pass


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device-code", default="STUDY_DESK_001")
    parser.add_argument("--scenario", choices=sorted(SCENARIOS), default="normal")
    parser.add_argument("--interval", type=float, default=10, help="Seconds between readings")
    parser.add_argument("--once", action="store_true", help="Publish one reading and exit")
    parser.add_argument("--host", default="localhost")
    parser.add_argument("--port", type=int, default=1883)
    parser.add_argument("--prefix", default="smartstudy")
    parser.add_argument("--username", default=None)
    parser.add_argument("--password", default=None)
    parser.add_argument("--http", default=None, help="Base URL to use HTTP ingestion instead")
    parser.add_argument("--device-key", default="")
    args = parser.parse_args()

    if args.http:
        if not args.device_key:
            parser.error("--http mode requires --device-key")
        run_http(args)
    else:
        run_mqtt(args)


if __name__ == "__main__":
    main()

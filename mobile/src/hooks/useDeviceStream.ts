import { useEffect, useRef, useState } from "react";

import { WS_URL } from "../api/config";
import { session } from "../api/session";
import type { Alert, SensorReading, StreamEvent } from "../api/types";
import { useDeviceStore } from "../store/deviceStore";

interface StreamState {
  latest: SensorReading | null;
  alerts: Alert[];
  connected: boolean;
  status: "online" | "offline" | null;
  clearAlerts: () => void;
}

/**
 * Live telemetry over WebSocket with exponential-backoff reconnect.
 * Falls back silently: the screen keeps polling REST when `connected` is false.
 */
export function useDeviceStream(deviceId: string | null): StreamState {
  const [latest, setLatest] = useState<SensorReading | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<"online" | "offline" | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!deviceId) return;
    let stopped = false;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const token = session.getAccess();
      if (!token || stopped) return;
      const socket = new WebSocket(
        `${WS_URL}/ws/devices/${deviceId}?token=${encodeURIComponent(token)}`,
      );
      socketRef.current = socket;

      socket.onopen = () => {
        if (stopped) return;
        attempt = 0;
        setConnected(true);
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as StreamEvent;
          if (payload.event === "snapshot") {
            setStatus(payload.data.status);
            if (payload.data.latest_reading) {
              setLatest(payload.data.latest_reading);
              if (typeof payload.data.latest_reading.fan_on === "boolean") {
                useDeviceStore.getState().setFanState(deviceId, payload.data.latest_reading.fan_on);
              }
              if (typeof payload.data.latest_reading.led_on === "boolean") {
                useDeviceStore.getState().setLedState(deviceId, payload.data.latest_reading.led_on);
              }
            }
          } else if (payload.event === "telemetry") {
            setStatus("online");
            setLatest(payload.data);
            if (typeof payload.data.fan_on === "boolean") {
              useDeviceStore.getState().setFanState(deviceId, payload.data.fan_on);
            }
            if (typeof payload.data.led_on === "boolean") {
              useDeviceStore.getState().setLedState(deviceId, payload.data.led_on);
            }
          } else if (payload.event === "alert") {
            setAlerts((current) => [payload.data, ...current].slice(0, 5));
          } else if (payload.event === "device_status") {
            const next = payload.data.status;
            if (next === "online" || next === "offline") setStatus(next);
          }
        } catch {
          // Ignore malformed frames.
        }
      };

      socket.onerror = () => {
        // `onclose` handles reconnection.
      };

      socket.onclose = () => {
        setConnected(false);
        if (stopped) return;
        attempt += 1;
        const delay = Math.min(30000, 1500 * 2 ** Math.min(attempt, 4));
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();
    const ping = setInterval(() => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send("ping");
      }
    }, 25000);

    return () => {
      stopped = true;
      clearInterval(ping);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socketRef.current?.close();
      socketRef.current = null;
      setConnected(false);
    };
  }, [deviceId]);

  return {
    latest,
    alerts,
    connected,
    status,
    clearAlerts: () => setAlerts([]),
  };
}

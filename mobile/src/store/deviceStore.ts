import { create } from "zustand";

import { ApiError, api } from "../api/client";
import type { Device, RegisteredDevice } from "../api/types";

interface DeviceState {
  devices: Device[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  fanStates: Record<string, boolean>;
  ledStates: Record<string, boolean>;
  setFanState: (deviceId: string, on: boolean) => void;
  setLedState: (deviceId: string, on: boolean) => void;
  refresh: () => Promise<void>;
  select: (deviceId: string) => void;
  register: (deviceCode: string, name: string) => Promise<RegisteredDevice>;
  reset: () => void;
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Không tải được thiết bị";
}

export const useDeviceStore = create<DeviceState>((set, get) => ({
  devices: [],
  selectedId: null,
  loading: false,
  error: null,
  fanStates: {},
  ledStates: {},

  setFanState(deviceId, on) {
    set((state) => ({ fanStates: { ...state.fanStates, [deviceId]: on } }));
  },

  setLedState(deviceId, on) {
    set((state) => ({ ledStates: { ...state.ledStates, [deviceId]: on } }));
  },

  async refresh() {
    set({ loading: true, error: null });
    try {
      const devices = await api.listDevices();
      const current = get().selectedId;
      const stillExists = devices.some((device) => device.id === current);
      set({
        devices,
        selectedId: stillExists ? current : (devices[0]?.id ?? null),
        loading: false,
      });
    } catch (error) {
      set({ loading: false, error: messageOf(error) });
    }
  },

  select(deviceId) {
    set({ selectedId: deviceId });
  },

  async register(deviceCode, name) {
    const device = await api.registerDevice(deviceCode.trim().toUpperCase(), name.trim());
    set((state) => ({ devices: [...state.devices, device], selectedId: device.id }));
    return device;
  },

  reset() {
    set({ devices: [], selectedId: null, error: null, loading: false });
  },
}));

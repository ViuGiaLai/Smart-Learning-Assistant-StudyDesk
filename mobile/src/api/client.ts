import { API_URL, REQUEST_TIMEOUT_MS } from "./config";
import { session } from "./session";
import type {
  AssistantContext,
  AssistantHistoryItem,
  AuthResponse,
  ChatResponse,
  CommandResponse,
  Device,
  DeviceSettings,
  DeviceStatus,
  DeviceTokenRegistration,
  NotificationItem,
  PushDelivery,
  ReadingPage,
  RegisteredDevice,
  SensorReading,
  StudyPlan,
  StudySession,
  StudyStats,
  TelemetryAccepted,
  TokenPair,
  User,
} from "./types";

export interface MessageResponse {
  detail: string;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  auth?: boolean;
  retry?: boolean;
}

function errorMessage(data: unknown, fallback: string): string {
  if (typeof data === "string" && data) return data;
  if (data && typeof data === "object") {
    const detail = (data as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((item) =>
          item && typeof item === "object" && "msg" in item
            ? String((item as { msg: unknown }).msg)
            : String(item),
        )
        .join("; ");
    }
  }
  return fallback;
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = session.getRefresh();
  if (!refreshToken) return false;
  try {
    const response = await fetch(`${API_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!response.ok) return false;
    const tokens = (await response.json()) as TokenPair;
    session.setTokens(tokens);
    return true;
  } catch {
    return false;
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true, retry = true } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = session.getAccess();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new ApiError(
      0,
      aborted
        ? "Máy chủ không phản hồi. Kiểm tra kết nối mạng."
        : `Không kết nối được máy chủ tại ${API_URL}. Kiểm tra backend đã chạy chưa.`,
    );
  }
  clearTimeout(timeout);

  if (response.status === 401 && auth && retry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return request<T>(path, { ...options, retry: false });
    session.expire();
  }

  const data = await parseBody(response);
  if (!response.ok) {
    let message = errorMessage(data, `Lỗi ${response.status}`);
    if (response.status === 404 && /^not found$/i.test(message.trim())) {
      message =
        "Máy chủ chưa hỗ trợ chức năng này. Có thể backend chưa được cập nhật "
        + "hoặc ứng dụng đang trỏ tới sai địa chỉ API.";
    }
    throw new ApiError(response.status, message);
  }
  return data as T;
}

const json = (body: unknown) => body;

export const api = {
  // Auth ------------------------------------------------------------------
  register(email: string, name: string, password: string): Promise<AuthResponse> {
    return request("/api/auth/register", {
      method: "POST",
      body: json({ email, name, password }),
      auth: false,
    });
  },
  login(email: string, password: string): Promise<AuthResponse> {
    return request("/api/auth/login", {
      method: "POST",
      body: json({ email, password }),
      auth: false,
    });
  },
  me(): Promise<User> {
    return request("/api/auth/me");
  },
  forgotPassword(email: string): Promise<MessageResponse> {
    return request("/api/auth/forgot-password", {
      method: "POST",
      body: json({ email }),
      auth: false,
    });
  },
  resetPassword(accessToken: string, newPassword: string): Promise<MessageResponse> {
    return request("/api/auth/reset-password", {
      method: "POST",
      body: json({ access_token: accessToken, new_password: newPassword }),
      auth: false,
    });
  },
  resendConfirmation(email: string): Promise<MessageResponse> {
    return request("/api/auth/resend-confirmation", {
      method: "POST",
      body: json({ email }),
      auth: false,
    });
  },

  // Devices ---------------------------------------------------------------
  listDevices(): Promise<Device[]> {
    return request("/api/devices");
  },
  registerDevice(deviceCode: string, name: string): Promise<RegisteredDevice> {
    return request("/api/devices/register", {
      method: "POST",
      body: json({ device_code: deviceCode, name }),
    });
  },
  deviceStatus(deviceId: string): Promise<DeviceStatus> {
    return request(`/api/devices/${deviceId}/status`);
  },
  updateDevice(
    deviceId: string,
    payload: { name?: string; settings?: Partial<DeviceSettings> },
  ): Promise<Device> {
    return request(`/api/devices/${deviceId}`, { method: "PATCH", body: json(payload) });
  },
  deleteDevice(deviceId: string): Promise<void> {
    return request(`/api/devices/${deviceId}`, { method: "DELETE" });
  },
  readings(deviceId: string, limit = 60): Promise<ReadingPage> {
    return request(`/api/devices/${deviceId}/readings?limit=${limit}`);
  },
  latestReading(deviceId: string): Promise<SensorReading | null> {
    return request(`/api/devices/${deviceId}/readings/latest`);
  },
  sendCommand(
    deviceId: string,
    action: "set_led" | "set_buzzer" | "set_alerts" | "ping" | "set_thresholds",
    value?: boolean | Record<string, unknown>,
  ): Promise<CommandResponse> {
    return request(`/api/devices/${deviceId}/commands`, {
      method: "POST",
      body: json({ action, value }),
    });
  },

  // Study -----------------------------------------------------------------
  startSession(plannedMinutes = 25, planId?: string): Promise<StudySession> {
    return request("/api/study-sessions/start", {
      method: "POST",
      body: json({ planned_minutes: plannedMinutes, plan_id: planId ?? null }),
    });
  },
  activeSession(): Promise<StudySession | null> {
    return request("/api/study-sessions/active");
  },
  sessions(limit = 20): Promise<StudySession[]> {
    return request(`/api/study-sessions?limit=${limit}`);
  },
  pauseSession(sessionId: string): Promise<StudySession> {
    return request(`/api/study-sessions/${sessionId}/pause`, { method: "POST" });
  },
  resumeSession(sessionId: string): Promise<StudySession> {
    return request(`/api/study-sessions/${sessionId}/resume`, { method: "POST" });
  },
  finishSession(sessionId: string, cancelled = false): Promise<StudySession> {
    return request(`/api/study-sessions/${sessionId}/finish?cancelled=${cancelled}`, {
      method: "POST",
    });
  },
  stats(): Promise<StudyStats> {
    return request("/api/study/stats");
  },
  setGoal(dailyMinutes: number): Promise<{ daily_minutes: number }> {
    return request("/api/study/goal", {
      method: "PUT",
      body: json({ daily_minutes: dailyMinutes }),
    });
  },

  // Plans -----------------------------------------------------------------
  listPlans(): Promise<StudyPlan[]> {
    return request("/api/study-plans");
  },
  createPlan(title: string, plannedMinutes: number, description?: string): Promise<StudyPlan> {
    return request("/api/study-plans", {
      method: "POST",
      body: json({ title, planned_minutes: plannedMinutes, description: description ?? null }),
    });
  },
  updatePlan(
    planId: string,
    payload: { title?: string; status?: string; planned_minutes?: number },
  ): Promise<StudyPlan> {
    return request(`/api/study-plans/${planId}`, { method: "PATCH", body: json(payload) });
  },
  deletePlan(planId: string): Promise<void> {
    return request(`/api/study-plans/${planId}`, { method: "DELETE" });
  },

  // Notifications ---------------------------------------------------------
  notifications(unreadOnly = false, limit = 30): Promise<NotificationItem[]> {
    return request(`/api/notifications?unread_only=${unreadOnly}&limit=${limit}`);
  },
  markAllRead(): Promise<{ updated: number }> {
    return request("/api/notifications/read-all", { method: "POST" });
  },
  markRead(id: string): Promise<NotificationItem> {
    return request(`/api/notifications/${id}/read`, { method: "POST" });
  },
  registerDeviceToken(
    token: string,
    platform: "android" | "ios" | "web",
  ): Promise<DeviceTokenRegistration> {
    return request("/api/notifications/register-device", {
      method: "POST",
      body: json({ token, platform }),
    });
  },
  unregisterDeviceToken(token: string): Promise<{ unregistered: boolean }> {
    return request("/api/notifications/register-device", {
      method: "DELETE",
      body: json({ token }),
    });
  },
  sendNotification(title: string, body: string): Promise<PushDelivery> {
    return request("/api/notifications/send", {
      method: "POST",
      body: json({ title, body, type: "manual" }),
    });
  },

  // AI --------------------------------------------------------------------
  chat(message: string, conversationId?: string): Promise<ChatResponse> {
    return request("/api/assistant/chat", {
      method: "POST",
      body: json({ message, conversation_id: conversationId ?? null }),
    });
  },
  assistantContext(): Promise<AssistantContext> {
    return request("/api/assistant/context");
  },
  assistantHistory(limit = 50): Promise<AssistantHistoryItem[]> {
    return request(`/api/assistant/history?limit=${limit}`);
  },
};

export type { TelemetryAccepted };

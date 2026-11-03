import { cookies } from "next/headers";

export const ACCESS_COOKIE = "sla_at";
export const REFRESH_COOKIE = "sla_rt";
export const SESSION_COOKIE = "sla_session";

const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export function backendBaseUrl(): string {
  return (process.env.BACKEND_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");
}

export function backendApiUrl(path: string, search = ""): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${backendBaseUrl()}/api${clean}${search}`;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface SessionTokens {
  access: string | undefined;
  refresh: string | undefined;
}

const isSecure = process.env.NODE_ENV === "production";

export async function readSession(): Promise<SessionTokens> {
  const store = await cookies();
  return {
    access: store.get(ACCESS_COOKIE)?.value,
    refresh: store.get(REFRESH_COOKIE)?.value,
  };
}

export async function setSession(
  accessToken: string,
  refreshToken: string,
  expiresIn = 3600,
): Promise<void> {
  const store = await cookies();
  const common = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isSecure,
    path: "/",
  };
  store.set(ACCESS_COOKIE, accessToken, {
    ...common,
    maxAge: Math.max(60, Math.min(expiresIn, 60 * 60 * 24)),
  });
  store.set(REFRESH_COOKIE, refreshToken, {
    ...common,
    maxAge: SESSION_MAX_AGE,
  });
  store.set(SESSION_COOKIE, "1", { ...common, maxAge: SESSION_MAX_AGE });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(ACCESS_COOKIE);
  store.delete(REFRESH_COOKIE);
  store.delete(SESSION_COOKIE);
}

export async function refreshSession(
  refreshToken: string,
): Promise<TokenPair | null> {
  try {
    const response = await fetch(backendApiUrl("/auth/refresh"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const data = (await response.json()) as TokenPair;
    if (!data.access_token || !data.refresh_token) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Gọi backend kèm access token trong cookie. Nếu token hết hạn thì tự
 * refresh và ghi cookie mới. Chỉ dùng trong Route Handler / Server Action
 * (nơi được phép ghi cookie), không dùng trong Server Component.
 */
export async function backendAuthFetch(
  path: string,
  init: RequestInit = {},
  search = "",
): Promise<Response> {
  const session = await readSession();

  const call = (token: string | undefined) => {
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(backendApiUrl(path, search), {
      ...init,
      headers,
      cache: "no-store",
      redirect: "manual",
    });
  };

  let response = await call(session.access);

  if (response.status === 401 && session.refresh) {
    const tokens = await refreshSession(session.refresh);
    if (tokens) {
      await setSession(tokens.access_token, tokens.refresh_token, tokens.expires_in);
      response = await call(tokens.access_token);
    } else {
      await clearSession();
    }
  }

  return response;
}

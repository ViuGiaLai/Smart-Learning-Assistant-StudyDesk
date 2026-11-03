import { Linking } from "react-native";

import { useAuthStore } from "../store/authStore";
import { navigationRef } from "./navigationRef";

/**
 * Supabase gửi link về scheme của app (implicit flow, token nằm trong `#...`):
 *   smartstudy://reset-password#access_token=...&type=recovery
 *   smartstudy://email-confirmed#access_token=...&type=signup
 * Nếu link lỗi:
 *   smartstudy://reset-password#error=access_denied&error_code=otp_expired
 */
export type AuthLink =
  | { kind: "recovery"; accessToken?: string; error?: string }
  | { kind: "confirmed"; error?: string };

function parseParams(url: string): Record<string, string> {
  const hashIndex = url.indexOf("#");
  const queryIndex = url.indexOf("?");
  let raw = "";
  if (hashIndex >= 0) raw = url.slice(hashIndex + 1);
  else if (queryIndex >= 0) raw = url.slice(queryIndex + 1);
  if (!raw) return {};

  const params: Record<string, string> = {};
  for (const pair of raw.split("&")) {
    if (!pair) continue;
    const separator = pair.indexOf("=");
    const rawKey = separator >= 0 ? pair.slice(0, separator) : pair;
    const rawValue = separator >= 0 ? pair.slice(separator + 1) : "";
    try {
      params[decodeURIComponent(rawKey)] = decodeURIComponent(rawValue.replace(/\+/g, " "));
    } catch {
      params[rawKey] = rawValue;
    }
  }
  return params;
}

export function parseAuthLink(url: string): AuthLink | null {
  if (!url || !url.startsWith("smartstudy://")) return null;

  const params = parseParams(url);
  const type = params.type;
  const errorCode = params.error_code || params.error || undefined;

  const isRecovery = url.includes("reset-password") || type === "recovery";
  if (isRecovery) {
    if (errorCode) {
      return { kind: "recovery", error: params.error_description || errorCode };
    }
    if (!params.access_token) {
      return { kind: "recovery", error: "Liên kết không chứa mã đặt lại mật khẩu." };
    }
    return { kind: "recovery", accessToken: params.access_token };
  }

  const isConfirmed = url.includes("email-confirmed") || type === "signup";
  if (isConfirmed) {
    return { kind: "confirmed", error: errorCode };
  }
  return null;
}

let pendingUrl: string | null = null;

export function handleAuthUrl(url: string): void {
  const link = parseAuthLink(url);
  if (!link) return;

  if (link.kind === "recovery") {
    if (navigationRef.isReady()) {
      navigationRef.navigate("ResetPassword", { url });
    } else {
      // Navigator chưa sẵn sàng (app vừa mở từ link) -> xử lý ở onReady.
      pendingUrl = url;
    }
    return;
  }

  // Email confirmation: chỉ cần báo cho người dùng đăng nhập.
  useAuthStore.setState({
    notice: link.error
      ? "Email chưa được xác nhận hoặc liên kết đã hết hạn. Hãy đăng nhập để gửi lại."
      : "Email đã được xác nhận. Hãy đăng nhập vào ứng dụng.",
  });
  if (useAuthStore.getState().status !== "signedIn" && navigationRef.isReady()) {
    navigationRef.navigate("Login");
  }
}

export function flushPendingAuthUrl(): void {
  if (!pendingUrl) return;
  const url = pendingUrl;
  pendingUrl = null;
  handleAuthUrl(url);
}

/** Đăng ký lắng nghe link khi app đang chạy; trả về hàm huỷ. */
export function subscribeAuthLinks(): () => void {
  const subscription = Linking.addEventListener("url", ({ url }) => handleAuthUrl(url));
  void Linking.getInitialURL()
    .then((url) => {
      if (url) handleAuthUrl(url);
    })
    .catch(() => undefined);
  return () => subscription.remove();
}

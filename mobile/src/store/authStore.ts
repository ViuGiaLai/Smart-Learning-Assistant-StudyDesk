import { create } from "zustand";

import { ApiError, api } from "../api/client";
import { getStored, removeStored, setStored } from "../api/storage";
import { session } from "../api/session";
import type { TokenPair, User } from "../api/types";

const ACCESS_KEY = "sla.access_token";
const REFRESH_KEY = "sla.refresh_token";

type AuthStatus = "loading" | "signedOut" | "signedIn";

export interface SignUpResult {
  requiresEmailConfirmation: boolean;
}

interface AuthState {
  status: AuthStatus;
  user: User | null;
  error: string | null;
  notice: string | null;
  busy: boolean;
  bootstrap: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
  clearError: () => void;
  clearNotice: () => void;
}

async function persistTokens(tokens: TokenPair): Promise<void> {
  await Promise.all([
    setStored(ACCESS_KEY, tokens.access_token),
    setStored(REFRESH_KEY, tokens.refresh_token),
  ]);
}

async function clearTokens(): Promise<void> {
  await Promise.all([removeStored(ACCESS_KEY), removeStored(REFRESH_KEY)]);
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Đã có lỗi xảy ra";
}

export const useAuthStore = create<AuthState>((set) => ({
  status: "loading",
  user: null,
  error: null,
  notice: null,
  busy: false,

  async bootstrap() {
    const [access, refresh] = await Promise.all([
      getStored(ACCESS_KEY),
      getStored(REFRESH_KEY),
    ]);
    if (!access && !refresh) {
      set({ status: "signedOut" });
      return;
    }
    session.hydrate(access, refresh);
    try {
      const user = await api.me();
      set({ status: "signedIn", user, error: null });
    } catch {
      session.clear();
      await clearTokens();
      set({ status: "signedOut", user: null });
    }
  },

  async signIn(email, password) {
    set({ busy: true, error: null });
    try {
      const result = await api.login(email.trim(), password);
      if (!result.tokens) {
        throw new Error("Supabase không trả về phiên đăng nhập. Vui lòng thử lại.");
      }
      session.setTokens(result.tokens);
      await persistTokens(result.tokens);
      set({ status: "signedIn", user: result.user, busy: false, notice: null });
    } catch (error) {
      set({ busy: false, error: messageOf(error) });
      throw error;
    }
  },

  async signUp(name, email, password) {
    set({ busy: true, error: null, notice: null });
    try {
      const result = await api.register(email.trim(), name.trim(), password);
      if (!result.tokens) {
        const notice =
          "Đã tạo tài khoản. Hãy mở email, bấm liên kết xác nhận rồi đăng nhập lại.";
        set({
          busy: false,
          status: "signedOut",
          user: null,
          notice,
        });
        return { requiresEmailConfirmation: true };
      }
      session.setTokens(result.tokens);
      await persistTokens(result.tokens);
      set({
        status: "signedIn",
        user: result.user,
        busy: false,
        notice: null,
      });
      return { requiresEmailConfirmation: false };
    } catch (error) {
      set({ busy: false, error: messageOf(error) });
      throw error;
    }
  },

  async signOut() {
    session.clear();
    await clearTokens();
    set({ status: "signedOut", user: null, error: null, notice: null });
  },

  clearError() {
    set({ error: null });
  },

  clearNotice() {
    set({ notice: null });
  },
}));

// Keep SecureStore and the API client in sync when the client refreshes tokens.
session.setOnTokensUpdated((tokens) => {
  void persistTokens(tokens);
});

session.setOnExpired(() => {
  void clearTokens();
  useAuthStore.setState({ status: "signedOut", user: null });
});

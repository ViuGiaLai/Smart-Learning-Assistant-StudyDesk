import type { TokenPair } from "./types";

type TokensListener = (tokens: TokenPair) => void;

let accessToken: string | null = null;
let refreshToken: string | null = null;
let onTokensUpdated: TokensListener | null = null;
let onExpired: (() => void) | null = null;

export const session = {
  getAccess(): string | null {
    return accessToken;
  },
  getRefresh(): string | null {
    return refreshToken;
  },
  setTokens(tokens: TokenPair): void {
    accessToken = tokens.access_token;
    refreshToken = tokens.refresh_token;
    onTokensUpdated?.(tokens);
  },
  hydrate(access: string | null, refresh: string | null): void {
    accessToken = access;
    refreshToken = refresh;
  },
  clear(): void {
    accessToken = null;
    refreshToken = null;
  },
  setOnTokensUpdated(listener: TokensListener | null): void {
    onTokensUpdated = listener;
  },
  setOnExpired(listener: (() => void) | null): void {
    onExpired = listener;
  },
  expire(): void {
    accessToken = null;
    refreshToken = null;
    onExpired?.();
  },
};

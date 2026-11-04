import Constants from "expo-constants";
import { Platform } from "react-native";

function inferHost(): string {
  // In Expo Go, `hostUri` is the Metro bundler address, e.g. "192.168.1.20:8081".
  // Reusing that host means the phone can reach the API on the same machine
  // without hard-coding an IP address.
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants as unknown as { expoGoConfig?: { debuggerHost?: string } }).expoGoConfig
      ?.debuggerHost;
  if (!hostUri) return "localhost";
  const host = hostUri.split(":")[0];
  return host && host.length > 0 ? host : "localhost";
}

/**
 * Dev web fallback: when no API URL is configured, a page served from
 * localhost talks to the local backend on port 8011. An explicit
 * `EXPO_PUBLIC_API_URL` (e.g. the VPS) always wins.
 */
function localWebApiUrl(): string | null {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  const { hostname } = window.location;
  if (hostname !== "localhost" && hostname !== "127.0.0.1") return null;
  return `http://${hostname}:8011`;
}

const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
const webConfigured = process.env.EXPO_PUBLIC_WEB_API_URL?.trim();
const extraUrl = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;

/** Base REST URL. Override with EXPO_PUBLIC_API_URL for production builds. */
export const API_URL = (
  webConfigured ||
  configured ||
  localWebApiUrl() ||
  extraUrl ||
  `http://${inferHost()}:8010`
).replace(/\/$/, "");

export const WS_URL = API_URL.replace(/^http/, "ws");

export const REQUEST_TIMEOUT_MS = 15000;

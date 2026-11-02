import Constants from "expo-constants";

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

const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
const extraUrl = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;

/** Base REST URL. Override with EXPO_PUBLIC_API_URL for production builds. */
export const API_URL = (configured || extraUrl || `http://${inferHost()}:8010`).replace(
  /\/$/,
  "",
);

export const WS_URL = API_URL.replace(/^http/, "ws");

export const REQUEST_TIMEOUT_MS = 15000;

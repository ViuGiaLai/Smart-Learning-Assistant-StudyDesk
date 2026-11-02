import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { api } from "../api/client";

const TOKEN_KEY = "sla.fcm_token";
let currentToken: string | null = null;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("study-alerts", {
    name: "Cảnh báo học tập",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#0F766E",
    sound: "default",
  });
}

/**
 * Ask for permission and register the native FCM token with the backend.
 *
 * A native FCM token requires a development build (expo-dev-client), not Expo
 * Go, and Android needs mobile/google-services.json from the Firebase console.
 */
export async function registerPushToken(): Promise<string | null> {
  if (Platform.OS === "web" || !Device.isDevice) return null;

  await ensureAndroidChannel();
  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== "granted") {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== "granted") return null;

  const deviceToken = await Notifications.getDevicePushTokenAsync();
  // Expo returns { type: "android", data: <FCM registration token> } on Android.
  if (deviceToken.type !== "android" || !deviceToken.data) return null;

  currentToken = deviceToken.data;
  await AsyncStorage.setItem(TOKEN_KEY, deviceToken.data);
  const platform = Platform.OS === "ios" ? "ios" : "android";
  await api.registerDeviceToken(deviceToken.data, platform);
  return deviceToken.data;
}

export async function unregisterPushToken(): Promise<void> {
  const token = currentToken ?? (await AsyncStorage.getItem(TOKEN_KEY));
  if (!token) return;
  try {
    await api.unregisterDeviceToken(token);
  } catch {
    // Best effort: the server also reassigns a token to the next account.
  }
  currentToken = null;
  await AsyncStorage.removeItem(TOKEN_KEY);
}

export function setupNotificationTapHandler(onOpen: () => void): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener(() => {
    onOpen();
  });
  return () => subscription.remove();
}

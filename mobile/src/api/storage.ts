import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * Tokens live in SecureStore on device. Web/unsupported environments fall back
 * to AsyncStorage (development only).
 */
export async function getStored(key: string): Promise<string | null> {
  if (Platform.OS !== "web") {
    try {
      const value = await SecureStore.getItemAsync(key);
      if (value !== null) return value;
    } catch {
      // fall through to AsyncStorage
    }
  }
  return AsyncStorage.getItem(key);
}

export async function setStored(key: string, value: string): Promise<void> {
  if (Platform.OS !== "web") {
    try {
      await SecureStore.setItemAsync(key, value);
      return;
    } catch {
      // fall through
    }
  }
  await AsyncStorage.setItem(key, value);
}

export async function removeStored(key: string): Promise<void> {
  if (Platform.OS !== "web") {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // ignore
    }
  }
  await AsyncStorage.removeItem(key);
}

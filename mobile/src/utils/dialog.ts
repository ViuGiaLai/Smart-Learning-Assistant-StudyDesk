import { Alert, Platform } from "react-native";

/**
 * `Alert.alert` is a no-op on react-native-web, so every confirmation or
 * message must fall back to the browser dialogs when running on the web.
 */
interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}

function body(title: string, message?: string): string {
  return message ? `${title}\n\n${message}` : title;
}

export function showMessage(title: string, message?: string): void {
  if (Platform.OS === "web") {
    // eslint-disable-next-line no-alert
    window.alert(body(title, message));
    return;
  }
  Alert.alert(title, message);
}

export function confirmAction({
  title,
  message,
  confirmLabel = "Đồng ý",
  cancelLabel = "Huỷ",
  destructive = false,
  onConfirm,
}: ConfirmOptions): void {
  if (Platform.OS === "web") {
    // eslint-disable-next-line no-alert
    if (window.confirm(body(title, message))) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: cancelLabel, style: "cancel" },
    {
      text: confirmLabel,
      style: destructive ? "destructive" : "default",
      onPress: onConfirm,
    },
  ]);
}

import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Button, Divider, Text } from "react-native-paper";

import { ApiError, api } from "../api/client";
import type { NotificationItem } from "../api/types";
import { PageHeader } from "../components/PageHeader";
import { Screen } from "../components/Screen";
import { Card, EmptyState } from "../components/ui";
import type { RootStackParamList } from "../navigation/types";
import { palette, spacing } from "../theme";
import { relativeTime } from "../utils/format";
import { registerPushToken } from "../notifications/push";

type Props = NativeStackScreenProps<RootStackParamList, "Notifications">;

const ICONS: Record<string, React.ComponentProps<typeof MaterialCommunityIcons>["name"]> = {
  light_low: "white-balance-sunny",
  temperature_high: "thermometer-high",
  temperature_low: "thermometer-low",
  humidity_high: "water-percent",
  humidity_low: "water-percent",
  no_motion: "motion-sensor-off",
  device_offline: "access-point-off",
  study_completed: "check-circle-outline",
};

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Không tải được thông báo";
}

export default function NotificationsScreen({ navigation }: Props) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await api.notifications(false, 50);
      setItems(result);
      setError(null);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const markAll = async () => {
    try {
      await api.markAllRead();
      await load();
    } catch (caught) {
      setError(messageOf(caught));
    }
  };

  const markOne = async (item: NotificationItem) => {
    if (item.is_read) return;
    try {
      await api.markRead(item.id);
      setItems((current) =>
        current.map((entry) => (entry.id === item.id ? { ...entry, is_read: true } : entry)),
      );
    } catch (caught) {
      setError(messageOf(caught));
    }
  };

  const testPush = async () => {
    setPushBusy(true);
    setPushMessage(null);
    try {
      const token = await registerPushToken();
      if (!token) {
        setPushMessage(
          "Expo Go không hỗ trợ FCM. Hãy dùng development build/APK, "
            + "google-services.json và cấp quyền thông báo.",
        );
        return;
      }
      const result = await api.sendNotification(
        "Nhắc học thử",
        "Đã đến giờ học môn Lập trình Python.",
      );
      setPushMessage(
        result.push.enabled
          ? `Đã gửi tới ${result.push.sent}/${result.push.attempted} thiết bị.`
          : (result.push.detail ?? "Server chưa cấu hình FCM."),
      );
      await load();
    } catch (caught) {
      setPushMessage(messageOf(caught));
    } finally {
      setPushBusy(false);
    }
  };

  const unread = items.filter((item) => !item.is_read).length;

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={() => void load()}
    >
      <PageHeader
        title="Thông báo"
        subtitle={unread > 0 ? `${unread} thông báo chưa đọc` : "Bạn đã xem hết thông báo"}
        onBack={() => navigation.goBack()}
        right={
          unread > 0 ? (
            <Button compact icon="check-all" onPress={() => void markAll()}>
              Đọc hết
            </Button>
          ) : undefined
        }
      />

      {error ? (
        <Card style={styles.errorCard}>
          <Text variant="bodySmall" style={styles.errorText}>
            {error}
          </Text>
        </Card>
      ) : null}

      <Card style={styles.pushCard}>
        <View style={styles.pushRow}>
          <View style={styles.pushIcon}>
            <MaterialCommunityIcons name="bell-ring-outline" size={20} color={palette.primaryDark} />
          </View>
          <View style={styles.pushText}>
            <Text variant="titleSmall" style={styles.title}>
              Thông báo đẩy FCM
            </Text>
            <Text variant="bodySmall" style={styles.body}>
              Nhận nhắc học và cảnh báo môi trường trên điện thoại.
            </Text>
            {pushMessage ? (
              <Text variant="labelSmall" style={styles.pushMessage}>
                {pushMessage}
              </Text>
            ) : null}
          </View>
          <Button compact mode="contained-tonal" loading={pushBusy} onPress={() => void testPush()}>
            Gửi thử
          </Button>
        </View>
      </Card>

      {items.length === 0 ? (
        <EmptyState
          icon="bell-sleep-outline"
          title="Chưa có thông báo"
          message="Cảnh báo môi trường và nhắc nghỉ ngơi sẽ xuất hiện tại đây."
        />
      ) : (
        <Card style={styles.card}>
          {items.map((item, index) => (
            <View key={item.id}>
              {index > 0 ? <Divider /> : null}
              <View
                style={[styles.row, !item.is_read && styles.unreadRow]}
                onTouchEnd={() => void markOne(item)}
              >
                <View style={[styles.icon, item.is_read ? styles.iconRead : styles.iconUnread]}>
                  <MaterialCommunityIcons
                    name={ICONS[item.type] ?? "bell-outline"}
                    size={20}
                    color={item.is_read ? palette.muted : palette.primaryDark}
                  />
                </View>
                <View style={styles.content}>
                  <Text variant="titleSmall" style={styles.title}>
                    {item.title}
                  </Text>
                  <Text variant="bodySmall" style={styles.body}>
                    {item.content}
                  </Text>
                  <Text variant="labelSmall" style={styles.time}>
                    {relativeTime(item.created_at)}
                  </Text>
                </View>
                {!item.is_read ? <View style={styles.unreadDot} /> : null}
              </View>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  errorCard: { backgroundColor: "#FEF2F2", borderColor: "#FECACA", marginBottom: spacing.md },
  errorText: { color: palette.danger },
  pushCard: { marginBottom: spacing.md },
  pushRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  pushIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: palette.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  pushText: { flex: 1 },
  pushMessage: { color: palette.primaryDark, marginTop: 4 },
  card: { paddingVertical: 0 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  unreadRow: { backgroundColor: "#F0FDFA" },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  iconRead: { backgroundColor: "#ECF0EF" },
  iconUnread: { backgroundColor: palette.primarySoft },
  content: { flex: 1 },
  title: { color: palette.text, fontWeight: "600" },
  body: { color: palette.muted, marginTop: 2, lineHeight: 18 },
  time: { color: palette.muted, marginTop: 4 },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.primary,
    marginTop: 6,
  },
});

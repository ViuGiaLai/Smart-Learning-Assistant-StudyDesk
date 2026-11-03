import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Button, Chip, Dialog, Divider, Portal, Text } from "react-native-paper";

import { api } from "../api/client";
import type { NotificationItem } from "../api/types";
import { PageHeader } from "../components/PageHeader";
import { Screen } from "../components/Screen";
import { Card, EmptyState } from "../components/ui";
import type { RootStackParamList } from "../navigation/types";
import { registerPushToken } from "../notifications/push";
import { useNotificationStore } from "../store/notificationStore";
import { palette, spacing } from "../theme";
import { relativeTime } from "../utils/format";

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
  manual: "bell-ring-outline",
};

export default function NotificationsScreen({ navigation }: Props) {
  const items = useNotificationStore((state) => state.items);
  const unreadCount = useNotificationStore((state) => state.unreadCount);
  const loading = useNotificationStore((state) => state.loading);
  const refreshing = useNotificationStore((state) => state.refreshing);
  const error = useNotificationStore((state) => state.error);
  const load = useNotificationStore((state) => state.load);
  const markOneRead = useNotificationStore((state) => state.markOneRead);
  const markAllRead = useNotificationStore((state) => state.markAllRead);

  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [selectedItem, setSelectedItem] = useState<NotificationItem | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState<string | null>(null);

  // Load silently on mount / cache hit
  useEffect(() => {
    void load({ background: true });
  }, [load]);

  const handlePressItem = (item: NotificationItem) => {
    void markOneRead(item.id);
    setSelectedItem(item);
  };

  const testPush = async () => {
    setPushBusy(true);
    setPushMessage(null);
    try {
      const token = await registerPushToken();
      if (!token) {
        setPushMessage(
          "Expo Go không hỗ trợ FCM. Hãy dùng development build/APK và cấp quyền thông báo.",
        );
        return;
      }
      const result = await api.sendNotification(
        "Nhắc học SmartStudy",
        "Đã đến giờ bắt đầu phiên học tập trung cùng bàn học IoT!",
      );
      setPushMessage(
        result.push.enabled
          ? `Đã gửi thành công tới ${result.push.sent}/${result.push.attempted} thiết bị.`
          : (result.push.detail ?? "Server chưa cấu hình FCM."),
      );
      await load({ force: true });
    } catch (caught) {
      setPushMessage(caught instanceof Error ? caught.message : "Gửi thử thất bại");
    } finally {
      setPushBusy(false);
    }
  };

  const displayedItems = filter === "unread" ? items.filter((item) => !item.is_read) : items;

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={() => void load({ force: true })}
    >
      <PageHeader
        title="Thông báo"
        subtitle={
          unreadCount > 0 ? `${unreadCount} thông báo chưa đọc` : "Bạn đã xem hết thông báo"
        }
        onBack={() => navigation.goBack()}
        right={
          unreadCount > 0 ? (
            <Button
              compact
              mode="contained-tonal"
              icon="check-all"
              onPress={() => void markAllRead()}
              style={styles.markAllButton}
            >
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

      {/* FCM Push Test Banner */}
      <Card style={styles.pushCard}>
        <View style={styles.pushRow}>
          <View style={styles.pushIcon}>
            <MaterialCommunityIcons name="bell-ring-outline" size={20} color={palette.primaryDark} />
          </View>
          <View style={styles.pushText}>
            <Text variant="titleSmall" style={styles.pushTitle}>
              Thông báo đẩy FCM
            </Text>
            <Text variant="bodySmall" style={styles.pushBody}>
              Cảnh báo môi trường và nhắc học tự động gửi tới điện thoại của bạn.
            </Text>
            {pushMessage ? (
              <Text variant="labelSmall" style={styles.pushMessage}>
                {pushMessage}
              </Text>
            ) : null}
          </View>
          <Button
            compact
            mode="contained-tonal"
            loading={pushBusy}
            disabled={pushBusy}
            onPress={() => void testPush()}
          >
            Gửi thử
          </Button>
        </View>
      </Card>

      {/* Filter Tabs */}
      <View style={styles.filterRow}>
        <Chip
          selected={filter === "all"}
          onPress={() => setFilter("all")}
          style={[styles.filterChip, filter === "all" && styles.filterChipActive]}
          textStyle={filter === "all" ? styles.filterTextActive : styles.filterText}
        >
          Tất cả ({items.length})
        </Chip>
        <Chip
          selected={filter === "unread"}
          onPress={() => setFilter("unread")}
          style={[styles.filterChip, filter === "unread" && styles.filterChipActive]}
          textStyle={filter === "unread" ? styles.filterTextActive : styles.filterText}
        >
          Chưa đọc ({unreadCount})
        </Chip>
      </View>

      {/* Loading Skeleton */}
      {loading && items.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={palette.primary} size="large" />
          <Text variant="bodyMedium" style={styles.loadingText}>
            Đang tải thông báo…
          </Text>
        </View>
      ) : displayedItems.length === 0 ? (
        <EmptyState
          icon={filter === "unread" ? "bell-check-outline" : "bell-sleep-outline"}
          title={filter === "unread" ? "Không có thông báo chưa đọc" : "Chưa có thông báo"}
          message={
            filter === "unread"
              ? "Bạn đã đọc tất cả thông báo hiện có."
              : "Cảnh báo môi trường bàn học và nhắc nhở phiên học sẽ xuất hiện tại đây."
          }
        />
      ) : (
        <Card style={styles.listCard}>
          {displayedItems.map((item, index) => {
            const iconName = ICONS[item.type] ?? "bell-outline";
            const isUnread = !item.is_read;

            return (
              <View key={item.id}>
                {index > 0 ? <Divider style={styles.divider} /> : null}
                <Pressable
                  onPress={() => handlePressItem(item)}
                  style={({ pressed }) => [
                    styles.itemRow,
                    isUnread && styles.unreadRow,
                    pressed && styles.pressedRow,
                  ]}
                  android_ripple={{ color: "rgba(15, 118, 110, 0.08)" }}
                >
                  <View
                    style={[
                      styles.iconContainer,
                      isUnread ? styles.iconUnread : styles.iconRead,
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={iconName}
                      size={20}
                      color={isUnread ? palette.primaryDark : palette.muted}
                    />
                  </View>

                  <View style={styles.contentContainer}>
                    <View style={styles.itemHeader}>
                      <Text
                        variant="titleSmall"
                        style={[styles.itemTitle, isUnread && styles.unreadTitle]}
                        numberOfLines={1}
                      >
                        {item.title}
                      </Text>
                      <Text variant="labelSmall" style={styles.itemTime}>
                        {relativeTime(item.created_at)}
                      </Text>
                    </View>

                    <Text
                      variant="bodySmall"
                      style={[styles.itemBody, isUnread && styles.unreadBody]}
                      numberOfLines={2}
                    >
                      {item.content}
                    </Text>
                  </View>

                  {isUnread ? <View style={styles.unreadDot} /> : null}
                </Pressable>
              </View>
            );
          })}
        </Card>
      )}

      {/* Detail Dialog */}
      <Portal>
        <Dialog
          visible={selectedItem !== null}
          onDismiss={() => setSelectedItem(null)}
          style={styles.dialog}
        >
          <Dialog.Icon icon={ICONS[selectedItem?.type ?? ""] ?? "bell-outline"} />
          <Dialog.Title style={styles.dialogTitle}>{selectedItem?.title}</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={styles.dialogContent}>
              {selectedItem?.content}
            </Text>
            <Text variant="labelSmall" style={styles.dialogTime}>
              Thời gian: {selectedItem ? new Date(selectedItem.created_at).toLocaleString("vi-VN") : ""}
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setSelectedItem(null)}>Đóng</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  markAllButton: { borderRadius: 10 },
  errorCard: {
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  errorText: { color: palette.danger },
  pushCard: {
    marginBottom: spacing.md,
    backgroundColor: "#F0FDFA",
    borderColor: "#CCFBF1",
    borderWidth: 1,
  },
  pushRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  pushIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: "#CCFBF1",
    alignItems: "center",
    justifyContent: "center",
  },
  pushText: { flex: 1 },
  pushTitle: { color: palette.text, fontWeight: "600" },
  pushBody: { color: palette.muted, marginTop: 2, lineHeight: 18 },
  pushMessage: { color: palette.primaryDark, marginTop: 4, fontWeight: "500" },
  filterRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  filterChip: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
  },
  filterChipActive: {
    backgroundColor: palette.primarySoft,
    borderColor: palette.primary,
  },
  filterText: { color: palette.muted, fontSize: 13 },
  filterTextActive: { color: palette.primaryDark, fontWeight: "600", fontSize: 13 },
  loadingContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xxl,
    gap: spacing.md,
  },
  loadingText: { color: palette.muted },
  listCard: {
    paddingVertical: 0,
    paddingHorizontal: 0,
    overflow: "hidden",
  },
  divider: { backgroundColor: palette.border },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: palette.surface,
  },
  unreadRow: {
    backgroundColor: "#F0FDFA",
  },
  pressedRow: {
    opacity: 0.85,
    backgroundColor: "#E6FAF6",
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  iconRead: { backgroundColor: "#F1F5F4" },
  iconUnread: { backgroundColor: "#CCFBF1" },
  contentContainer: { flex: 1, marginLeft: spacing.md, marginRight: spacing.sm },
  itemHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 2,
  },
  itemTitle: { color: palette.text, fontWeight: "500", flex: 1, marginRight: spacing.sm },
  unreadTitle: { fontWeight: "700", color: "#0A4641" },
  itemTime: { color: palette.muted, fontSize: 11 },
  itemBody: { color: palette.muted, lineHeight: 18 },
  unreadBody: { color: palette.text },
  unreadDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: palette.primary,
  },
  dialog: { backgroundColor: palette.surface, borderRadius: 20 },
  dialogTitle: { textAlign: "center", color: palette.text, fontWeight: "700" },
  dialogContent: { color: palette.text, lineHeight: 22 },
  dialogTime: { color: palette.muted, marginTop: spacing.md },
});

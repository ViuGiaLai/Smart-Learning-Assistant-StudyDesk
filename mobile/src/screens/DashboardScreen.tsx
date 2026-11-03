import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { CompositeScreenProps } from "@react-navigation/native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  Badge,
  Button,
  Dialog,
  IconButton,
  Menu,
  Portal,
  ProgressBar,
  Text,
} from "react-native-paper";

import { api } from "../api/client";
import type {
  AssistantContext,
  NotificationItem,
  SensorReading,
  StudyStats,
} from "../api/types";
import { PageHeader } from "../components/PageHeader";
import { Screen } from "../components/Screen";
import { Card, SectionTitle, StatTile, StatusPill } from "../components/ui";
import { useDeviceStream } from "../hooks/useDeviceStream";
import type { RootStackParamList, TabParamList } from "../navigation/types";
import { useAuthStore } from "../store/authStore";
import { useDeviceStore } from "../store/deviceStore";
import { palette, spacing } from "../theme";
import {
  formatDuration,
  formatMinutes,
  formatTime,
  greeting,
  relativeTime,
} from "../utils/format";

type Props = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, "Home">,
  NativeStackScreenProps<RootStackParamList>
>;

export default function DashboardScreen({ navigation }: Props) {
  const user = useAuthStore((state) => state.user);
  const signOut = useAuthStore((state) => state.signOut);
  const devices = useDeviceStore((state) => state.devices);
  const selectedId = useDeviceStore((state) => state.selectedId);
  const refreshDevices = useDeviceStore((state) => state.refresh);

  const [stats, setStats] = useState<StudyStats | null>(null);
  const [latest, setLatest] = useState<SensorReading | null>(null);
  const [context, setContext] = useState<AssistantContext | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);

  const selectedDevice = devices.find((device) => device.id === selectedId) ?? null;
  const { latest: liveReading, status: liveStatus } = useDeviceStream(selectedId);
  const reading = liveReading ?? latest;
  const online = liveStatus ? liveStatus === "online" : selectedDevice?.status === "online";

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshDevices();
      const deviceId = useDeviceStore.getState().selectedId;
      const [statsResult, contextResult, unread, readingResult] = await Promise.all([
        api.stats(),
        api.assistantContext(),
        api.notifications(true, 10),
        deviceId ? api.latestReading(deviceId).catch(() => null) : Promise.resolve(null),
      ]);
      setStats(statsResult);
      setContext(contextResult);
      setNotifications(unread);
      setLatest(readingResult);
    } catch {
      // Individual screens surface connection errors; the dashboard stays usable.
    } finally {
      setRefreshing(false);
    }
  }, [refreshDevices]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const todayMinutes = formatMinutes(stats?.today_focused_seconds);
  const goalMinutes = stats?.daily_goal_minutes ?? 120;
  const completion = stats?.goal_completion_rate ?? 0;
  const suggestion = context?.suggestions[0];

  const confirmSignOut = () => {
    setAccountMenuOpen(false);
    setSignOutOpen(true);
  };

  const handleSignOut = () => {
    setSignOutOpen(false);
    void signOut();
  };

  return (
    <Screen refreshing={refreshing} onRefresh={() => void load()} contentStyle={styles.content}>
      <PageHeader
        title={`${greeting()}, ${user?.name?.split(" ")[0] ?? "bạn"}`}
        subtitle="Sẵn sàng cho một phiên học tập trung?"
        right={
          <View style={styles.headerActions}>
            <View>
              <IconButton
                icon="bell-outline"
                size={24}
                onPress={() => navigation.navigate("Notifications")}
                accessibilityLabel="Thông báo"
              />
              {notifications.length > 0 ? (
                <Badge style={styles.badge} size={18}>
                  {notifications.length > 9 ? "9+" : notifications.length}
                </Badge>
              ) : null}
            </View>
            <Menu
              visible={accountMenuOpen}
              onDismiss={() => setAccountMenuOpen(false)}
              anchor={
                <IconButton
                  icon="account-circle-outline"
                  size={26}
                  onPress={() => setAccountMenuOpen(true)}
                  accessibilityLabel="Tài khoản và đăng xuất"
                  style={styles.accountButton}
                />
              }
            >
              <Menu.Item
                title={user?.email ?? ""}
                disabled
                titleStyle={styles.menuEmail}
              />
              <Menu.Item
                leadingIcon="logout"
                title="Đăng xuất"
                onPress={confirmSignOut}
              />
            </Menu>
          </View>
        }
      />

      <Portal>
        <Dialog
          visible={signOutOpen}
          onDismiss={() => setSignOutOpen(false)}
          style={styles.dialog}
        >
          <Dialog.Icon icon="logout" />
          <Dialog.Title style={styles.dialogTitle}>Đăng xuất?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={styles.muted}>
              Bạn sẽ cần đăng nhập lại để tiếp tục theo dõi phiên học.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setSignOutOpen(false)}>Huỷ</Button>
            <Button textColor={palette.danger} onPress={handleSignOut}>
              Đăng xuất
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Card style={styles.hero}>
        <View style={styles.heroRow}>
          <View>
            <Text variant="labelLarge" style={styles.heroLabel}>
              Mục tiêu hôm nay
            </Text>
            <View style={styles.heroValueRow}>
              <Text variant="displaySmall" style={styles.heroValue}>
                {todayMinutes}
              </Text>
              <Text variant="bodyMedium" style={styles.heroUnit}>
                / {goalMinutes} phút
              </Text>
            </View>
          </View>
          <View style={styles.streak}>
            <MaterialCommunityIcons name="fire" size={20} color={palette.accent} />
            <Text variant="labelMedium" style={styles.heroLabel}>
              {stats?.today_sessions ?? 0} phiên
            </Text>
          </View>
        </View>
        <ProgressBar
          progress={Math.min(1, completion / 100)}
          color={palette.accent}
          style={styles.progress}
        />
        <Text variant="bodySmall" style={styles.heroHint}>
          {completion >= 100
            ? "Bạn đã đạt mục tiêu. Nghỉ ngơi để giữ nhịp học bền vững."
            : `Còn ${Math.max(0, goalMinutes - todayMinutes)} phút để hoàn thành mục tiêu.`}
        </Text>
        <View style={styles.heroActions}>
          <Button
            mode="contained"
            icon="play"
            onPress={() => navigation.navigate("Focus")}
            style={styles.heroButton}
            buttonColor="#FFFFFF"
            textColor={palette.primaryDark}
          >
            Bắt đầu 25 phút
          </Button>
          <Button
            mode="outlined"
            icon="calendar-check-outline"
            onPress={() => navigation.navigate("Plans")}
            style={styles.heroButton}
            textColor="#FFFFFF"
          >
            Kế hoạch
          </Button>
        </View>
      </Card>

      <SectionTitle
        title="Bàn học IoT"
        action={
          <Button compact onPress={() => navigation.navigate("Device")}>
            Quản lý
          </Button>
        }
      />
      {selectedDevice ? (
        <Card>
          <View style={styles.deviceRow}>
            <View style={styles.deviceIcon}>
              <MaterialCommunityIcons
                name="desk"
                size={22}
                color={palette.primaryDark}
              />
            </View>
            <View style={styles.deviceInfo}>
              <Text variant="titleSmall" style={styles.deviceName}>
                {selectedDevice.name}
              </Text>
              <Text variant="bodySmall" style={styles.muted}>
                {selectedDevice.device_code} ·{" "}
                {reading ? `cập nhật ${relativeTime(reading.recorded_at)}` : "chưa có dữ liệu"}
              </Text>
            </View>
            <StatusPill online={online} />
          </View>

          <View style={styles.metricsGrid}>
            <StatTile
              icon="thermometer"
              label="Nhiệt độ"
              value={reading?.temperature != null ? reading.temperature.toFixed(1) : "—"}
              unit="°C"
              tone="accent"
            />
            <StatTile
              icon="water-percent"
              label="Độ ẩm"
              value={reading?.humidity != null ? reading.humidity.toFixed(0) : "—"}
              unit="%"
              tone="info"
            />
            <StatTile
              icon="white-balance-sunny"
              label="Ánh sáng"
              value={reading?.light_lux != null ? reading.light_lux.toFixed(0) : "—"}
              unit="lux"
              tone="primary"
            />
            <StatTile
              icon={reading?.motion_detected ? "motion-sensor" : "motion-sensor-off"}
              label="Chuyển động"
              value={reading?.motion_detected ? "Có" : "Không"}
              tone={reading?.motion_detected ? "primary" : "muted"}
            />
          </View>

          <Button
            mode="text"
            icon="chart-timeline-variant"
            onPress={() => navigation.navigate("Environment")}
            contentStyle={styles.leftButton}
          >
            Xem biểu đồ môi trường
          </Button>
        </Card>
      ) : (
        <Card style={styles.emptyCard}>
          <MaterialCommunityIcons name="access-point-network-off" size={34} color={palette.muted} />
          <Text variant="titleSmall" style={styles.emptyTitle}>
            Chưa kết nối thiết bị
          </Text>
          <Text variant="bodySmall" style={styles.muted}>
            Đăng ký mã ESP32 để bắt đầu nhận dữ liệu nhiệt độ, độ ẩm và ánh sáng.
          </Text>
          <Button
            mode="contained-tonal"
            icon="plus"
            onPress={() => navigation.navigate("Device", { register: true })}
            style={{ marginTop: spacing.md }}
          >
            Thêm thiết bị
          </Button>
        </Card>
      )}

      <SectionTitle title="Gợi ý cho bạn" />
      <Card style={styles.tipCard}>
        <View style={styles.tipHeader}>
          <View style={styles.tipIcon}>
            <MaterialCommunityIcons name="lightbulb-on-outline" size={20} color={palette.warning} />
          </View>
          <Text variant="titleSmall" style={styles.tipTitle}>
            Trợ lý học tập
          </Text>
          <View style={styles.spacer} />
          <Button compact onPress={() => navigation.navigate("Assistant")}>
            Hỏi thêm
          </Button>
        </View>
        <Text variant="bodyMedium" style={styles.tipText}>
          {suggestion ??
            "Bắt đầu một phiên học để trợ lý theo dõi môi trường và nhắc bạn nghỉ ngơi hợp lý."}
        </Text>
        {context?.suggestions.slice(1, 3).map((item) => (
          <View key={item} style={styles.tipBullet}>
            <MaterialCommunityIcons name="check-circle-outline" size={16} color={palette.primary} />
            <Text variant="bodySmall" style={styles.tipBulletText}>
              {item}
            </Text>
          </View>
        ))}
      </Card>

      <SectionTitle title="Tuần này" />
      <Card style={styles.weekCard}>
        <View>
          <Text variant="labelMedium" style={styles.muted}>
            Tổng thời gian tập trung
          </Text>
          <Text variant="headlineSmall" style={styles.weekValue}>
            {formatDuration(stats?.week_focused_seconds)}
          </Text>
        </View>
        <View style={styles.weekRight}>
          <Text variant="labelMedium" style={styles.muted}>
            {stats?.week_sessions ?? 0} phiên
          </Text>
          <Text variant="bodySmall" style={styles.muted}>
            Cập nhật {formatTime(new Date().toISOString())}
          </Text>
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.xxl },
  badge: { position: "absolute", top: 2, right: 2, backgroundColor: palette.danger },
  headerActions: { flexDirection: "row", alignItems: "center", marginRight: -spacing.sm },
  accountButton: { margin: 0, marginLeft: spacing.xs },
  menuEmail: { color: palette.muted, fontSize: 12 },
  dialog: { backgroundColor: palette.surface, borderRadius: 20 },
  dialogTitle: { textAlign: "center" },
  hero: {
    backgroundColor: palette.primary,
    borderColor: palette.primary,
    padding: spacing.lg,
  },
  heroRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  heroLabel: { color: "#D1FAE5" },
  heroValueRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 2 },
  heroValue: { color: "#FFFFFF", fontWeight: "700" },
  heroUnit: { color: "#D1FAE5" },
  streak: { flexDirection: "row", alignItems: "center", gap: 4 },
  progress: {
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.22)",
    marginTop: spacing.md,
  },
  heroHint: { color: "#D1FAE5", marginTop: spacing.sm },
  heroActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  heroButton: { borderRadius: 12, flex: 1 },
  deviceRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  deviceIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: palette.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  deviceInfo: { flex: 1 },
  deviceName: { color: palette.text, fontWeight: "600" },
  muted: { color: palette.muted },
  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginTop: spacing.md,
  },
  leftButton: { justifyContent: "flex-start", paddingHorizontal: 0 },
  emptyCard: { alignItems: "center", gap: spacing.xs },
  emptyTitle: { color: palette.text, fontWeight: "600" },
  tipCard: { gap: spacing.sm },
  tipHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  tipIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: palette.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  tipTitle: { color: palette.text, fontWeight: "600" },
  spacer: { flex: 1 },
  tipText: { color: palette.text, lineHeight: 21 },
  tipBullet: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  tipBulletText: { color: palette.muted, flex: 1, lineHeight: 19 },
  weekCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  weekValue: { color: palette.text, fontWeight: "700", marginTop: 2 },
  weekRight: { alignItems: "flex-end", gap: 2 },
});

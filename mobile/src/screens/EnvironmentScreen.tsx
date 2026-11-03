import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { CompositeScreenProps } from "@react-navigation/native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Button, Chip, Text } from "react-native-paper";

import { api } from "../api/client";
import type { SensorReading } from "../api/types";
import { PageHeader } from "../components/PageHeader";
import { Screen } from "../components/Screen";
import {
  Card,
  EmptyState,
  KeyValueRow,
  MiniBars,
  SectionTitle,
  StatTile,
  StatusPill,
} from "../components/ui";
import { useDeviceStream } from "../hooks/useDeviceStream";
import type { TabParamList, RootStackParamList } from "../navigation/types";
import { useDeviceStore } from "../store/deviceStore";
import { palette, spacing } from "../theme";
import { formatTime, relativeTime } from "../utils/format";

type Props = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, "Environment">,
  NativeStackScreenProps<RootStackParamList>
>;

export default function EnvironmentScreen({ navigation }: Props) {
  const devices = useDeviceStore((state) => state.devices);
  const selectedId = useDeviceStore((state) => state.selectedId);
  const select = useDeviceStore((state) => state.select);
  const refreshDevices = useDeviceStore((state) => state.refresh);

  const [readings, setReadings] = useState<SensorReading[]>([]);
  const [loading, setLoading] = useState(false);
  const lastLoadedAt = useRef<number>(0);

  const selected = devices.find((device) => device.id === selectedId) ?? null;
  const { latest: live, alerts, connected, status } = useDeviceStream(selectedId);

  const loadReadings = useCallback(async (force = false) => {
    const deviceId = useDeviceStore.getState().selectedId;
    if (!deviceId) return;
    const now = Date.now();
    if (!force && now - lastLoadedAt.current < 15_000) return;
    // Only show inline loading note on first load if we don't have readings yet
    if (readings.length === 0) {
      setLoading(true);
    }
    try {
      const page = await api.readings(deviceId, 60);
      setReadings(page.items);
      lastLoadedAt.current = Date.now();
    } catch {
      // Keep last data.
    } finally {
      setLoading(false);
    }
  }, [readings.length]);

  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      if (now - lastLoadedAt.current < 15_000) return;
      void (async () => {
        await refreshDevices();
        await loadReadings(true);
      })();
    }, [loadReadings, refreshDevices]),
  );

  useEffect(() => {
    setReadings([]);
    lastLoadedAt.current = 0;
    if (selectedId) void loadReadings(true);
  }, [selectedId, loadReadings]);

  // REST fallback when the WebSocket is unavailable.
  useEffect(() => {
    if (connected) return;
    const timer = setInterval(() => void loadReadings(), 15000);
    return () => clearInterval(timer);
  }, [connected, loadReadings]);

  useEffect(() => {
    if (!live) return;
    setReadings((current) => {
      if (current.some((item) => item.id === live.id)) return current;
      return [live, ...current].slice(0, 60);
    });
  }, [live]);

  const latest = live ?? readings[0] ?? null;
  const online = status ? status === "online" : selected?.status === "online";

  const recent = [...readings].slice(0, 24).reverse();
  const lightSeries = recent.map((reading, index) => ({
    label: index % 6 === 0 ? formatTime(reading.recorded_at) : "",
    value: reading.light_lux ?? 0,
    highlight: (reading.light_lux ?? 0) < (selected?.settings.light_min_lux ?? 150),
  }));
  const temperatureSeries = recent.map((reading, index) => ({
    label: index % 6 === 0 ? formatTime(reading.recorded_at) : "",
    value: reading.temperature ?? 0,
    highlight:
      reading.temperature != null &&
      selected != null &&
      (reading.temperature > selected.settings.temperature_max ||
        reading.temperature < selected.settings.temperature_min),
  }));
  const motionDots = readings.slice(0, 36).reverse();

  if (!selected) {
    return (
      <Screen>
        <PageHeader title="Môi trường học tập" subtitle="Giám sát cảm biến bàn học" />
        <EmptyState
          icon="access-point-network-off"
          title="Chưa có thiết bị IoT"
          message="Đăng ký ESP32 để xem nhiệt độ, độ ẩm, ánh sáng và chuyển động theo thời gian thực."
          action={
            <Button
              mode="contained"
              icon="plus"
              onPress={() => navigation.navigate("Device", { register: true })}
            >
              Thêm thiết bị
            </Button>
          }
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <PageHeader
        title="Môi trường học tập"
        subtitle="Cập nhật trực tiếp từ cảm biến bàn học"
        right={<StatusPill online={online} label={online ? "Online" : "Offline"} />}
      />

      {devices.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
          {devices.map((device) => (
            <Chip
              key={device.id}
              selected={device.id === selectedId}
              onPress={() => select(device.id)}
              style={styles.chip}
            >
              {device.name}
            </Chip>
          ))}
        </ScrollView>
      ) : null}

      <Card>
        <View style={styles.deviceHeader}>
          <View>
            <Text variant="titleSmall" style={styles.deviceName}>
              {selected.name}
            </Text>
            <Text variant="bodySmall" style={styles.muted}>
              {selected.device_code} ·{" "}
              {latest ? `cập nhật ${relativeTime(latest.recorded_at)}` : "chưa có dữ liệu"}
            </Text>
          </View>
          <View style={styles.liveRow}>
            <MaterialCommunityIcons
              name={connected ? "access-point" : "access-point-off"}
              size={16}
              color={connected ? palette.success : palette.muted}
            />
            <Text variant="labelSmall" style={styles.muted}>
              {connected ? "Live" : "15s/lần"}
            </Text>
          </View>
        </View>

        <View style={styles.grid}>
          <StatTile
            icon="thermometer"
            label="Nhiệt độ"
            value={latest?.temperature != null ? latest.temperature.toFixed(1) : "—"}
            unit="°C"
            tone="accent"
          />
          <StatTile
            icon="water-percent"
            label="Độ ẩm"
            value={latest?.humidity != null ? latest.humidity.toFixed(0) : "—"}
            unit="%"
            tone="info"
          />
          <StatTile
            icon="white-balance-sunny"
            label="Ánh sáng"
            value={latest?.light_lux != null ? latest.light_lux.toFixed(0) : "—"}
            unit="lux"
            tone="primary"
          />
          <StatTile
            icon={latest?.motion_detected ? "motion-sensor" : "motion-sensor-off"}
            label="Chuyển động"
            value={latest?.motion_detected ? "Có" : "Không"}
            tone={latest?.motion_detected ? "primary" : "muted"}
          />
        </View>
      </Card>

      {alerts.length > 0 ? (
        <Card style={styles.alertCard}>
          <View style={styles.alertHeader}>
            <MaterialCommunityIcons name="alert-circle-outline" size={20} color={palette.warning} />
            <Text variant="titleSmall" style={styles.alertTitle}>
              Cảnh báo môi trường
            </Text>
          </View>
          {alerts.map((alert, index) => (
            <Text key={`${alert.type}-${index}`} variant="bodySmall" style={styles.alertText}>
              {alert.content}
            </Text>
          ))}
        </Card>
      ) : null}

      <SectionTitle title="Ánh sáng theo thời gian" />
      <Card>
        <MiniBars data={lightSeries} color={palette.accent} emptyText="Chưa đủ dữ liệu để vẽ biểu đồ" />
        <Text variant="labelSmall" style={styles.chartNote}>
          Cột màu cam = dưới ngưỡng {selected.settings.light_min_lux.toFixed(0)} lux
        </Text>
      </Card>

      <SectionTitle title="Nhiệt độ theo thời gian" />
      <Card>
        <MiniBars
          data={temperatureSeries}
          color={palette.info}
          emptyText="Chưa đủ dữ liệu để vẽ biểu đồ"
        />
        <Text variant="labelSmall" style={styles.chartNote}>
          Ngưỡng cấu hình {selected.settings.temperature_min.toFixed(0)}–
          {selected.settings.temperature_max.toFixed(0)}°C
        </Text>
      </Card>

      <SectionTitle title="Chuyển động gần đây" />
      <Card>
        <View style={styles.motionRow}>
          {motionDots.length === 0 ? (
            <Text variant="bodySmall" style={styles.muted}>
              Chưa có dữ liệu chuyển động.
            </Text>
          ) : (
            motionDots.map((reading) => (
              <View
                key={reading.id}
                style={[
                  styles.motionDot,
                  { backgroundColor: reading.motion_detected ? palette.primary : palette.border },
                ]}
              />
            ))
          )}
        </View>
        <Text variant="labelSmall" style={styles.chartNote}>
          PIR chỉ phát hiện chuyển động, không khẳng định bạn đang ngồi học.
        </Text>
      </Card>

      <SectionTitle title="Ngưỡng cảnh báo" />
      <Card>
        <KeyValueRow
          icon="thermometer"
          label="Nhiệt độ"
          value={`${selected.settings.temperature_min}–${selected.settings.temperature_max}°C`}
        />
        <KeyValueRow
          icon="water-percent"
          label="Độ ẩm"
          value={`${selected.settings.humidity_min}–${selected.settings.humidity_max}%`}
        />
        <KeyValueRow
          icon="white-balance-sunny"
          label="Ánh sáng tối thiểu"
          value={`${selected.settings.light_min_lux} lux`}
        />
        <KeyValueRow
          icon="timer-sand"
          label="Không chuyển động"
          value={`${selected.settings.no_motion_minutes} phút`}
        />
        <Button
          mode="text"
          icon="tune"
          onPress={() => navigation.navigate("Device")}
          contentStyle={styles.leftButton}
        >
          Điều chỉnh ngưỡng
        </Button>
      </Card>

      {loading ? (
        <Text variant="labelSmall" style={styles.loading}>
          Đang tải dữ liệu cảm biến…
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { marginBottom: spacing.md, flexGrow: 0 },
  chip: { marginRight: spacing.sm },
  deviceHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  deviceName: { color: palette.text, fontWeight: "600" },
  muted: { color: palette.muted },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginTop: spacing.md,
  },
  alertCard: { backgroundColor: "#FFFBEB", borderColor: "#FDE68A", marginTop: spacing.md },
  alertHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  alertTitle: { color: palette.warning, fontWeight: "600" },
  alertText: { color: palette.warning, marginTop: spacing.xs, lineHeight: 19 },
  chartNote: { color: palette.muted, marginTop: spacing.sm },
  motionRow: { flexDirection: "row", gap: 4, flexWrap: "wrap", alignItems: "center" },
  motionDot: { width: 12, height: 12, borderRadius: 6 },
  leftButton: { justifyContent: "flex-start", paddingHorizontal: 0, marginTop: spacing.xs },
  loading: { textAlign: "center", color: palette.muted, marginTop: spacing.md },
});

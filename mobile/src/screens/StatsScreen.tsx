import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Button, Text, TextInput } from "react-native-paper";

import { ApiError, api } from "../api/client";
import type { StudySession, StudyStats } from "../api/types";
import { PageHeader } from "../components/PageHeader";
import { Screen } from "../components/Screen";
import { Card, EmptyState, MiniBars, SectionTitle, StatTile, Tag } from "../components/ui";
import type { TabParamList } from "../navigation/types";
import { palette, spacing } from "../theme";
import {
  formatDuration,
  formatMinutes,
  formatShortDate,
  formatTime,
  weekdayLabel,
} from "../utils/format";

type Props = BottomTabScreenProps<TabParamList, "Stats">;

const STATUS_LABEL: Record<string, string> = {
  running: "Đang chạy",
  paused: "Tạm dừng",
  completed: "Hoàn thành",
  cancelled: "Đã hủy",
};

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Không tải được thống kê";
}

export default function StatsScreen(_props: Props) {
  const [stats, setStats] = useState<StudyStats | null>(null);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [goalInput, setGoalInput] = useState("120");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cache: avoid re-fetching if data is fresh (30s TTL)
  const lastLoadedAt = useRef<number>(0);
  const CACHE_TTL = 30_000;

  const load = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && now - lastLoadedAt.current < CACHE_TTL) return;
    setError(null);
    try {
      const [statsResult, sessionsResult] = await Promise.all([
        api.stats(),
        api.sessions(10),
      ]);
      setStats(statsResult);
      setSessions(sessionsResult);
      setGoalInput(String(statsResult.daily_goal_minutes));
      lastLoadedAt.current = Date.now();
    } catch (caught) {
      setError(messageOf(caught));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const saveGoal = async () => {
    const value = Number(goalInput);
    if (!Number.isFinite(value) || value < 5 || value > 1440) {
      setError("Mục tiêu phải từ 5 đến 1440 phút mỗi ngày.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.setGoal(Math.round(value));
      await load(true);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setSaving(false);
    }
  };

  const chartData = (stats?.daily ?? []).map((day) => ({
    label: weekdayLabel(day.date),
    value: formatMinutes(day.focused_seconds),
    highlight: day.date === stats?.daily[stats.daily.length - 1]?.date,
  }));

  return (
    <Screen>
      <PageHeader title="Thống kê học tập" subtitle="Theo dõi tiến độ theo ngày và tuần" />

      {error ? (
        <Card style={styles.errorCard}>
          <Text variant="bodySmall" style={styles.errorText}>
            {error}
          </Text>
        </Card>
      ) : null}

      <View style={styles.grid}>
        <StatTile
          icon="timer-outline"
          label="Hôm nay"
          value={formatMinutes(stats?.today_focused_seconds).toString()}
          unit="phút"
          tone="primary"
        />
        <StatTile
          icon="calendar-week"
          label="7 ngày qua"
          value={formatMinutes(stats?.week_focused_seconds).toString()}
          unit="phút"
          tone="info"
        />
        <StatTile
          icon="clock-check-outline"
          label="Tổng cộng"
          value={formatMinutes(stats?.total_focused_seconds).toString()}
          unit="phút"
          tone="accent"
        />
        <StatTile
          icon="target"
          label="Mục tiêu hôm nay"
          value={`${Math.round(stats?.goal_completion_rate ?? 0)}`}
          unit="%"
          tone={(stats?.goal_completion_rate ?? 0) >= 100 ? "primary" : "muted"}
        />
      </View>

      <SectionTitle
        title="7 ngày gần nhất"
        action={<Tag text={`${stats?.week_sessions ?? 0} phiên`} />}
      />
      <Card>
        <MiniBars data={chartData} height={130} emptyText="Chưa có phiên học nào" />
        <Text variant="labelSmall" style={styles.chartNote}>
          Đơn vị: phút tập trung mỗi ngày (múi giờ {stats?.timezone ?? "Asia/Ho_Chi_Minh"})
        </Text>
      </Card>

      <SectionTitle title="Mục tiêu mỗi ngày" />
      <Card>
        <View style={styles.goalRow}>
          <TextInput
            label="Số phút"
            value={goalInput}
            onChangeText={setGoalInput}
            keyboardType="number-pad"
            mode="outlined"
            style={styles.goalInput}
            outlineColor={palette.border}
            activeOutlineColor={palette.primary}
          />
          <Button
            mode="contained"
            onPress={() => void saveGoal()}
            loading={saving}
            disabled={saving}
            style={styles.goalButton}
          >
            Lưu
          </Button>
        </View>
        <Text variant="bodySmall" style={styles.muted}>
          Mục tiêu được dùng cho biểu đồ tiến độ và gợi ý của trợ lý.
        </Text>
      </Card>

      <SectionTitle title="Kế hoạch" />
      <Card style={styles.planSummary}>
        <View style={styles.planItem}>
          <MaterialCommunityIcons name="clipboard-list-outline" size={22} color={palette.primary} />
          <Text variant="headlineSmall" style={styles.planValue}>
            {stats?.plans_total ?? 0}
          </Text>
          <Text variant="labelSmall" style={styles.muted}>
            Tổng kế hoạch
          </Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.planItem}>
          <MaterialCommunityIcons name="check-decagram-outline" size={22} color={palette.success} />
          <Text variant="headlineSmall" style={styles.planValue}>
            {stats?.plans_completed ?? 0}
          </Text>
          <Text variant="labelSmall" style={styles.muted}>
            Hoàn thành
          </Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.planItem}>
          <MaterialCommunityIcons name="check-circle-outline" size={22} color={palette.info} />
          <Text variant="headlineSmall" style={styles.planValue}>
            {stats?.completed_sessions ?? 0}
          </Text>
          <Text variant="labelSmall" style={styles.muted}>
            Phiên xong
          </Text>
        </View>
      </Card>

      <SectionTitle title="Phiên học gần đây" />
      {sessions.length === 0 ? (
        <EmptyState
          icon="timer-off-outline"
          title="Chưa có phiên học"
          message="Bắt đầu phiên đầu tiên ở tab Tập trung để xem lịch sử tại đây."
        />
      ) : (
        <Card style={styles.historyCard}>
          {sessions.map((session, index) => (
            <View
              key={session.id}
              style={[styles.historyRow, index > 0 && styles.historyDivider]}
            >
              <View style={styles.historyIcon}>
                <MaterialCommunityIcons
                  name={session.status === "completed" ? "check" : "timer-outline"}
                  size={18}
                  color={session.status === "completed" ? palette.success : palette.muted}
                />
              </View>
              <View style={styles.historyInfo}>
                <Text variant="bodyMedium" style={styles.historyTitle}>
                  {formatShortDate(session.started_at)} · {formatTime(session.started_at)}
                </Text>
                <Text variant="bodySmall" style={styles.muted}>
                  {formatDuration(session.duration_seconds)} / {session.planned_minutes} phút
                </Text>
              </View>
              <Tag text={STATUS_LABEL[session.status] ?? session.status} />
            </View>
          ))}
        </Card>
      )}

      <Button
        mode="text"
        icon="refresh"
        onPress={() => void load()}
        style={styles.refresh}
      >
        Làm mới thống kê
      </Button>
    </Screen>
  );
}

const styles = StyleSheet.create({
  errorCard: { backgroundColor: "#FEF2F2", borderColor: "#FECACA", marginBottom: spacing.md },
  errorText: { color: palette.danger },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  chartNote: { color: palette.muted, marginTop: spacing.sm },
  goalRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  goalInput: { flex: 1, backgroundColor: palette.surface },
  goalButton: { borderRadius: 10, height: 48, justifyContent: "center" },
  muted: { color: palette.muted },
  planSummary: { flexDirection: "row", alignItems: "center" },
  planItem: { flex: 1, alignItems: "center", gap: 2 },
  planValue: { color: palette.text, fontWeight: "700" },
  divider: { width: 1, height: 50, backgroundColor: palette.border },
  historyCard: { paddingVertical: spacing.xs },
  historyRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
  historyDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border },
  historyIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: palette.background,
    alignItems: "center",
    justifyContent: "center",
  },
  historyInfo: { flex: 1 },
  historyTitle: { color: palette.text, fontWeight: "500" },
  refresh: { marginTop: spacing.lg },
});

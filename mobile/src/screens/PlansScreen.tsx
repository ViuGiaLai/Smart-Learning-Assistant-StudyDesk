import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  Button,
  Dialog,
  IconButton,
  Portal,
  SegmentedButtons,
  Text,
  TextInput,
} from "react-native-paper";

import { ApiError, api } from "../api/client";
import type { StudyPlan, StudyPlanStatus } from "../api/types";
import { PageHeader } from "../components/PageHeader";
import { Screen } from "../components/Screen";
import { Card, EmptyState, SectionTitle, Tag } from "../components/ui";
import type { RootStackParamList } from "../navigation/types";
import { palette, spacing } from "../theme";
import { confirmAction } from "../utils/dialog";
import { formatShortDate } from "../utils/format";

type Props = NativeStackScreenProps<RootStackParamList, "Plans">;

const STATUS_LABEL: Record<StudyPlanStatus, string> = {
  pending: "Chờ học",
  in_progress: "Đang học",
  completed: "Hoàn thành",
  cancelled: "Đã hủy",
};

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Không thực hiện được thao tác";
}

export default function PlansScreen({ navigation }: Props) {
  const [plans, setPlans] = useState<StudyPlan[]>([]);
  const [filter, setFilter] = useState<"all" | StudyPlanStatus>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState("25");
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cache: 15s TTL — plans can change quickly
  const lastLoadedAt = useRef<number>(0);
  const CACHE_TTL = 15_000;

  const load = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && now - lastLoadedAt.current < CACHE_TTL) return;
    try {
      const result = await api.listPlans();
      setPlans(result);
      setError(null);
      lastLoadedAt.current = Date.now();
    } catch (caught) {
      setError(messageOf(caught));
    }
  }, []);

  // Load when the screen gains focus (also after creating a session elsewhere).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const create = async () => {
    const value = Number(minutes);
    if (!title.trim()) {
      setError("Nhập tên kế hoạch.");
      return;
    }
    if (!Number.isFinite(value) || value < 1 || value > 240) {
      setError("Thời lượng phải từ 1 đến 240 phút.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.createPlan(title.trim(), Math.round(value));
      setTitle("");
      setMinutes("25");
      setDialogOpen(false);
      await load(true);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setSaving(false);
    }
  };

  const complete = async (plan: StudyPlan) => {
    try {
      await api.updatePlan(plan.id, { status: "completed" });
      await load(true);
    } catch (caught) {
      setError(messageOf(caught));
    }
  };

  const remove = (plan: StudyPlan) => {
    confirmAction({
      title: "Xóa kế hoạch?",
      message: plan.title,
      confirmLabel: "Xóa",
      destructive: true,
      onConfirm: () => {
        void (async () => {
          try {
            await api.deletePlan(plan.id);
            await load(true);
          } catch (caught) {
            setError(messageOf(caught));
          }
        })();
      },
    });
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await load(true);
    } finally {
      setRefreshing(false);
    }
  };

  const start = async (plan: StudyPlan) => {
    setStarting(plan.id);
    setError(null);
    try {
      await api.startSession(plan.planned_minutes, plan.id);
      navigation.navigate("Main", { screen: "Focus" });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        navigation.navigate("Main", { screen: "Focus" });
      } else {
        setError(messageOf(caught));
      }
    } finally {
      setStarting(null);
    }
  };

  const visible =
    filter === "all" ? plans : plans.filter((plan) => plan.status === filter);

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={() => void refresh()}
      header={
        <PageHeader
          title="Kế hoạch học tập"
          subtitle="Chia nhỏ mục tiêu thành từng phiên học"
          onBack={() => navigation.goBack()}
          right={
            <IconButton
              icon="plus"
              mode="contained"
              onPress={() => setDialogOpen(true)}
              accessibilityLabel="Thêm kế hoạch"
            />
          }
        />
      }
    >

      {error ? (
        <Card style={styles.errorCard}>
          <Text variant="bodySmall" style={styles.errorText}>
            {error}
          </Text>
        </Card>
      ) : null}

      <SegmentedButtons
        value={filter}
        onValueChange={(value) => setFilter(value as "all" | StudyPlanStatus)}
        buttons={[
          { value: "all", label: "Tất cả" },
          { value: "pending", label: "Chờ" },
          { value: "in_progress", label: "Đang học" },
          { value: "completed", label: "Xong" },
        ]}
        style={styles.segments}
      />

      <SectionTitle title={`${visible.length} kế hoạch`} />
      {visible.length === 0 ? (
        <EmptyState
          icon="clipboard-text-outline"
          title="Chưa có kế hoạch"
          message="Tạo kế hoạch nhỏ, ví dụ “Ôn 20 từ vựng” với thời lượng 25 phút."
          action={
            <Button mode="contained" icon="plus" onPress={() => setDialogOpen(true)}>
              Tạo kế hoạch
            </Button>
          }
        />
      ) : (
        visible.map((plan) => (
          <Card key={plan.id} style={styles.planCard}>
            <View style={styles.planHeader}>
              <View style={styles.planTitleWrap}>
                <Text variant="titleSmall" style={styles.planTitle}>
                  {plan.title}
                </Text>
                <Text variant="bodySmall" style={styles.muted}>
                  {plan.planned_minutes} phút · tạo {formatShortDate(plan.created_at)}
                </Text>
              </View>
              <Tag
                text={STATUS_LABEL[plan.status]}
                tone={plan.status === "completed" ? "primary" : "muted"}
              />
            </View>

            {plan.description ? (
              <Text variant="bodySmall" style={styles.description}>
                {plan.description}
              </Text>
            ) : null}

            <View style={styles.planActions}>
              <Button
                mode="contained-tonal"
                compact
                icon="play"
                onPress={() => void start(plan)}
                loading={starting === plan.id}
                disabled={Boolean(starting) || plan.status === "completed"}
              >
                Bắt đầu
              </Button>
              {plan.status !== "completed" ? (
                <Button
                  mode="text"
                  compact
                  icon="check"
                  onPress={() => void complete(plan)}
                >
                  Hoàn thành
                </Button>
              ) : null}
              <View style={styles.spacer} />
              <IconButton
                icon="trash-can-outline"
                size={20}
                onPress={() => remove(plan)}
                accessibilityLabel="Xóa kế hoạch"
              />
            </View>
          </Card>
        ))
      )}

      <Text variant="labelSmall" style={styles.footnote}>
        Mẹo: chọn thời lượng 25 phút cho một phiên Pomodoro, 50 phút cho bài tập dài.
      </Text>

      <Portal>
        <Dialog visible={dialogOpen} onDismiss={() => setDialogOpen(false)}>
          <Dialog.Title>Kế hoạch mới</Dialog.Title>
          <Dialog.Content style={styles.dialogContent}>
            <TextInput
              label="Tên kế hoạch"
              value={title}
              onChangeText={setTitle}
              mode="outlined"
              placeholder="Ví dụ: Ôn tập chương 3"
              outlineColor={palette.border}
              activeOutlineColor={palette.primary}
            />
            <TextInput
              label="Thời lượng (phút)"
              value={minutes}
              onChangeText={setMinutes}
              mode="outlined"
              keyboardType="number-pad"
              outlineColor={palette.border}
              activeOutlineColor={palette.primary}
            />
            <View style={styles.quickMinutes}>
              {[15, 25, 45, 50].map((value) => (
                <Button
                  key={value}
                  mode={minutes === String(value) ? "contained" : "outlined"}
                  compact
                  onPress={() => setMinutes(String(value))}
                >
                  {value} phút
                </Button>
              ))}
            </View>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDialogOpen(false)}>Hủy</Button>
            <Button onPress={() => void create()} loading={saving} disabled={saving}>
              Tạo
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  errorCard: { backgroundColor: "#FEF2F2", borderColor: "#FECACA", marginBottom: spacing.md },
  errorText: { color: palette.danger },
  segments: { marginBottom: spacing.sm },
  planCard: { marginBottom: spacing.md },
  planHeader: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  planTitleWrap: { flex: 1 },
  planTitle: { color: palette.text, fontWeight: "600" },
  muted: { color: palette.muted, marginTop: 2 },
  description: { color: palette.muted, marginTop: spacing.sm },
  planActions: { flexDirection: "row", alignItems: "center", marginTop: spacing.sm },
  spacer: { flex: 1 },
  footnote: { color: palette.muted, textAlign: "center", marginTop: spacing.lg },
  dialogContent: { gap: spacing.md },
  quickMinutes: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});

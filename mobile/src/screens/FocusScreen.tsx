import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Button, Chip, Dialog, Portal, ProgressBar, Text, TextInput } from "react-native-paper";

import { ApiError, api } from "../api/client";
import type { StudySession } from "../api/types";
import { PageHeader } from "../components/PageHeader";
import { Screen } from "../components/Screen";
import { Card, SectionTitle, Tag } from "../components/ui";
import type { TabParamList } from "../navigation/types";
import { palette, spacing } from "../theme";
import { confirmAction, showMessage } from "../utils/dialog";
import { formatClock, formatDuration, formatTime } from "../utils/format";

type Props = BottomTabScreenProps<TabParamList, "Focus">;

const DURATIONS = [15, 25, 45, 50];
const MIN_MINUTES = 1;
const MAX_MINUTES = 240;
const BREAK_SECONDS = 5 * 60;

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Không thực hiện được thao tác";
}

export default function FocusScreen(_props: Props) {
  const [session, setSession] = useState<StudySession | null>(null);
  const [selectedMinutes, setSelectedMinutes] = useState(25);
  const [customMinutes, setCustomMinutes] = useState<number | null>(null);
  const [showCustom, setShowCustom] = useState(false);
  const [customInput, setCustomInput] = useState("30");
  const [customError, setCustomError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(25 * 60);
  const [total, setTotal] = useState(25 * 60);
  const [breakRemaining, setBreakRemaining] = useState(BREAK_SECONDS);
  const [mode, setMode] = useState<"focus" | "break">("focus");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoDone = useRef(false);

  const adopt = useCallback((active: StudySession) => {
    const planned = active.planned_minutes * 60;
    setSession(active);
    setSelectedMinutes(active.planned_minutes);
    setCustomMinutes(DURATIONS.includes(active.planned_minutes) ? null : active.planned_minutes);
    setTotal(planned);
    setRemaining(Math.max(0, planned - active.duration_seconds));
    setMode("focus");
    setError(null);
    autoDone.current = false;
  }, []);

  const loadActive = useCallback(async () => {
    try {
      const active = await api.activeSession();
      if (active) adopt(active);
    } catch {
      // Offline: keep whatever is on screen.
    }
  }, [adopt]);

  useFocusEffect(
    useCallback(() => {
      void loadActive();
    }, [loadActive]),
  );

  useEffect(() => {
    if (mode !== "focus" || session?.status !== "running") return;
    const timer = setInterval(() => {
      setRemaining((value) => Math.max(0, value - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [mode, session?.status]);

  useEffect(() => {
    if (mode !== "break") return;
    const timer = setInterval(() => {
      setBreakRemaining((value) => Math.max(0, value - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [mode]);

  useEffect(() => {
    if (mode === "break" && breakRemaining === 0) {
      setBreakRemaining(BREAK_SECONDS);
      showMessage("Hết giờ nghỉ", "Quay lại bàn học khi bạn đã sẵn sàng nhé!");
    }
  }, [mode, breakRemaining]);

  const finish = useCallback(
    async (cancelled: boolean, auto: boolean) => {
      if (!session) return;
      setBusy(true);
      setError(null);
      try {
        const done = await api.finishSession(session.id, cancelled);
        setSession(null);
        setRemaining(selectedMinutes * 60);
        setTotal(selectedMinutes * 60);
        autoDone.current = false;
        if (auto && !cancelled) {
          setMode("break");
          setBreakRemaining(BREAK_SECONDS);
          showMessage(
            "Hoàn thành phiên học!",
            `Bạn đã tập trung ${formatDuration(done.duration_seconds)}. Nghỉ 5 phút trước khi tiếp tục.`,
          );
        } else if (cancelled) {
          setMode("focus");
        } else {
          setMode("focus");
          showMessage("Đã kết thúc", `Thời gian tập trung: ${formatDuration(done.duration_seconds)}.`);
        }
      } catch (caught) {
        setError(messageOf(caught));
      } finally {
        setBusy(false);
      }
    },
    [selectedMinutes, session],
  );

  useEffect(() => {
    if (
      mode === "focus" &&
      session?.status === "running" &&
      remaining === 0 &&
      !autoDone.current
    ) {
      autoDone.current = true;
      void finish(false, true);
    }
  }, [finish, mode, remaining, session?.status]);

  const pickMinutes = (minutes: number) => {
    setSelectedMinutes(minutes);
    setCustomMinutes(null);
    setRemaining(minutes * 60);
    setTotal(minutes * 60);
  };

  const openCustom = () => {
    setCustomInput(String(selectedMinutes));
    setCustomError(null);
    setShowCustom(true);
  };

  const nudgeCustom = (delta: number) => {
    const parsed = Number.parseInt(customInput.replace(/[^0-9]/g, ""), 10);
    const base = Number.isFinite(parsed) ? parsed : 0;
    const next = Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, base + delta));
    setCustomInput(String(next));
    setCustomError(null);
  };

  const applyCustom = () => {
    const parsed = Number.parseInt(customInput.replace(/[^0-9]/g, ""), 10);
    if (!Number.isFinite(parsed) || parsed < MIN_MINUTES || parsed > MAX_MINUTES) {
      setCustomError(`Nhập số phút từ ${MIN_MINUTES} đến ${MAX_MINUTES}.`);
      return;
    }
    setSelectedMinutes(parsed);
    setCustomMinutes(parsed);
    setRemaining(parsed * 60);
    setTotal(parsed * 60);
    setShowCustom(false);
  };

  const start = async () => {    setBusy(true);
    setError(null);
    try {
      const created = await api.startSession(selectedMinutes);
      adopt(created);
      setRemaining(selectedMinutes * 60);
      setTotal(selectedMinutes * 60);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        await loadActive();
      }
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  const pause = async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.pauseSession(session.id);
      setSession(updated);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  const resume = async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.resumeSession(session.id);
      setSession(updated);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  const currentSeconds = mode === "focus" ? remaining : breakRemaining;
  const currentTotal = mode === "focus" ? total : BREAK_SECONDS;
  const progress = currentTotal > 0 ? 1 - currentSeconds / currentTotal : 0;
  const running = session?.status === "running";

  return (
    <Screen
      header={
        <PageHeader
          title="Tập trung"
          subtitle="Pomodoro 25/5, thời gian do máy chủ xác nhận"
        />
      }
    >

      <View style={styles.modeRow}>
        <Button
          mode={mode === "focus" ? "contained" : "outlined"}
          compact
          icon="book-open-variant"
          onPress={() => setMode("focus")}
          disabled={session !== null}
          style={styles.modeButton}
        >
          Tập trung
        </Button>
        <Button
          mode={mode === "break" ? "contained" : "outlined"}
          compact
          icon="coffee-outline"
          onPress={() => setMode("break")}
          disabled={session !== null}
          style={styles.modeButton}
        >
          Nghỉ 5 phút
        </Button>
      </View>

      <View style={styles.timerWrap}>
        <View style={[styles.ring, mode === "break" && styles.ringBreak]}>
          <Text variant="labelLarge" style={styles.ringLabel}>
            {mode === "focus" ? "THỜI GIAN TẬP TRUNG" : "THỜI GIAN NGHỈ"}
          </Text>
          <Text variant="displayLarge" style={styles.clock}>
            {formatClock(currentSeconds)}
          </Text>
          <Text variant="bodySmall" style={styles.ringHint}>
            {mode === "break"
              ? "Đứng dậy, giãn cơ và uống nước"
              : running
                ? "Đang tính giờ trên máy chủ"
                : session?.status === "paused"
                  ? "Đã tạm dừng"
                  : `${selectedMinutes} phút · sẵn sàng bắt đầu`}
          </Text>
        </View>
        <ProgressBar
          progress={Math.min(1, Math.max(0, progress))}
          color={mode === "break" ? palette.accent : palette.primary}
          style={styles.progress}
        />
      </View>

      {error ? (
        <Card style={styles.errorCard}>
          <Text variant="bodySmall" style={styles.errorText}>
            {error}
          </Text>
        </Card>
      ) : null}

      {!session ? (
        <>
          <SectionTitle title="Chọn thời lượng tập trung" />
          <View style={styles.chips}>
            {DURATIONS.map((minutes) => (
              <Chip
                key={minutes}
                selected={customMinutes === null && selectedMinutes === minutes}
                onPress={() => pickMinutes(minutes)}
                style={styles.chip}
              >
                {minutes} phút
              </Chip>
            ))}
            <Chip
              icon={customMinutes === null ? "plus" : "pencil-outline"}
              selected={customMinutes !== null}
              onPress={openCustom}
              style={styles.chip}
            >
              {customMinutes === null ? "Tùy chỉnh" : `${customMinutes} phút`}
            </Chip>
          </View>
          <Text variant="bodySmall" style={styles.durationHint}>
            Chọn nhanh 15, 25, 45 hoặc 50 phút — hoặc tự nhập từ {MIN_MINUTES} đến {MAX_MINUTES} phút.
          </Text>
          <Button
            mode="contained"
            icon="play"
            onPress={() => void start()}
            loading={busy}
            disabled={busy || mode === "break"}
            style={styles.primaryButton}
            contentStyle={styles.primaryContent}
          >
            Bắt đầu phiên học
          </Button>
          {mode === "break" ? (
            <Text variant="bodySmall" style={styles.centerHint}>
              Chuyển về tab Tập trung để bắt đầu phiên học mới.
            </Text>
          ) : null}
        </>
      ) : (
        <>
          <Card style={styles.sessionCard}>
            <View style={styles.sessionHeader}>
              <Text variant="titleSmall" style={styles.sessionTitle}>
                Phiên học hiện tại
              </Text>
              <Tag
                text={
                  session.status === "running" ? "Đang chạy" : "Tạm dừng"
                }
                tone="primary"
              />
            </View>
            <View style={styles.sessionMeta}>
              <View>
                <Text variant="labelSmall" style={styles.muted}>
                  Bắt đầu
                </Text>
                <Text variant="bodyMedium" style={styles.sessionValue}>
                  {formatTime(session.started_at)}
                </Text>
              </View>
              <View>
                <Text variant="labelSmall" style={styles.muted}>
                  Mục tiêu
                </Text>
                <Text variant="bodyMedium" style={styles.sessionValue}>
                  {session.planned_minutes} phút
                </Text>
              </View>
              <View>
                <Text variant="labelSmall" style={styles.muted}>
                  Đã học
                </Text>
                <Text variant="bodyMedium" style={styles.sessionValue}>
                  {formatDuration(
                    session.planned_minutes * 60 - remaining > 0
                      ? session.planned_minutes * 60 - remaining
                      : 0,
                  )}
                </Text>
              </View>
            </View>
          </Card>

          <View style={styles.actions}>
            {session.status === "running" ? (
              <Button
                mode="contained-tonal"
                icon="pause"
                onPress={() => void pause()}
                loading={busy}
                disabled={busy}
                style={styles.actionButton}
              >
                Tạm dừng
              </Button>
            ) : (
              <Button
                mode="contained"
                icon="play"
                onPress={() => void resume()}
                loading={busy}
                disabled={busy}
                style={styles.actionButton}
              >
                Tiếp tục
              </Button>
            )}
            <Button
              mode="outlined"
              icon="stop"
              onPress={() =>
                confirmAction({
                  title: "Kết thúc phiên học?",
                  message: "Thời gian đã học vẫn được lưu lại.",
                  confirmLabel: "Kết thúc",
                  onConfirm: () => void finish(false, false),
                })
              }
              disabled={busy}
              style={styles.actionButton}
            >
              Kết thúc
            </Button>
          </View>
          <Button
            mode="text"
            textColor={palette.danger}
            onPress={() =>
              confirmAction({
                title: "Hủy phiên học?",
                message: "Phiên học sẽ được đánh dấu là đã hủy.",
                confirmLabel: "Hủy phiên",
                cancelLabel: "Không",
                destructive: true,
                onConfirm: () => void finish(true, false),
              })
            }
            disabled={busy}
          >
            Hủy phiên học
          </Button>
        </>
      )}

      <Portal>
        <Dialog visible={showCustom} onDismiss={() => setShowCustom(false)} style={styles.dialog}>
          <Dialog.Title>Thời lượng tùy chỉnh</Dialog.Title>
          <Dialog.Content style={styles.dialogContent}>
            <Text variant="bodySmall" style={styles.muted}>
              Nhập số phút bạn muốn tập trung, từ {MIN_MINUTES} đến {MAX_MINUTES}. Ví dụ 30, 60 hoặc 90.
            </Text>
            <View style={styles.stepperRow}>
              <Button
                mode="outlined"
                compact
                icon="minus"
                onPress={() => nudgeCustom(-5)}
                style={styles.stepButton}
              >
                5
              </Button>
              <TextInput
                value={customInput}
                onChangeText={(value) => {
                  setCustomInput(value.replace(/[^0-9]/g, ""));
                  setCustomError(null);
                }}
                keyboardType="number-pad"
                mode="outlined"
                dense
                style={styles.stepInput}
                outlineColor={customError ? palette.danger : palette.border}
                activeOutlineColor={customError ? palette.danger : palette.primary}
              />
              <Button
                mode="outlined"
                compact
                icon="plus"
                onPress={() => nudgeCustom(5)}
                style={styles.stepButton}
              >
                5
              </Button>
            </View>
            <View style={styles.quickRow}>
              {[5, 10, 30, 60, 90].map((minutes) => (
                <Chip key={minutes} compact onPress={() => setCustomInput(String(minutes))}>
                  {minutes} phút
                </Chip>
              ))}
            </View>
            {customError ? (
              <Text variant="bodySmall" style={styles.dialogError}>
                {customError}
              </Text>
            ) : (
              <Text variant="bodySmall" style={styles.muted}>
                Phiên học sẽ kết thúc sau {customInput || "?"} phút.
              </Text>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setShowCustom(false)}>Hủy</Button>
            <Button mode="contained" onPress={applyCustom}>
              Áp dụng
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <SectionTitle title="Vì sao thời gian do máy chủ tính?" />
      <Card>
        <View style={styles.noteRow}>
          <MaterialCommunityIcons name="shield-check-outline" size={20} color={palette.primary} />
          <Text variant="bodySmall" style={styles.noteText}>
            Bộ đếm trên điện thoại có thể bị tắt hoặc đổi giờ. Backend lưu thời điểm bắt đầu,
            tạm dừng và kết thúc để thống kê chính xác hơn.
          </Text>
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  modeRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  modeButton: { flex: 1, borderRadius: 10 },
  timerWrap: { alignItems: "center", marginVertical: spacing.md },
  ring: {
    width: 250,
    height: 250,
    borderRadius: 125,
    borderWidth: 10,
    borderColor: palette.primarySoft,
    backgroundColor: palette.surface,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  ringBreak: { borderColor: palette.accentSoft },
  ringLabel: { color: palette.muted, letterSpacing: 0.6, fontSize: 10 },
  clock: { color: palette.text, fontWeight: "700", marginVertical: spacing.xs },
  ringHint: { color: palette.muted, textAlign: "center" },
  progress: { width: "82%", height: 8, borderRadius: 4, marginTop: spacing.lg },
  errorCard: { backgroundColor: "#FEF2F2", borderColor: "#FECACA", marginBottom: spacing.md },
  errorText: { color: palette.danger },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { marginBottom: spacing.xs },
  durationHint: { color: palette.muted, marginTop: spacing.xs, lineHeight: 18 },
  dialog: { borderRadius: 16 },
  dialogContent: { gap: spacing.sm },
  stepperRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stepButton: { borderRadius: 10 },
  stepInput: { flex: 1, backgroundColor: palette.surface, textAlign: "center" },
  quickRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  dialogError: { color: palette.danger },
  primaryButton: { borderRadius: 12, marginTop: spacing.md },
  primaryContent: { paddingVertical: 6 },
  centerHint: { textAlign: "center", color: palette.muted, marginTop: spacing.sm },
  sessionCard: { marginTop: spacing.md },
  sessionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sessionTitle: { color: palette.text, fontWeight: "600" },
  sessionMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.md,
  },
  muted: { color: palette.muted },
  sessionValue: { color: palette.text, fontWeight: "600", marginTop: 2 },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  actionButton: { flex: 1, borderRadius: 10 },
  noteRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  noteText: { color: palette.muted, flex: 1, lineHeight: 19 },
});

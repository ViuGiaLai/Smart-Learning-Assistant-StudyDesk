import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import {
  Button,
  Dialog,
  Portal,
  Snackbar,
  Switch,
  Text,
  TextInput,
} from "react-native-paper";

import { ApiError, api } from "../api/client";
import type { Device, DeviceSettings, RegisteredDevice } from "../api/types";
import { PageHeader } from "../components/PageHeader";
import { Screen } from "../components/Screen";
import { Card, KeyValueRow, SectionTitle, StatusPill } from "../components/ui";
import type { RootStackParamList } from "../navigation/types";
import { useDeviceStore } from "../store/deviceStore";
import { palette, spacing } from "../theme";
import { confirmAction } from "../utils/dialog";
import { relativeTime } from "../utils/format";

type Props = NativeStackScreenProps<RootStackParamList, "Device">;

interface SettingsForm {
  temperature_min: string;
  temperature_max: string;
  humidity_min: string;
  humidity_max: string;
  light_min_lux: string;
  no_motion_minutes: string;
  sample_interval_seconds: string;
  collection_enabled: boolean;
  auto_control: boolean;
}

function toForm(settings: DeviceSettings): SettingsForm {
  return {
    temperature_min: String(settings.temperature_min),
    temperature_max: String(settings.temperature_max),
    humidity_min: String(settings.humidity_min),
    humidity_max: String(settings.humidity_max),
    light_min_lux: String(settings.light_min_lux),
    no_motion_minutes: String(settings.no_motion_minutes),
    sample_interval_seconds: String(settings.sample_interval_seconds),
    collection_enabled: settings.collection_enabled,
    auto_control: settings.auto_control,
  };
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Thao tác thất bại";
}

function NumberField({
  label,
  value,
  onChangeText,
  suffix,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  suffix?: string;
}) {
  return (
    <View style={styles.field}>
      <TextInput
        label={label}
        value={value}
        onChangeText={onChangeText}
        keyboardType="decimal-pad"
        mode="outlined"
        dense
        style={styles.fieldInput}
        outlineColor={palette.border}
        activeOutlineColor={palette.primary}
      />
      {suffix ? (
        <Text variant="labelSmall" style={styles.suffix}>
          {suffix}
        </Text>
      ) : null}
    </View>
  );
}

export default function DeviceScreen({ navigation, route }: Props) {
  const devices = useDeviceStore((state) => state.devices);
  const selectedId = useDeviceStore((state) => state.selectedId);
  const select = useDeviceStore((state) => state.select);
  const refresh = useDeviceStore((state) => state.refresh);
  const registerDevice = useDeviceStore((state) => state.register);

  const selected = devices.find((device) => device.id === selectedId) ?? null;

  const [showRegister, setShowRegister] = useState(Boolean(route.params?.register));
  const [code, setCode] = useState("STUDY_DESK_001");
  const [name, setName] = useState("Bàn học");
  const [registered, setRegistered] = useState<RegisteredDevice | null>(null);
  const [form, setForm] = useState<SettingsForm | null>(
    selected ? toForm(selected.settings) : null,
  );
  const [savingSettings, setSavingSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (selected) setForm(toForm(selected.settings));
  }, [selected]);

  const doRegister = async () => {
    if (!code.trim()) {
      setMessage("Nhập mã thiết bị, ví dụ STUDY_DESK_001.");
      return;
    }
    setBusy(true);
    try {
      const device = await registerDevice(code, name);
      setRegistered(device);
      setShowRegister(false);
      setMessage("Đã thêm thiết bị. Hãy nạp mã thiết bị vào firmware ESP32.");
    } catch (error) {
      setMessage(messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async () => {
    if (!selected || !form) return;
    const parsed: Partial<DeviceSettings> = {
      temperature_min: Number(form.temperature_min),
      temperature_max: Number(form.temperature_max),
      humidity_min: Number(form.humidity_min),
      humidity_max: Number(form.humidity_max),
      light_min_lux: Number(form.light_min_lux),
      no_motion_minutes: Number(form.no_motion_minutes),
      sample_interval_seconds: Number(form.sample_interval_seconds),
      collection_enabled: form.collection_enabled,
      auto_control: form.auto_control,
    };
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) {
        setMessage(`Giá trị ${key} không hợp lệ.`);
        return;
      }
    }
    if (
      parsed.temperature_min != null &&
      parsed.temperature_max != null &&
      parsed.temperature_min >= parsed.temperature_max
    ) {
      setMessage("Nhiệt độ tối thiểu phải nhỏ hơn tối đa.");
      return;
    }
    setSavingSettings(true);
    try {
      await api.updateDevice(selected.id, { settings: parsed });
      await refresh();
      setMessage("Đã lưu ngưỡng cảnh báo.");
    } catch (error) {
      setMessage(messageOf(error));
    } finally {
      setSavingSettings(false);
    }
  };

  const sendCommand = async (
    action: "set_led" | "set_buzzer" | "ping",
    value?: boolean,
  ) => {
    if (!selected) return;
    try {
      const result = await api.sendCommand(selected.id, action, value);
      setMessage(
        result.delivered
          ? "Đã gửi lệnh tới thiết bị."
          : "MQTT chưa kết nối — lệnh chưa được gửi tới thiết bị.",
      );
    } catch (error) {
      setMessage(messageOf(error));
    }
  };

  const beep = async () => {
    await sendCommand("set_buzzer", true);
    setTimeout(() => {
      void sendCommand("set_buzzer", false);
    }, 800);
  };

  const removeDevice = (device: Device) => {
    confirmAction({
      title: "Xóa thiết bị?",
      message: `Dữ liệu cảm biến của ${device.name} sẽ bị xóa khỏi hệ thống.`,
      confirmLabel: "Xóa",
      destructive: true,
      onConfirm: () => {
        void (async () => {
          try {
            await api.deleteDevice(device.id);
            await refresh();
            setMessage("Đã xóa thiết bị.");
          } catch (error) {
            setMessage(messageOf(error));
          }
        })();
      },
    });
  };

  return (
    <Screen
      header={
        <PageHeader
          title="Thiết bị IoT"
          subtitle="Quản lý ESP32 và ngưỡng cảnh báo"
          onBack={() => navigation.goBack()}
          right={
            <Button compact icon="plus" onPress={() => setShowRegister((value) => !value)}>
              Thêm
            </Button>
          }
        />
      }
    >

      {showRegister ? (
        <Card style={styles.registerCard}>
          <Text variant="titleSmall" style={styles.cardTitle}>
            Đăng ký thiết bị mới
          </Text>
          <Text variant="bodySmall" style={styles.muted}>
            Mã thiết bị phải trùng với DEVICE_CODE trong firmware ESP32.
          </Text>
          <TextInput
            label="Mã thiết bị"
            value={code}
            onChangeText={setCode}
            mode="outlined"
            autoCapitalize="characters"
            style={styles.input}
            outlineColor={palette.border}
            activeOutlineColor={palette.primary}
          />
          <TextInput
            label="Tên hiển thị"
            value={name}
            onChangeText={setName}
            mode="outlined"
            style={styles.input}
            outlineColor={palette.border}
            activeOutlineColor={palette.primary}
          />
          <Button
            mode="contained"
            icon="link-plus"
            onPress={() => void doRegister()}
            loading={busy}
            disabled={busy}
            style={styles.button}
          >
            Đăng ký thiết bị
          </Button>
        </Card>
      ) : null}

      {devices.length === 0 ? (
        <Card style={styles.emptyCard}>
          <MaterialCommunityIcons name="chip" size={36} color={palette.muted} />
          <Text variant="titleSmall" style={styles.cardTitle}>
            Chưa có thiết bị
          </Text>
          <Text variant="bodySmall" style={styles.muted}>
            Nạp firmware Wokwi hoặc ESP32 thật, sau đó đăng ký mã thiết bị tại đây.
          </Text>
        </Card>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
            {devices.map((device) => (
              <Button
                key={device.id}
                mode={device.id === selectedId ? "contained" : "outlined"}
                compact
                onPress={() => select(device.id)}
                style={styles.chip}
              >
                {device.name}
              </Button>
            ))}
          </ScrollView>

          {selected ? (
            <>
              <Card style={styles.card}>
                <View style={styles.deviceHeader}>
                  <View>
                    <Text variant="titleSmall" style={styles.cardTitle}>
                      {selected.name}
                    </Text>
                    <Text variant="bodySmall" style={styles.muted}>
                      {selected.device_code} · cập nhật {relativeTime(selected.last_seen_at)}
                    </Text>
                  </View>
                  <StatusPill online={selected.status === "online"} />
                </View>
                <View style={styles.commandRow}>
                  <Button
                    mode="contained-tonal"
                    icon="lightbulb-on-outline"
                    compact
                    onPress={() => void sendCommand("set_led", true)}
                  >
                    Bật LED
                  </Button>
                  <Button
                    mode="outlined"
                    icon="lightbulb-off-outline"
                    compact
                    onPress={() => void sendCommand("set_led", false)}
                  >
                    Tắt LED
                  </Button>
                  <Button mode="outlined" icon="bell-ring-outline" compact onPress={() => void beep()}>
                    Còi
                  </Button>
                </View>
                <Button
                  mode="text"
                  icon="access-point-check"
                  compact
                  onPress={() => void sendCommand("ping")}
                >
                  Kiểm tra kết nối
                </Button>
              </Card>

              <SectionTitle title="Ngưỡng cảnh báo & quyền riêng tư" />
              {form ? (
                <Card>
                  <View style={styles.fieldGrid}>
                    <NumberField
                      label="Nhiệt độ tối thiểu"
                      value={form.temperature_min}
                      onChangeText={(value) =>
                        setForm((current) => (current ? { ...current, temperature_min: value } : current))
                      }
                      suffix="°C"
                    />
                    <NumberField
                      label="Nhiệt độ tối đa"
                      value={form.temperature_max}
                      onChangeText={(value) =>
                        setForm((current) => (current ? { ...current, temperature_max: value } : current))
                      }
                      suffix="°C"
                    />
                    <NumberField
                      label="Độ ẩm tối thiểu"
                      value={form.humidity_min}
                      onChangeText={(value) =>
                        setForm((current) => (current ? { ...current, humidity_min: value } : current))
                      }
                      suffix="%"
                    />
                    <NumberField
                      label="Độ ẩm tối đa"
                      value={form.humidity_max}
                      onChangeText={(value) =>
                        setForm((current) => (current ? { ...current, humidity_max: value } : current))
                      }
                      suffix="%"
                    />
                    <NumberField
                      label="Ánh sáng tối thiểu"
                      value={form.light_min_lux}
                      onChangeText={(value) =>
                        setForm((current) => (current ? { ...current, light_min_lux: value } : current))
                      }
                      suffix="lux"
                    />
                    <NumberField
                      label="Không chuyển động"
                      value={form.no_motion_minutes}
                      onChangeText={(value) =>
                        setForm((current) => (current ? { ...current, no_motion_minutes: value } : current))
                      }
                      suffix="phút"
                    />
                    <NumberField
                      label="Chu kỳ gửi dữ liệu"
                      value={form.sample_interval_seconds}
                      onChangeText={(value) =>
                        setForm((current) =>
                          current ? { ...current, sample_interval_seconds: value } : current,
                        )
                      }
                      suffix="giây"
                    />
                  </View>

                  <View style={styles.switchRow}>
                    <View style={styles.switchLabel}>
                      <Text variant="bodyMedium" style={styles.switchTitle}>
                        Thu thập dữ liệu cảm biến
                      </Text>
                      <Text variant="bodySmall" style={styles.muted}>
                        Tắt để ngừng lưu lịch sử (thiết bị vẫn báo online).
                      </Text>
                    </View>
                    <Switch
                      value={form.collection_enabled}
                      onValueChange={(value) =>
                        setForm((current) =>
                          current ? { ...current, collection_enabled: value } : current,
                        )
                      }
                      color={palette.primary}
                    />
                  </View>

                  <View style={styles.switchRow}>
                    <View style={styles.switchLabel}>
                      <Text variant="bodyMedium" style={styles.switchTitle}>
                        Tự động bật LED khi vượt ngưỡng
                      </Text>
                      <Text variant="bodySmall" style={styles.muted}>
                        Backend gửi lệnh MQTT khi phát hiện bất thường.
                      </Text>
                    </View>
                    <Switch
                      value={form.auto_control}
                      onValueChange={(value) =>
                        setForm((current) => (current ? { ...current, auto_control: value } : current))
                      }
                      color={palette.primary}
                    />
                  </View>

                  <Button
                    mode="contained"
                    icon="content-save-outline"
                    onPress={() => void saveSettings()}
                    loading={savingSettings}
                    disabled={savingSettings}
                    style={styles.button}
                  >
                    Lưu cấu hình
                  </Button>
                </Card>
              ) : null}

              <SectionTitle title="Thông tin kết nối" />
              <Card>
                <KeyValueRow icon="identifier" label="Mã thiết bị" value={selected.device_code} />
                <KeyValueRow
                  icon="access-point"
                  label="Trạng thái"
                  value={selected.status === "online" ? "Online" : "Offline"}
                />
                <KeyValueRow
                  icon="clock-outline"
                  label="Lần cuối gửi"
                  value={relativeTime(selected.last_seen_at)}
                />
                <KeyValueRow
                  icon="send-outline"
                  label="Chu kỳ mẫu"
                  value={`${selected.settings.sample_interval_seconds} giây`}
                />
              </Card>

              <Button
                mode="outlined"
                textColor={palette.danger}
                icon="trash-can-outline"
                onPress={() => removeDevice(selected)}
                style={styles.deleteButton}
              >
                Xóa thiết bị này
              </Button>
            </>
          ) : null}
        </>
      )}

      <Portal>
        <Dialog visible={registered !== null} onDismiss={() => setRegistered(null)}>
          <Dialog.Title>Thiết bị đã đăng ký</Dialog.Title>
          <Dialog.Content style={styles.dialogContent}>
            <Text variant="bodySmall" style={styles.muted}>
              Lưu lại khóa thiết bị — máy chủ chỉ lưu bản băm và không hiển thị lại.
            </Text>
            <Text selectable variant="bodyMedium" style={styles.keyText}>
              {registered?.device_key}
            </Text>
            <Text variant="labelSmall" style={styles.muted}>
              MQTT telemetry: {registered?.mqtt_topics.telemetry}
            </Text>
            <Text variant="labelSmall" style={styles.muted}>
              HTTP: POST /api/iot/telemetry với header X-Device-Code và X-Device-Key
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setRegistered(null)}>Đã hiểu</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar
        visible={message !== null}
        onDismiss={() => setMessage(null)}
        duration={4000}
        action={{ label: "Đóng", onPress: () => setMessage(null) }}
      >
        {message ?? ""}
      </Snackbar>
    </Screen>
  );
}

const styles = StyleSheet.create({
  registerCard: { marginBottom: spacing.md },
  card: { marginBottom: spacing.md },
  emptyCard: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xl },
  cardTitle: { color: palette.text, fontWeight: "600" },
  muted: { color: palette.muted, marginTop: 2 },
  input: { marginTop: spacing.sm, backgroundColor: palette.surface },
  button: { marginTop: spacing.md, borderRadius: 10 },
  chips: { flexGrow: 0, marginBottom: spacing.md },
  chip: { marginRight: spacing.sm },
  deviceHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  commandRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  fieldGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  field: { width: "48%", marginBottom: spacing.sm },
  fieldInput: { backgroundColor: palette.surface },
  suffix: { color: palette.muted, marginTop: 2, textAlign: "right" },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.border,
  },
  switchLabel: { flex: 1 },
  switchTitle: { color: palette.text, fontWeight: "500" },
  deleteButton: { marginTop: spacing.lg, borderColor: "#FECACA" },
  dialogContent: { gap: spacing.sm },
  keyText: {
    fontFamily: "monospace",
    backgroundColor: palette.background,
    padding: spacing.md,
    borderRadius: 8,
    color: palette.text,
  },
});

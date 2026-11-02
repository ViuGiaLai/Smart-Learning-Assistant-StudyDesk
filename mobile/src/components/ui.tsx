import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Surface, Text } from "react-native-paper";

import { palette, spacing } from "../theme";

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

export function SectionTitle({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.sectionTitle}>
      <Text variant="titleMedium" style={styles.sectionTitleText}>
        {title}
      </Text>
      {action}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: object }) {
  return (
    <Surface style={[styles.card, style]} elevation={0}>
      {children}
    </Surface>
  );
}

export function StatTile({
  icon,
  label,
  value,
  unit,
  tone = "primary",
}: {
  icon: IconName;
  label: string;
  value: string;
  unit?: string;
  tone?: "primary" | "accent" | "info" | "danger" | "muted";
}) {
  const tones = {
    primary: { bg: palette.primarySoft, fg: palette.primaryDark },
    accent: { bg: palette.accentSoft, fg: palette.warning },
    info: { bg: "#DBEAFE", fg: palette.info },
    danger: { bg: "#FEE2E2", fg: palette.danger },
    muted: { bg: "#ECF0EF", fg: palette.muted },
  }[tone];

  return (
    <View style={styles.tile}>
      <View style={[styles.tileIcon, { backgroundColor: tones.bg }]}>
        <MaterialCommunityIcons name={icon} size={18} color={tones.fg} />
      </View>
      <Text variant="labelMedium" style={styles.tileLabel} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.tileValueRow}>
        <Text variant="titleLarge" style={styles.tileValue}>
          {value}
        </Text>
        {unit ? (
          <Text variant="bodySmall" style={styles.tileUnit}>
            {unit}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function StatusPill({
  online,
  label,
}: {
  online: boolean;
  label?: string;
}) {
  const color = online ? palette.success : palette.danger;
  return (
    <View style={[styles.pill, { backgroundColor: online ? "#DCFCE7" : "#FEE2E2" }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text variant="labelMedium" style={{ color }}>
        {label ?? (online ? "Online" : "Offline")}
      </Text>
    </View>
  );
}

export function Tag({ text, tone = "muted" }: { text: string; tone?: "primary" | "muted" }) {
  const primary = tone === "primary";
  return (
    <View
      style={[
        styles.tag,
        { backgroundColor: primary ? palette.primarySoft : "#ECF0EF" },
      ]}
    >
      <Text
        variant="labelSmall"
        style={{ color: primary ? palette.primaryDark : palette.muted }}
      >
        {text}
      </Text>
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon: IconName;
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <MaterialCommunityIcons name={icon} size={40} color={palette.muted} />
      <Text variant="titleMedium" style={styles.emptyTitle}>
        {title}
      </Text>
      <Text variant="bodyMedium" style={styles.emptyMessage}>
        {message}
      </Text>
      {action}
    </View>
  );
}

export function MiniBars({
  data,
  color = palette.primary,
  height = 110,
  emptyText = "Chưa có dữ liệu",
}: {
  data: { label: string; value: number; highlight?: boolean }[];
  color?: string;
  height?: number;
  emptyText?: string;
}) {
  const max = Math.max(1, ...data.map((item) => item.value));
  if (data.length === 0) {
    return <Text style={styles.chartEmpty}>{emptyText}</Text>;
  }
  return (
    <View style={[styles.chart, { height: height + 22 }]}>
      {data.map((item, index) => {
        const ratio = item.value / max;
        return (
          <View key={`${item.label}-${index}`} style={styles.barColumn}>
            <View style={[styles.barTrack, { height }]}>
              <View
                style={[
                  styles.barFill,
                  {
                    height: Math.max(3, Math.round(ratio * height)),
                    backgroundColor: item.highlight ? palette.accent : color,
                  },
                ]}
              />
            </View>
            <Text variant="labelSmall" style={styles.barLabel} numberOfLines={1}>
              {item.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export function KeyValueRow({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: IconName;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLabel}>
        {icon ? <MaterialCommunityIcons name={icon} size={16} color={palette.muted} /> : null}
        <Text variant="bodySmall" style={styles.rowLabelText}>
          {label}
        </Text>
      </View>
      <Text variant="bodyMedium" style={styles.rowValue}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  sectionTitleText: { color: palette.text, fontWeight: "700" },
  card: {
    backgroundColor: palette.surface,
    borderRadius: 18,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: palette.border,
  },
  tile: {
    width: "48%",
    backgroundColor: palette.surface,
    borderRadius: 16,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: palette.border,
    marginBottom: spacing.sm,
  },
  tileIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  tileLabel: { color: palette.muted },
  tileValueRow: { flexDirection: "row", alignItems: "baseline", gap: 4 },
  tileValue: { color: palette.text, fontWeight: "700" },
  tileUnit: { color: palette.muted },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  empty: {
    alignItems: "center",
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: { color: palette.text, fontWeight: "600" },
  emptyMessage: { color: palette.muted, textAlign: "center", paddingHorizontal: spacing.lg },
  chart: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
    marginTop: spacing.sm,
  },
  barColumn: { flex: 1, alignItems: "center", gap: 6 },
  barTrack: {
    width: "100%",
    backgroundColor: "#EDF3F1",
    borderRadius: 6,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  barFill: { width: "100%", borderRadius: 6, minHeight: 3 },
  barLabel: { color: palette.muted, fontSize: 10 },
  chartEmpty: { color: palette.muted, paddingVertical: spacing.lg },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
    gap: spacing.md,
  },
  rowLabel: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  rowLabelText: { color: palette.muted },
  rowValue: { color: palette.text, fontWeight: "600", textAlign: "right", flexShrink: 1 },
});

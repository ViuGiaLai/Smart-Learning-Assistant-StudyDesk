import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";

import { palette, spacing } from "../theme";
import { toneBackground, toneColor, type SensorTone } from "../utils/sensorTone";

export interface SensorStatusItem {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  label: string;
  value: string;
  tone: SensorTone;
}

/**
 * Compact, colour-coded sensor values shown above the chat so the important
 * numbers are always visible (green = in range, blue = low, amber = warning,
 * red = high).
 */
export function SensorStatusRow({ items }: { items: SensorStatusItem[] }) {
  if (items.length === 0) return null;

  return (
    <View style={styles.row}>
      {items.map((item) => (
        <View
          key={item.label}
          style={[styles.chip, { backgroundColor: toneBackground(item.tone) }]}
        >
          <MaterialCommunityIcons
            name={item.icon}
            size={14}
            color={toneColor(item.tone)}
          />
          <Text
            variant="labelMedium"
            style={[styles.value, { color: toneColor(item.tone) }]}
            numberOfLines={1}
          >
            {item.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  chip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 20,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  value: { fontWeight: "700", fontSize: 13 },
});

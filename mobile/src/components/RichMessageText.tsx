import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type TextStyle } from "react-native";
import { Text } from "react-native-paper";

import type { DeviceSettings } from "../api/types";
import { palette } from "../theme";
import {
  humidityTone,
  lightTone,
  temperatureTone,
  toneColor,
  type SensorTone,
} from "../utils/sensorTone";

interface RichMessageTextProps {
  text: string;
  thresholds?: DeviceSettings | null;
  style?: StyleProp<TextStyle>;
}

const VALUE_PATTERN = /(-?\d+(?:[.,]\d+)?)\s*(°C|℃|lux|%)/g;

function renderValues(
  content: string,
  thresholds: DeviceSettings | null | undefined,
  humidityContext: boolean,
  keyPrefix: string,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  VALUE_PATTERN.lastIndex = 0;

  while ((match = VALUE_PATTERN.exec(content)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(content.slice(lastIndex, match.index));
    }
    const numeric = Number((match[1] ?? "").replace(",", "."));
    const unit = match[2] ?? "";
    let tone: SensorTone = "unknown";
    if (unit === "°C" || unit === "℃") {
      tone = temperatureTone(numeric, thresholds);
    } else if (unit === "lux") {
      tone = lightTone(numeric, thresholds);
    } else if (humidityContext) {
      tone = humidityTone(numeric, thresholds);
    }
    nodes.push(
      <Text
        key={`${keyPrefix}-${match.index}`}
        style={[styles.value, tone === "unknown" ? null : { color: toneColor(tone) }]}
      >
        {match[0]}
      </Text>,
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    nodes.push(content.slice(lastIndex));
  }
  return nodes;
}

function renderInline(
  line: string,
  thresholds: DeviceSettings | null | undefined,
): ReactNode[] {
  const humidityContext = /ẩm/i.test(line);
  const parts = line.split(/(\*\*[^*]+\*\*)/g).filter((part) => part.length > 0);

  return parts.map((part, index) => {
    const isBold = part.startsWith("**") && part.endsWith("**") && part.length > 4;
    const content = isBold ? part.slice(2, -2) : part.replace(/\*\*/g, "");
    return (
      <Text key={`part-${index}`} style={isBold ? styles.bold : undefined}>
        {renderValues(content, thresholds, humidityContext, `p${index}`)}
      </Text>
    );
  });
}

/**
 * Minimal renderer for assistant answers: bullet/numbered lines, `**bold**`
 * spans, and colour-coded sensor values (green/blue/amber/red depending on the
 * user's thresholds). The mobile app cannot render markdown, so this keeps
 * answers readable instead of showing literal `**` characters.
 */
export function RichMessageText({ text, thresholds, style }: RichMessageTextProps) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  return (
    <View style={styles.container}>
      {lines.map((rawLine, index) => {
        const line = rawLine.trimEnd();
        if (!line.trim()) {
          return <View key={`gap-${index}`} style={styles.gap} />;
        }

        const heading = line.match(/^#{1,6}\s*(.+)$/);
        if (heading) {
          return (
            <Text key={`h-${index}`} style={[styles.heading, style]}>
              {renderInline(heading[1] ?? "", thresholds)}
            </Text>
          );
        }

        const bullet = line.match(/^[-*•]\s+(.+)$/);
        if (bullet) {
          return (
            <View key={`b-${index}`} style={styles.row}>
              <Text style={styles.marker}>•</Text>
              <Text style={[styles.body, style]}>{renderInline(bullet[1] ?? "", thresholds)}</Text>
            </View>
          );
        }

        const numbered = line.match(/^(\d+)[.)]\s+(.+)$/);
        if (numbered) {
          return (
            <View key={`n-${index}`} style={styles.row}>
              <Text style={styles.marker}>{numbered[1]}.</Text>
              <Text style={[styles.body, style]}>{renderInline(numbered[2] ?? "", thresholds)}</Text>
            </View>
          );
        }

        return (
          <Text key={`p-${index}`} style={[styles.paragraph, style]}>
            {renderInline(line, thresholds)}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 2 },
  gap: { height: 6 },
  heading: {
    color: palette.primaryDark,
    fontWeight: "700",
    fontSize: 15,
    marginTop: 4,
    marginBottom: 2,
  },
  paragraph: { color: palette.text, lineHeight: 21 },
  row: { flexDirection: "row", gap: 6, marginBottom: 2 },
  marker: { color: palette.primary, fontWeight: "700", lineHeight: 21, minWidth: 18 },
  body: { flex: 1, color: palette.text, lineHeight: 21 },
  bold: { fontWeight: "700" },
  value: { fontWeight: "700" },
});

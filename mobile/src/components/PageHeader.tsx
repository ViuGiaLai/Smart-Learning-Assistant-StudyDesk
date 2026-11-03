import type { ReactNode } from "react";
import { Image, StyleSheet, View } from "react-native";
import { IconButton, Text } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { palette, spacing } from "../theme";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
}

export function PageHeader({ title, subtitle, onBack, right }: PageHeaderProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.row}>
        {onBack ? (
          <IconButton
            icon="arrow-left"
            size={24}
            onPress={onBack}
            style={styles.back}
            accessibilityLabel="Quay lại"
          />
        ) : (
          <View style={styles.logoContainer}>
            <Image
              source={require("../../assets/logo.png")}
              style={styles.logoImage}
              resizeMode="contain"
            />
          </View>
        )}
        <View style={styles.textWrap}>
          <Text variant="titleLarge" style={styles.title}>
            {title}
          </Text>
          {subtitle ? (
            <Text variant="bodySmall" style={styles.subtitle}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: palette.background,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  row: { flexDirection: "row", alignItems: "center", minHeight: 48 },
  logo: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: palette.primary,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },
  logoContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    overflow: "hidden",
    marginRight: spacing.md,
  },
  logoImage: {
    width: 40,
    height: 40,
  },  back: { marginLeft: -spacing.sm, marginRight: spacing.xs },
  textWrap: { flex: 1 },
  title: { color: palette.text, fontWeight: "700" },
  subtitle: { color: palette.muted, marginTop: 2 },
});

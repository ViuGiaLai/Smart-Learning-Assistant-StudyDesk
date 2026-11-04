import type { ReactNode } from "react";
import { useRef } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTabScrollToTop } from "../hooks/useTabScrollToTop";
import { palette, spacing } from "../theme";

interface ScreenProps {
  children: ReactNode;
  /**
   * Fixed header rendered above the scroll area (usually a `PageHeader`).
   * It stays in place while the content scrolls.
   */
  header?: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
  padded?: boolean;
}

export function Screen({
  children,
  header,
  scroll = true,
  refreshing = false,
  onRefresh,
  contentStyle,
  padded = true,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  // Tapping the active tab scrolls its content back to the top.
  useTabScrollToTop(scrollRef);
  const padding = padded ? { padding: spacing.lg, paddingBottom: spacing.xxl } : null;

  const body = scroll ? (
    <ScrollView
      ref={scrollRef}
      style={styles.flex}
      contentContainerStyle={[padding, contentStyle]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={palette.primary}
            colors={[palette.primary]}
          />
        ) : undefined
      }
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.body, contentStyle]}>{children}</View>
  );

  if (header) {
    // The header lives outside the ScrollView, so it never moves with the
    // content. PageHeader already handles the top safe-area inset.
    return (
      <View style={styles.flex}>
        {header}
        {body}
      </View>
    );
  }

  if (!scroll) {
    return (
      <View style={[styles.flex, { paddingTop: insets.top }, contentStyle]}>{children}</View>
    );
  }

  return body;
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: palette.background },
  body: { flex: 1 },
});

import { MD3LightTheme, type MD3Theme } from "react-native-paper";

export const palette = {
  primary: "#0F766E",
  primaryDark: "#0B5F59",
  primarySoft: "#CCFBF1",
  accent: "#F59E0B",
  accentSoft: "#FEF3C7",
  background: "#F5F7F6",
  surface: "#FFFFFF",
  text: "#10231F",
  muted: "#5B6B67",
  border: "#DCE5E2",
  success: "#15803D",
  warning: "#B45309",
  danger: "#B91C1C",
  info: "#1D4ED8",
};

export const theme: MD3Theme = {
  ...MD3LightTheme,
  roundness: 4,
  colors: {
    ...MD3LightTheme.colors,
    primary: palette.primary,
    onPrimary: "#FFFFFF",
    primaryContainer: palette.primarySoft,
    onPrimaryContainer: "#053B36",
    secondary: palette.accent,
    secondaryContainer: palette.accentSoft,
    background: palette.background,
    surface: palette.surface,
    surfaceVariant: "#EAF1EF",
    onSurface: palette.text,
    onSurfaceVariant: palette.muted,
    outline: palette.border,
    error: palette.danger,
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

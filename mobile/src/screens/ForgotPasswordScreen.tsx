import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";
import { Button, HelperText, Text, TextInput } from "react-native-paper";

import { Screen } from "../components/Screen";
import type { RootStackParamList } from "../navigation/types";
import { useAuthStore } from "../store/authStore";
import { palette, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "ForgotPassword">;

export default function ForgotPasswordScreen({ navigation, route }: Props) {
  const forgotPassword = useAuthStore((state) => state.forgotPassword);
  const busy = useAuthStore((state) => state.busy);
  const error = useAuthStore((state) => state.error);
  const clearError = useAuthStore((state) => state.clearError);

  const [email, setEmail] = useState(route.params?.email ?? "");
  const [localError, setLocalError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const submit = async () => {
    clearError();
    setLocalError(null);
    if (!email.trim()) {
      setLocalError("Nhập email đã đăng ký để nhận liên kết đặt lại mật khẩu.");
      return;
    }
    try {
      const message = await forgotPassword(email);
      setSent(message);
    } catch {
      // Store exposes the error message.
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen>
        <View style={styles.brand}>
          <View style={styles.logo}>
            <MaterialCommunityIcons name="lock-reset" size={32} color="#fff" />
          </View>
          <Text variant="headlineSmall" style={styles.title}>
            Quên mật khẩu
          </Text>
          <Text variant="bodyMedium" style={styles.subtitle}>
            Nhập email đã đăng ký. Supabase sẽ gửi liên kết để bạn đặt mật khẩu mới.
          </Text>
        </View>

        <View style={styles.form}>
          {sent ? (
            <View style={styles.successBox}>
              <MaterialCommunityIcons
                name="email-check-outline"
                size={28}
                color={palette.success}
              />
              <Text variant="bodyMedium" style={styles.successText}>
                {sent}
              </Text>
              <Text variant="bodySmall" style={styles.muted}>
                Mở email trên điện thoại này rồi bấm liên kết để quay lại app.
              </Text>
            </View>
          ) : (
            <>
              <TextInput
                label="Email"
                value={email}
                onChangeText={setEmail}
                mode="outlined"
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                left={<TextInput.Icon icon="email-outline" />}
                style={styles.input}
                outlineColor={palette.border}
                activeOutlineColor={palette.primary}
                onSubmitEditing={() => void submit()}
              />

              {localError || error ? (
                <HelperText type="error" visible style={styles.error}>
                  {localError ?? error}
                </HelperText>
              ) : null}

              <Button
                mode="contained"
                onPress={() => void submit()}
                loading={busy}
                disabled={busy}
                style={styles.button}
                contentStyle={styles.buttonContent}
              >
                Gửi liên kết đặt lại
              </Button>
            </>
          )}

          <Button
            mode="text"
            onPress={() => {
              if (sent) setSent(null);
              else navigation.goBack();
            }}
            style={styles.secondary}
          >
            {sent ? "Gửi tới email khác" : "Quay lại đăng nhập"}
          </Button>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  brand: { alignItems: "center", marginTop: spacing.xl, marginBottom: spacing.lg },
  logo: {
    width: 70,
    height: 70,
    borderRadius: 22,
    backgroundColor: palette.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  title: { color: palette.text, fontWeight: "700" },
  subtitle: {
    color: palette.muted,
    textAlign: "center",
    marginTop: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  form: {
    backgroundColor: palette.surface,
    borderRadius: 20,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: palette.border,
  },
  input: { marginBottom: spacing.sm, backgroundColor: palette.surface },
  error: { paddingHorizontal: 0 },
  button: { borderRadius: 12, marginTop: spacing.sm },
  buttonContent: { paddingVertical: 6 },
  secondary: { marginTop: spacing.sm },
  successBox: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md },
  successText: { color: palette.text, textAlign: "center" },
  muted: { color: palette.muted, textAlign: "center" },
});

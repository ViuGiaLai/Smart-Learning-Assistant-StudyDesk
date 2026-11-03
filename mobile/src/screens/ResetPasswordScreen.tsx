import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";
import { Button, HelperText, Text, TextInput } from "react-native-paper";

import { Screen } from "../components/Screen";
import { parseAuthLink } from "../navigation/authDeepLink";
import type { RootStackParamList } from "../navigation/types";
import { useAuthStore } from "../store/authStore";
import { palette, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "ResetPassword">;

export default function ResetPasswordScreen({ navigation, route }: Props) {
  const resetPassword = useAuthStore((state) => state.resetPassword);
  const signOut = useAuthStore((state) => state.signOut);
  const busy = useAuthStore((state) => state.busy);
  const error = useAuthStore((state) => state.error);
  const clearError = useAuthStore((state) => state.clearError);

  const link = useMemo(() => {
    const parsed = parseAuthLink(route.params.url);
    return parsed && parsed.kind === "recovery" ? parsed : null;
  }, [route.params.url]);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    clearError();
    setLocalError(null);
    if (!link?.accessToken) {
      setLocalError("Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.");
      return;
    }
    if (password.length < 8) {
      setLocalError("Mật khẩu cần ít nhất 8 ký tự.");
      return;
    }
    if (password !== confirm) {
      setLocalError("Mật khẩu nhập lại không khớp.");
      return;
    }
    try {
      await resetPassword(link.accessToken, password);
      setDone(true);
    } catch {
      // Store exposes the error message.
    }
  };

  const goToLogin = async () => {
    if (useAuthStore.getState().status === "signedIn") {
      await signOut();
    } else {
      navigation.navigate("Login");
    }
  };

  const linkError = link?.error;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen>
        <View style={styles.brand}>
          <View style={styles.logo}>
            <MaterialCommunityIcons name="lock-check-outline" size={32} color="#fff" />
          </View>
          <Text variant="headlineSmall" style={styles.title}>
            Đặt mật khẩu mới
          </Text>
          <Text variant="bodyMedium" style={styles.subtitle}>
            Chọn mật khẩu mới cho tài khoản của bạn.
          </Text>
        </View>

        <View style={styles.form}>
          {done ? (
            <View style={styles.successBox}>
              <MaterialCommunityIcons
                name="check-circle-outline"
                size={30}
                color={palette.success}
              />
              <Text variant="bodyMedium" style={styles.successText}>
                Đã đặt lại mật khẩu. Hãy đăng nhập bằng mật khẩu mới.
              </Text>
            </View>
          ) : linkError || !link?.accessToken ? (
            <View style={styles.successBox}>
              <MaterialCommunityIcons
                name="link-variant-off"
                size={30}
                color={palette.danger}
              />
              <Text variant="bodyMedium" style={styles.successText}>
                {linkError || "Liên kết đặt lại mật khẩu không hợp lệ."}
              </Text>
              <Text variant="bodySmall" style={styles.muted}>
                Liên kết chỉ dùng một lần và hết hạn sau ít phút.
              </Text>
            </View>
          ) : (
            <>
              <TextInput
                label="Mật khẩu mới (tối thiểu 8 ký tự)"
                value={password}
                onChangeText={setPassword}
                mode="outlined"
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                left={<TextInput.Icon icon="lock-outline" />}
                right={
                  <TextInput.Icon
                    icon={showPassword ? "eye-off-outline" : "eye-outline"}
                    onPress={() => setShowPassword((value) => !value)}
                  />
                }
                style={styles.input}
                outlineColor={palette.border}
                activeOutlineColor={palette.primary}
              />
              <TextInput
                label="Nhập lại mật khẩu mới"
                value={confirm}
                onChangeText={setConfirm}
                mode="outlined"
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                left={<TextInput.Icon icon="lock-check-outline" />}
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
                Lưu mật khẩu mới
              </Button>
            </>
          )}

          {done ? (
            <Button
              mode="contained"
              onPress={() => void goToLogin()}
              style={styles.button}
              contentStyle={styles.buttonContent}
            >
              Đăng nhập
            </Button>
          ) : (
            <Button
              mode="text"
              onPress={() => navigation.navigate("ForgotPassword", {})}
              style={styles.secondary}
            >
              Yêu cầu liên kết mới
            </Button>
          )}
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

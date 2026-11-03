import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";
import { Button, HelperText, Text, TextInput } from "react-native-paper";

import { API_URL } from "../api/config";
import { Screen } from "../components/Screen";
import type { RootStackParamList } from "../navigation/types";
import { useAuthStore } from "../store/authStore";
import { palette, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Login">;

export default function LoginScreen({ navigation }: Props) {
  const signIn = useAuthStore((state) => state.signIn);
  const resendConfirmation = useAuthStore((state) => state.resendConfirmation);
  const busy = useAuthStore((state) => state.busy);
  const error = useAuthStore((state) => state.error);
  const notice = useAuthStore((state) => state.notice);
  const clearError = useAuthStore((state) => state.clearError);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = async () => {
    clearError();
    setLocalError(null);
    if (!email.trim() || !password) {
      setLocalError("Nhập email và mật khẩu để đăng nhập.");
      return;
    }
    try {
      await signIn(email, password);
    } catch {
      // Store exposes the error message.
    }
  };

  const handleResend = async () => {
    clearError();
    setLocalError(null);
    if (!email.trim()) {
      setLocalError("Nhập email để gửi lại liên kết xác nhận.");
      return;
    }
    try {
      await resendConfirmation(email);
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
            <MaterialCommunityIcons name="book-open-page-variant" size={34} color="#fff" />
          </View>
          <Text variant="headlineSmall" style={styles.title}>
            Smart Learning Assistant
          </Text>
          <Text variant="bodyMedium" style={styles.subtitle}>
            Trợ lý học tập thông minh kết hợp bàn học IoT
          </Text>
        </View>

        <View style={styles.form}>
          <Text variant="titleLarge" style={styles.formTitle}>
            Đăng nhập
          </Text>
          <Text variant="bodySmall" style={styles.formSubtitle}>
            Tiếp tục phiên học và theo dõi môi trường bàn học của bạn.
          </Text>

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
          />
          <TextInput
            label="Mật khẩu"
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
            onSubmitEditing={() => void submit()}
          />

          {notice ? (
            <View>
              <HelperText type="info" visible style={styles.error}>
                {notice}
              </HelperText>
              <Button
                compact
                mode="text"
                onPress={() => void handleResend()}
                disabled={busy}
                style={styles.resend}
              >
                Gửi lại email xác nhận
              </Button>
            </View>
          ) : null}

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
            Đăng nhập
          </Button>

          <Button
            compact
            mode="text"
            onPress={() =>
              navigation.navigate("ForgotPassword", { email: email.trim() })
            }
            style={styles.forgot}
          >
            Quên mật khẩu?
          </Button>

          <View style={styles.switchRow}>
            <Text variant="bodySmall" style={styles.muted}>
              Chưa có tài khoản?
            </Text>
            <Button compact mode="text" onPress={() => navigation.navigate("Register")}>
              Đăng ký
            </Button>
          </View>
        </View>

        <View style={styles.serverHint}>
          <MaterialCommunityIcons name="server-network" size={14} color={palette.muted} />
          <Text variant="labelSmall" style={styles.muted} numberOfLines={1}>
            API: {API_URL}
          </Text>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  brand: { alignItems: "center", marginTop: spacing.xxl, marginBottom: spacing.xl },
  logo: {
    width: 76,
    height: 76,
    borderRadius: 24,
    backgroundColor: palette.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  title: { color: palette.text, fontWeight: "700", textAlign: "center" },
  subtitle: { color: palette.muted, textAlign: "center", marginTop: spacing.xs },
  form: {
    backgroundColor: palette.surface,
    borderRadius: 20,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: palette.border,
  },
  formTitle: { color: palette.text, fontWeight: "700" },
  formSubtitle: { color: palette.muted, marginTop: 4, marginBottom: spacing.md },
  input: { marginBottom: spacing.sm, backgroundColor: palette.surface },
  error: { paddingHorizontal: 0 },
  button: { borderRadius: 12, marginTop: spacing.sm },
  buttonContent: { paddingVertical: 6 },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.md,
    gap: 4,
  },
  muted: { color: palette.muted },
  forgot: { alignSelf: "center", marginTop: 2 },
  resend: { alignSelf: "flex-start", marginTop: -4 },
  serverHint: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: spacing.xl,
  },
});

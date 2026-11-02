import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";
import { Button, HelperText, Text, TextInput } from "react-native-paper";

import { Screen } from "../components/Screen";
import type { RootStackParamList } from "../navigation/types";
import { useAuthStore } from "../store/authStore";
import { palette, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Register">;

export default function RegisterScreen({ navigation }: Props) {
  const signUp = useAuthStore((state) => state.signUp);
  const busy = useAuthStore((state) => state.busy);
  const error = useAuthStore((state) => state.error);
  const clearError = useAuthStore((state) => state.clearError);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = async () => {
    clearError();
    setLocalError(null);
    if (!name.trim() || !email.trim() || !password) {
      setLocalError("Vui lòng điền đầy đủ thông tin.");
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
      const result = await signUp(name, email, password);
      if (result.requiresEmailConfirmation) {
        navigation.navigate("Login");
      }
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
            <MaterialCommunityIcons name="account-plus-outline" size={32} color="#fff" />
          </View>
          <Text variant="headlineSmall" style={styles.title}>
            Tạo tài khoản
          </Text>
          <Text variant="bodyMedium" style={styles.subtitle}>
            Bắt đầu theo dõi thời gian học và môi trường bàn học.
          </Text>
        </View>

        <View style={styles.form}>
          <TextInput
            label="Họ tên"
            value={name}
            onChangeText={setName}
            mode="outlined"
            left={<TextInput.Icon icon="account-outline" />}
            style={styles.input}
            outlineColor={palette.border}
            activeOutlineColor={palette.primary}
          />
          <TextInput
            label="Email"
            value={email}
            onChangeText={setEmail}
            mode="outlined"
            autoCapitalize="none"
            keyboardType="email-address"
            left={<TextInput.Icon icon="email-outline" />}
            style={styles.input}
            outlineColor={palette.border}
            activeOutlineColor={palette.primary}
          />
          <TextInput
            label="Mật khẩu (tối thiểu 8 ký tự)"
            value={password}
            onChangeText={setPassword}
            mode="outlined"
            secureTextEntry
            autoCapitalize="none"
            left={<TextInput.Icon icon="lock-outline" />}
            style={styles.input}
            outlineColor={palette.border}
            activeOutlineColor={palette.primary}
          />
          <TextInput
            label="Nhập lại mật khẩu"
            value={confirm}
            onChangeText={setConfirm}
            mode="outlined"
            secureTextEntry
            autoCapitalize="none"
            left={<TextInput.Icon icon="lock-check-outline" />}
            style={styles.input}
            outlineColor={palette.border}
            activeOutlineColor={palette.primary}
            onSubmitEditing={() => void submit()}
          />

          {localError || error ? (
            <HelperText type="error" visible>
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
            Đăng ký
          </Button>

          <View style={styles.switchRow}>
            <Text variant="bodySmall" style={styles.muted}>
              Đã có tài khoản?
            </Text>
            <Button compact mode="text" onPress={() => navigation.goBack()}>
              Đăng nhập
            </Button>
          </View>
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
});

import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { Chip, IconButton, Text, TextInput } from "react-native-paper";

import { ApiError, api } from "../api/client";
import type { ChatSource } from "../api/types";
import { PageHeader } from "../components/PageHeader";
import { Tag } from "../components/ui";
import type { TabParamList } from "../navigation/types";
import { palette, spacing } from "../theme";

type Props = BottomTabScreenProps<TabParamList, "Assistant">;

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  source?: ChatSource;
}

const SOURCE_LABELS: Record<ChatSource, string> = {
  groq: "Groq",
  gemini: "Gemini",
  rule_based: "Gợi ý nội bộ",
};

const WELCOME =
  "Chào bạn! Mình là trợ lý học tập. Mình có thể giúp bạn lập kế hoạch, giải thích kiến thức, tạo câu hỏi ôn tập và gợi ý cải thiện môi trường bàn học dựa trên cảm biến.";

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Không gửi được tin nhắn";
}

function nextId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function AssistantScreen(_props: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: "welcome", role: "assistant", text: WELCOME },
  ]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        try {
          const context = await api.assistantContext();
          setSuggestions(context.suggestions.slice(0, 4));
        } catch {
          // Chat still works without context.
        }
      })();
    }, []),
  );

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setError(null);
    setInput("");
    const userMessage: ChatMessage = { id: nextId(), role: "user", text: trimmed };
    setMessages((current) => [...current, userMessage]);
    setSending(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);

    try {
      const response = await api.chat(trimmed, conversationId);
      setConversationId(response.conversation_id);
      setMessages((current) => [
        ...current,
        {
          id: nextId(),
          role: "assistant",
          text: response.answer,
          source: response.source,
        },
      ]);
      if (response.suggestions.length > 0) {
        setSuggestions(response.suggestions.slice(0, 4));
      }
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setSending(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
    >
      <PageHeader
        title="Trợ lý học tập"
        subtitle="AI kết hợp dữ liệu môi trường bàn học"
        right={<Tag text="AI" tone="primary" />}
      />

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.messages}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {messages.map((message) => (
          <View
            key={message.id}
            style={[
              styles.bubbleRow,
              message.role === "user" ? styles.bubbleRowUser : styles.bubbleRowAssistant,
            ]}
          >
            <View
              style={[
                styles.bubble,
                message.role === "user" ? styles.userBubble : styles.assistantBubble,
              ]}
            >
              <Text
                variant="bodyMedium"
                style={message.role === "user" ? styles.userText : styles.assistantText}
              >
                {message.text}
              </Text>
              {message.role === "assistant" && message.source ? (
                <Text variant="labelSmall" style={styles.source}>
                  {SOURCE_LABELS[message.source]}
                </Text>
              ) : null}
            </View>
          </View>
        ))}

        {sending ? (
          <View style={[styles.bubbleRow, styles.bubbleRowAssistant]}>
            <View style={[styles.bubble, styles.assistantBubble, styles.typing]}>
              <ActivityIndicator size="small" color={palette.primary} />
              <Text variant="bodySmall" style={styles.source}>
                Đang phân tích dữ liệu…
              </Text>
            </View>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorBox}>
            <MaterialCommunityIcons name="alert-circle-outline" size={18} color={palette.danger} />
            <Text variant="bodySmall" style={styles.errorText}>
              {error}
            </Text>
          </View>
        ) : null}

        {suggestions.length > 0 ? (
          <View style={styles.suggestions}>
            <Text variant="labelMedium" style={styles.suggestionsTitle}>
              Gợi ý câu hỏi
            </Text>
            <View style={styles.chipWrap}>
              {suggestions.map((suggestion) => (
                <Chip
                  key={suggestion}
                  icon="arrow-right"
                  onPress={() => void send(suggestion)}
                  style={styles.chip}
                  compact
                >
                  {suggestion.length > 60 ? `${suggestion.slice(0, 57)}…` : suggestion}
                </Chip>
              ))}
            </View>
          </View>
        ) : null}

        <Text variant="labelSmall" style={styles.disclaimer}>
          Cảm biến môi trường không phải thiết bị y tế. Trợ lý không chẩn đoán bệnh; hãy gặp
          chuyên gia y tế nếu bạn có triệu chứng sức khỏe.
        </Text>
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Hỏi về kế hoạch, kiến thức, môi trường học…"
          mode="outlined"
          multiline
          style={styles.input}
          outlineColor={palette.border}
          activeOutlineColor={palette.primary}
          onSubmitEditing={() => void send(input)}
          returnKeyType="send"
        />
        <IconButton
          icon="send"
          mode="contained"
          size={22}
          onPress={() => void send(input)}
          disabled={sending || input.trim().length === 0}
          accessibilityLabel="Gửi tin nhắn"
          style={styles.sendButton}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: palette.background },
  messages: { padding: spacing.lg, paddingBottom: spacing.md, gap: spacing.md },
  bubbleRow: { flexDirection: "row" },
  bubbleRowUser: { justifyContent: "flex-end" },
  bubbleRowAssistant: { justifyContent: "flex-start" },
  bubble: { maxWidth: "86%", borderRadius: 16, padding: spacing.md },
  userBubble: { backgroundColor: palette.primary, borderBottomRightRadius: 4 },
  assistantBubble: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderBottomLeftRadius: 4,
  },
  userText: { color: "#FFFFFF", lineHeight: 21 },
  assistantText: { color: palette.text, lineHeight: 21 },
  source: { color: palette.muted, marginTop: spacing.xs, fontSize: 10 },
  typing: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    backgroundColor: "#FEF2F2",
    borderRadius: 12,
    padding: spacing.md,
  },
  errorText: { color: palette.danger, flex: 1 },
  suggestions: { gap: spacing.sm, marginTop: spacing.sm },
  suggestionsTitle: { color: palette.muted },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { maxWidth: "100%" },
  disclaimer: { color: palette.muted, marginTop: spacing.md, lineHeight: 17 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    backgroundColor: palette.surface,
  },
  input: { flex: 1, maxHeight: 120, backgroundColor: palette.surface },
  sendButton: { marginBottom: 2, backgroundColor: palette.primary },
});

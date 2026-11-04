import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { useFocusEffect } from "@react-navigation/native";
import type { CompositeScreenProps } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { Chip, IconButton, Text, TextInput } from "react-native-paper";

import { ApiError, api } from "../api/client";
import type { AssistantContext, ChatSource } from "../api/types";
import { PageHeader } from "../components/PageHeader";
import { RichMessageText } from "../components/RichMessageText";
import { SensorStatusRow, type SensorStatusItem } from "../components/SensorStatusRow";
import { useTabScrollToTop } from "../hooks/useTabScrollToTop";
import { Tag } from "../components/ui";
import type { RootStackParamList, TabParamList } from "../navigation/types";
import { useDeviceStore } from "../store/deviceStore";
import { palette, spacing } from "../theme";
import { humidityTone, lightTone, temperatureTone } from "../utils/sensorTone";

type Props = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, "Assistant">,
  NativeStackScreenProps<RootStackParamList>
>;

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

const QUICK_PROMPTS = [
  "Hôm nay tôi nên học gì?",
  "Ánh sáng bàn học có đủ không?",
  "Cách tập trung 25 phút?",
  "Tóm tắt tiến độ tuần này",
];

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Không gửi được tin nhắn";
}

function nextId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function AssistantScreen({ navigation, route }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: "welcome", role: "assistant", text: WELCOME },
  ]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState<AssistantContext | null>(null);
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  useTabScrollToTop(scrollRef);
  const lastContextFetch = useRef<number>(0);
  const devices = useDeviceStore((state) => state.devices);
  const selectedId = useDeviceStore((state) => state.selectedId);

  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      if (now - lastContextFetch.current < 60_000) return;
      void (async () => {
        try {
          const context = await api.assistantContext();
          setSuggestions(context.suggestions.slice(0, 4));
          setContext(context);
          lastContextFetch.current = Date.now();
        } catch {
          // Chat still works without context.
        }
      })();
    }, []),
  );

  // Reopen a saved conversation coming from the history screen.
  const requestedConversationId = route.params?.conversationId;
  useEffect(() => {
    if (!requestedConversationId) return;
    let cancelled = false;
    void (async () => {
      try {
        const history = await api.assistantHistory(100);
        if (cancelled) return;
        const turns = history
          .filter((item) => item.conversation_id === requestedConversationId)
          .sort((a, b) => a.created_at.localeCompare(b.created_at));
        if (turns.length === 0) return;
        setMessages(
          turns.flatMap((turn) => [
            { id: `h-${turn.id}-q`, role: "user" as const, text: turn.question },
            { id: `h-${turn.id}-a`, role: "assistant" as const, text: turn.response },
          ]),
        );
        setConversationId(requestedConversationId);
        setError(null);
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 120);
      } catch (caught) {
        if (!cancelled) setError(messageOf(caught));
      } finally {
        if (!cancelled) navigation.setParams({ conversationId: undefined });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requestedConversationId, navigation]);

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

  const hasUserMessage = messages.some((message) => message.role === "user");

  const resetChat = () => {
    setMessages([{ id: "welcome", role: "assistant", text: WELCOME }]);
    setConversationId(undefined);
    setError(null);
    setSuggestions((current) => current.slice(0, 4));
  };

  const settings =
    (devices.find((device) => device.id === selectedId) ?? devices[0])?.settings ?? null;

  const statusItems: SensorStatusItem[] = [];
  if (context?.latest_temperature != null) {
    statusItems.push({
      icon: "thermometer",
      label: "Nhiệt độ",
      value: `${context.latest_temperature.toFixed(1)}°C`,
      tone: temperatureTone(context.latest_temperature, settings),
    });
  }
  if (context?.latest_humidity != null) {
    statusItems.push({
      icon: "water-percent",
      label: "Độ ẩm",
      value: `${Math.round(context.latest_humidity)}%`,
      tone: humidityTone(context.latest_humidity, settings),
    });
  }
  if (context?.latest_light_lux != null) {
    statusItems.push({
      icon: "white-balance-sunny",
      label: "Ánh sáng",
      value: `${Math.round(context.latest_light_lux)} lux`,
      tone: lightTone(context.latest_light_lux, settings),
    });
  }
  const hasWarning = statusItems.some((item) => item.tone !== "ok" && item.tone !== "unknown");

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
    >
      <PageHeader
        title="Trợ lý học tập"
        subtitle="AI kết hợp dữ liệu môi trường bàn học"
        right={
          <View style={styles.headerActions}>
            <Tag text="AI" tone="primary" />
            <IconButton
              icon="history"
              size={22}
              onPress={() => navigation.navigate("AssistantHistory")}
              accessibilityLabel="Lịch sử trò chuyện"
            />
            <IconButton
              icon="chat-plus-outline"
              size={22}
              onPress={resetChat}
              accessibilityLabel="Bắt đầu cuộc trò chuyện mới"
            />
          </View>
        }
      />

      {statusItems.length > 0 ? (
        <View>
          <SensorStatusRow items={statusItems} />
          {hasWarning ? (
            <Text variant="labelSmall" style={styles.sensorLegend}>
              Xanh: đạt ngưỡng · Xanh dương: thấp · Cam: cần chú ý · Đỏ: cao
            </Text>
          ) : null}
        </View>
      ) : null}

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
              {message.role === "user" ? (
                <Text variant="bodyMedium" style={styles.userText}>
                  {message.text}
                </Text>
              ) : (
                <RichMessageText text={message.text} thresholds={settings} />
              )}
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

        {hasUserMessage ? null : (
          <View style={styles.suggestions}>
            <Text variant="labelMedium" style={styles.suggestionsTitle}>
              Câu hỏi nhanh
            </Text>
            <View style={styles.chipWrap}>
              {QUICK_PROMPTS.map((prompt) => (
                <Chip
                  key={prompt}
                  icon="arrow-right"
                  onPress={() => void send(prompt)}
                  style={styles.chip}
                  compact
                >
                  {prompt}
                </Chip>
              ))}
            </View>
          </View>
        )}

        {suggestions.length > 0 ? (
          <View style={styles.suggestions}>
            <Text variant="labelMedium" style={styles.suggestionsTitle}>
              Gợi ý cho bạn
            </Text>
            <View style={styles.chipWrap}>
              {suggestions.map((suggestion) => (
                <Chip key={suggestion} style={styles.chip} compact>
                  {suggestion}
                </Chip>
              ))}
            </View>
          </View>
        ) : null}

        <Text variant="labelSmall" style={styles.disclaimer}>
          Cảm biến không phải thiết bị y tế và không thay thế tư vấn y tế.
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
  headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  sensorLegend: {
    color: palette.muted,
    fontSize: 10,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
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

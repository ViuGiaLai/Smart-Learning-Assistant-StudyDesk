import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { useFocusEffect } from "@react-navigation/native";
import type { CompositeScreenProps } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput as RNTextInput,
  View,
} from "react-native";
import { Chip, IconButton, Text } from "react-native-paper";

import { ApiError, api } from "../api/client";
import type { AssistantContext, ChatSource } from "../api/types";
import { MicButton } from "../components/MicButton";
import { PageHeader } from "../components/PageHeader";
import { RichMessageText } from "../components/RichMessageText";
import { SensorStatusRow, type SensorStatusItem } from "../components/SensorStatusRow";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { useTabScrollToTop } from "../hooks/useTabScrollToTop";
import { Tag } from "../components/ui";
import type { RootStackParamList, TabParamList } from "../navigation/types";
import { useDeviceStore } from "../store/deviceStore";
import { palette, spacing } from "../theme";
import { humidityTone, lightTone, temperatureTone } from "../utils/sensorTone";
import { parseVoiceCommands } from "../utils/voiceCommand";

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
  const setFanState = useDeviceStore((state) => state.setFanState);
  const setLedState = useDeviceStore((state) => state.setLedState);

  // ── Voice & Text Unified Dispatcher ────────────────────────────────────
  const speechResetRef = useRef<(() => void) | null>(null);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;
      setError(null);
      setInput("");
      const userMessage: ChatMessage = { id: nextId(), role: "user", text: trimmed };
      setMessages((current) => [...current, userMessage]);
      setSending(true);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);

      // 1. Kiểm tra lệnh điều khiển thiết bị (quạt, đèn, còi, nhiều lệnh cùng lúc)
      const commands = parseVoiceCommands(trimmed);
      if (commands.length > 0) {
        const targetDeviceId = selectedId ?? devices[0]?.id;
        if (!targetDeviceId) {
          setMessages((cur) => [
            ...cur,
            {
              id: nextId(),
              role: "assistant",
              text: "⚠️ Bạn chưa đăng ký hoặc kết nối thiết bị bàn học.",
              source: "rule_based",
            },
          ]);
          setSending(false);
          setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
          return;
        }

        try {
          const feedbacks: string[] = [];
          for (const cmd of commands) {
            const result = await api.sendCommand(targetDeviceId, cmd.action, cmd.value);
            if (cmd.action === "set_fan") setFanState(targetDeviceId, cmd.value);
            if (cmd.action === "set_led") setLedState(targetDeviceId, cmd.value);

            if (result.delivered) {
              feedbacks.push(cmd.feedback);
            } else {
              feedbacks.push(`${cmd.feedback} (⚠️ Chưa gửi được tới ESP32)`);
            }
          }

          const replyText = feedbacks.join("\n");

          setMessages((cur) => [
            ...cur,
            { id: nextId(), role: "assistant", text: replyText, source: "rule_based" },
          ]);
        } catch {
          setMessages((cur) => [
            ...cur,
            { id: nextId(), role: "assistant", text: "❌ Không gửi được lệnh tới thiết bị." },
          ]);
        } finally {
          setSending(false);
          setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
        }
        return;
      }

      // 2. Không phải lệnh IoT → Gửi lên AI Assistant (Groq / Gemini)
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
    },
    [sending, selectedId, devices, conversationId, setFanState, setLedState],
  );

  const handleVoiceFinalResult = useCallback(
    async (spokenText: string) => {
      speechResetRef.current?.();
      if (!spokenText.trim()) return;
      await send(spokenText);
    },
    [send],
  );

  const speechRecog = useSpeechRecognition(handleVoiceFinalResult);
  speechResetRef.current = speechRecog.reset;

  const handleMicPress = useCallback(() => {
    if (speechRecog.state === "listening") {
      speechRecog.stopListening();
    } else {
      void speechRecog.startListening();
    }
  }, [speechRecog]);

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
        subtitle="AI & điều khiển thiết bị thông minh"
        right={
          <View style={styles.headerActions}>
            <View style={styles.aiBadge}>
              <View style={styles.aiBadgeDot} />
              <Text variant="labelSmall" style={styles.aiBadgeText}>
                AI Online
              </Text>
            </View>
            <IconButton
              icon="history"
              size={20}
              onPress={() => navigation.navigate("AssistantHistory")}
              accessibilityLabel="Lịch sử trò chuyện"
              style={styles.headerIconBtn}
            />
            <IconButton
              icon="chat-plus-outline"
              size={20}
              onPress={resetChat}
              accessibilityLabel="Bắt đầu cuộc trò chuyện mới"
              style={styles.headerIconBtn}
            />
          </View>
        }
      />

      {statusItems.length > 0 ? (
        <View style={styles.sensorRowWrapper}>
          <SensorStatusRow items={statusItems} />
        </View>
      ) : null}

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.messages}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {messages.map((message) => {
          const isUser = message.role === "user";
          const isCommand =
            message.text.startsWith("✅") ||
            message.text.startsWith("🔔") ||
            message.text.startsWith("🔕") ||
            message.text.startsWith("⚙️") ||
            message.text.startsWith("📶");
          return (
            <View
              key={message.id}
              style={[
                styles.bubbleRow,
                isUser ? styles.bubbleRowUser : styles.bubbleRowAssistant,
              ]}
            >
              <View
                style={[
                  styles.bubble,
                  isUser
                    ? styles.userBubble
                    : isCommand
                    ? styles.commandBubble
                    : styles.assistantBubble,
                ]}
              >
                {isUser ? (
                  <Text variant="bodyMedium" style={styles.userText}>
                    {message.text}
                  </Text>
                ) : (
                  <RichMessageText text={message.text} thresholds={settings} />
                )}
                {!isUser && message.source ? (
                  <Text variant="labelSmall" style={styles.source}>
                    {isCommand ? "Điều khiển thiết bị" : SOURCE_LABELS[message.source]}
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })}

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
          <View style={styles.suggestionsContainer}>
            <Text variant="labelSmall" style={styles.suggestionsHeader}>
              CÂU HỎI NHANH
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalChipsList}
            >
              {QUICK_PROMPTS.map((prompt) => (
                <Pressable
                  key={prompt}
                  onPress={() => void send(prompt)}
                  style={({ pressed }) => [
                    styles.promptCard,
                    pressed && styles.pillPressed,
                  ]}
                >
                  <MaterialCommunityIcons
                    name="lightbulb-on-outline"
                    size={14}
                    color={palette.primary}
                    style={{ marginRight: 6 }}
                  />
                  <Text style={styles.promptCardText}>{prompt}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        {suggestions.length > 0 ? (
          <View style={styles.suggestionsContainer}>
            <Text variant="labelSmall" style={styles.suggestionsHeader}>
              GỢI Ý TỰ ĐỘNG
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalChipsList}
            >
              {suggestions.map((suggestion) => (
                <Pressable
                  key={suggestion}
                  onPress={() => void send(suggestion)}
                  style={({ pressed }) => [
                    styles.suggestionCard,
                    pressed && styles.pillPressed,
                  ]}
                >
                  <MaterialCommunityIcons
                    name="creation-outline"
                    size={14}
                    color={palette.accent}
                    style={{ marginRight: 6 }}
                  />
                  <Text style={styles.suggestionCardText} numberOfLines={2}>
                    {suggestion}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}

        <Text variant="labelSmall" style={styles.disclaimer}>
          Cảm biến không phải thiết bị y tế và không thay thế tư vấn y tế.
        </Text>
      </ScrollView>

      {/* Composer Bar */}
      <View style={styles.composerWrapper}>
        <View
          style={[
            styles.inputPill,
            speechRecog.state === "listening" && styles.inputPillListening,
          ]}
        >
          <RNTextInput
            value={
              speechRecog.state === "listening"
                ? speechRecog.transcript || "🎤 Đang lắng nghe bạn..."
                : input
            }
            onChangeText={(v) => {
              setInput(v);
              if (speechRecog.state === "listening") speechRecog.stopListening();
            }}
            placeholder={
              speechRecog.state === "listening"
                ? "Nói câu lệnh hoặc câu hỏi..."
                : "Nói hoặc nhập điều bạn muốn..."
            }
            placeholderTextColor={palette.muted}
            multiline
            editable={speechRecog.state !== "listening"}
            style={[
              styles.nativeInput,
              speechRecog.state === "listening" && styles.nativeInputListening,
            ]}
            onSubmitEditing={() => void send(input)}
          />
          <MicButton
            state={speechRecog.state}
            onPress={handleMicPress}
            disabled={sending}
          />
        </View>

        <Pressable
          onPress={() => void send(input)}
          disabled={sending || input.trim().length === 0 || speechRecog.state !== "idle"}
          style={({ pressed }) => [
            styles.sendCircle,
            sending || input.trim().length === 0 || speechRecog.state !== "idle"
              ? styles.sendCircleDisabled
              : styles.sendCircleActive,
            pressed && { opacity: 0.8 },
          ]}
          accessibilityLabel="Gửi tin nhắn"
        >
          {sending ? (
            <ActivityIndicator size={18} color="#FFFFFF" />
          ) : (
            <MaterialCommunityIcons
              name="send"
              size={18}
              color="#FFFFFF"
              style={{ marginLeft: 2 }}
            />
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: palette.background },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  headerIconBtn: { margin: 0 },
  aiBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#DCFCE7",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 5,
  },
  aiBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: palette.success,
  },
  aiBadgeText: {
    color: "#166534",
    fontWeight: "700",
    fontSize: 11,
  },
  sensorRowWrapper: {
    paddingTop: 2,
    paddingBottom: 2,
  },
  messages: { padding: spacing.md, paddingBottom: spacing.md, gap: spacing.md },
  bubbleRow: { flexDirection: "row" },
  bubbleRowUser: { justifyContent: "flex-end" },
  bubbleRowAssistant: { justifyContent: "flex-start" },
  bubble: {
    maxWidth: "85%",
    borderRadius: 18,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  userBubble: {
    backgroundColor: palette.primary,
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderBottomLeftRadius: 4,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  commandBubble: {
    backgroundColor: "#F0FDF4",
    borderWidth: 1,
    borderColor: "#86EFAC",
    borderBottomLeftRadius: 4,
  },
  userText: { color: "#FFFFFF", lineHeight: 21, fontSize: 15 },
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
  suggestionsContainer: {
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  suggestionsHeader: {
    color: palette.muted,
    fontWeight: "700",
    fontSize: 11,
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
    marginLeft: spacing.xs,
  },
  horizontalChipsList: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  promptCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  promptCardText: {
    color: palette.text,
    fontSize: 13,
    fontWeight: "500",
  },
  suggestionCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFBEB",
    borderWidth: 1,
    borderColor: "#FDE68A",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
    maxWidth: 320,
  },
  suggestionCardText: {
    color: "#92400E",
    fontSize: 12,
    lineHeight: 18,
  },
  pillPressed: {
    opacity: 0.7,
  },
  disclaimer: {
    color: palette.muted,
    marginTop: spacing.sm,
    textAlign: "center",
    fontSize: 11,
  },
  composerWrapper: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
    backgroundColor: palette.surface,
  },
  inputPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    borderRadius: 24,
    paddingLeft: spacing.md,
    paddingRight: 6,
    minHeight: 46,
  },
  inputPillListening: {
    backgroundColor: "#FEF2F2",
    borderColor: "#EF4444",
  },
  nativeInput: {
    flex: 1,
    fontSize: 15,
    color: palette.text,
    paddingVertical: 8,
    maxHeight: 100,
  },
  nativeInputListening: {
    color: "#DC2626",
    fontWeight: "500",
  },
  sendCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    elevation: 2,
  },
  sendCircleActive: {
    backgroundColor: palette.primary,
  },
  sendCircleDisabled: {
    backgroundColor: "#CBD5E1",
  },
});

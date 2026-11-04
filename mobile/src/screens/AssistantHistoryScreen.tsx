import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Button, Text } from "react-native-paper";

import { ApiError, api } from "../api/client";
import type { AssistantHistoryItem } from "../api/types";
import { PageHeader } from "../components/PageHeader";
import { RichMessageText } from "../components/RichMessageText";
import { Screen } from "../components/Screen";
import { Card, EmptyState } from "../components/ui";
import type { RootStackParamList } from "../navigation/types";
import { useDeviceStore } from "../store/deviceStore";
import { palette, spacing } from "../theme";
import { formatShortDate, formatTime } from "../utils/format";

type Props = NativeStackScreenProps<RootStackParamList, "AssistantHistory">;

interface ConversationGroup {
  id: string;
  turns: AssistantHistoryItem[];
  lastAt: string;
}

function groupConversations(items: AssistantHistoryItem[]): ConversationGroup[] {
  const grouped = new Map<string, AssistantHistoryItem[]>();
  for (const item of items) {
    const turns = grouped.get(item.conversation_id) ?? [];
    turns.push(item);
    grouped.set(item.conversation_id, turns);
  }
  return [...grouped.entries()]
    .map(([id, turns]) => {
      const ordered = [...turns].sort((a, b) => a.created_at.localeCompare(b.created_at));
      return { id, turns: ordered, lastAt: ordered[ordered.length - 1]?.created_at ?? "" };
    })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Không tải được lịch sử trò chuyện";
}

export default function AssistantHistoryScreen({ navigation }: Props) {
  const [items, setItems] = useState<AssistantHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const devices = useDeviceStore((state) => state.devices);
  const selectedId = useDeviceStore((state) => state.selectedId);
  const settings =
    (devices.find((device) => device.id === selectedId) ?? devices[0])?.settings ?? null;

  const load = useCallback(async () => {
    setError(null);
    try {
      const history = await api.assistantHistory(100);
      setItems(history);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const conversations = useMemo(() => groupConversations(items), [items]);

  const refresh = () => {
    setRefreshing(true);
    void load();
  };

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={refresh}
      header={
        <PageHeader
          title="Lịch sử trò chuyện"
          subtitle={
            conversations.length > 0
              ? `${conversations.length} cuộc trò chuyện đã lưu`
              : "Các câu hỏi của bạn sẽ được lưu tại đây"
          }
          onBack={() => navigation.goBack()}
        />
      }
    >
      {loading && items.length === 0 ? (
        <View style={styles.loading}>
          <ActivityIndicator color={palette.primary} />
        </View>
      ) : null}

      {error ? (
        <Card style={styles.errorCard}>
          <Text variant="bodySmall" style={styles.errorText}>
            {error}
          </Text>
        </Card>
      ) : null}

      {!loading && items.length === 0 && !error ? (
        <EmptyState
          icon="chat-outline"
          title="Chưa có cuộc trò chuyện nào"
          message="Khi bạn hỏi trợ lý học tập, toàn bộ câu hỏi và câu trả lời sẽ được lưu lại để xem sau."
          action={
            <Button
              mode="contained"
              icon="chat-plus-outline"
              onPress={() => navigation.navigate("Main", { screen: "Assistant" })}
            >
              Đặt câu hỏi
            </Button>
          }
        />
      ) : null}

      {conversations.map((conversation) => {
        const expanded = expandedId === conversation.id;
        const first = conversation.turns[0];
        return (
          <Card key={conversation.id} style={styles.card}>
            <Pressable
              onPress={() => setExpandedId(expanded ? null : conversation.id)}
              accessibilityRole="button"
              accessibilityLabel={
                expanded ? "Thu gọn cuộc trò chuyện" : "Mở cuộc trò chuyện"
              }
              style={styles.cardHeader}
            >
              <View style={styles.cardHeaderText}>
                <Text variant="titleSmall" style={styles.question} numberOfLines={2}>
                  {first?.question ?? "Cuộc trò chuyện"}
                </Text>
                <Text variant="labelSmall" style={styles.meta}>
                  {formatShortDate(conversation.lastAt)} · {formatTime(conversation.lastAt)} ·{" "}
                  {conversation.turns.length} lượt hỏi
                </Text>
              </View>
              <MaterialCommunityIcons
                name={expanded ? "chevron-up" : "chevron-down"}
                size={22}
                color={palette.muted}
              />
            </Pressable>

            {expanded ? (
              <View style={styles.turns}>
                {conversation.turns.map((turn) => (
                  <View key={turn.id} style={styles.turn}>
                    <View style={styles.turnQuestionRow}>
                      <MaterialCommunityIcons
                        name="account-outline"
                        size={16}
                        color={palette.primary}
                      />
                      <Text variant="bodyMedium" style={styles.turnQuestion}>
                        {turn.question}
                      </Text>
                    </View>
                    <View style={styles.turnAnswerRow}>
                      <MaterialCommunityIcons
                        name="robot-happy-outline"
                        size={16}
                        color={palette.muted}
                      />
                      <View style={styles.turnAnswer}>
                        <RichMessageText text={turn.response} thresholds={settings} />
                      </View>
                    </View>
                  </View>
                ))}
                <Button
                  mode="contained-tonal"
                  icon="chat-processing-outline"
                  onPress={() =>
                    navigation.navigate("Main", {
                      screen: "Assistant",
                      params: { conversationId: conversation.id },
                    })
                  }
                >
                  Tiếp tục cuộc trò chuyện
                </Button>
              </View>
            ) : null}
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: spacing.xxl, alignItems: "center" },
  errorCard: { backgroundColor: "#FEF2F2", marginBottom: spacing.md },
  errorText: { color: palette.danger },
  card: { marginBottom: spacing.md, padding: 0, overflow: "hidden" },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
  },
  cardHeaderText: { flex: 1 },
  question: { color: palette.text, fontWeight: "600" },
  meta: { color: palette.muted, marginTop: 2 },
  turns: {
    borderTopWidth: 1,
    borderTopColor: palette.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  turn: { gap: spacing.xs },
  turnQuestionRow: { flexDirection: "row", gap: spacing.xs },
  turnQuestion: { flex: 1, color: palette.text, fontWeight: "600" },
  turnAnswerRow: { flexDirection: "row", gap: spacing.xs, alignItems: "flex-start" },
  turnAnswer: { flex: 1 },
});

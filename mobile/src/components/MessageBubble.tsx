import { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radii, spacing, type } from "@/constants/theme";
import type { ChatMessage, MessageFeedback } from "@/lib/types";
import { MessageContent } from "./MessageContent";

export function MessageBubble({
  message,
  saved,
  streaming = false,
  onFeedback,
  onSave,
  onCardResult,
}: {
  message: ChatMessage;
  saved: boolean;
  /** True while this message is still receiving streamed tokens. */
  streaming?: boolean;
  onFeedback: (feedback: MessageFeedback) => void;
  onSave: () => void;
  /** Sends a learner turn produced by an interactive card in this message. */
  onCardResult: (text: string) => void;
}) {
  if (message.role === "user") {
    return (
      <View style={styles.userRow}>
        <View style={styles.userBubble}>
          <Text selectable style={styles.userText}>{message.content}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.assistantBlock}>
      <Text style={styles.speaker}>KEATING</Text>
      <MessageContent
        messageId={message.id}
        content={message.content}
        streaming={streaming}
        onCardResult={onCardResult}
      />
      {streaming ? <StreamingCaret /> : null}
      <View style={[styles.actions, streaming && styles.actionsHidden]} pointerEvents={streaming ? "none" : "auto"}>
        <FeedbackButton
          label="Helpful"
          selected={message.feedback === "helpful"}
          onPress={() => onFeedback("helpful")}
        />
        <FeedbackButton
          label="Needs work"
          selected={message.feedback === "missed"}
          onPress={() => onFeedback("missed")}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={saved ? "Response saved to library" : "Save response to library"}
          disabled={saved}
          onPress={onSave}
          style={({ pressed }) => [styles.actionButton, pressed && styles.actionPressed, saved && styles.savedButton]}
        >
          <Text style={[styles.actionText, saved && styles.savedText]}>{saved ? "Saved" : "Save note"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** A soft pulsing block that marks where the next token will land. */
function StreamingCaret() {
  const opacity = useRef(new Animated.Value(0.25)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 520, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.25, duration: 520, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return <Animated.View accessibilityLabel="Keating is responding" style={[styles.caret, { opacity }]} />;
}

function FeedbackButton({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.actionButton, selected && styles.selectedButton, pressed && styles.actionPressed]}
    >
      <Text style={[styles.actionText, selected && styles.selectedText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  userRow: { alignItems: "flex-end", marginVertical: spacing.md },
  userBubble: {
    maxWidth: "88%",
    borderRadius: radii.lg,
    borderBottomRightRadius: radii.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.userBubble,
  },
  userText: { ...type.body, color: colors.text },
  assistantBlock: { paddingVertical: spacing.lg },
  speaker: { ...type.caption, ...type.mono, color: colors.primary, fontWeight: "700", marginBottom: spacing.sm },
  caret: { width: 9, height: 18, marginTop: spacing.xs, borderRadius: 2, backgroundColor: colors.primary },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.lg },
  actionsHidden: { display: "none" },
  actionButton: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionPressed: { backgroundColor: colors.surfacePressed },
  selectedButton: { borderColor: colors.primaryStrong, backgroundColor: colors.surfaceRaised },
  savedButton: { borderColor: colors.border, opacity: 0.72 },
  actionText: { ...type.caption, color: colors.textMuted, fontWeight: "600" },
  selectedText: { color: colors.primary },
  savedText: { color: colors.textMuted },
});

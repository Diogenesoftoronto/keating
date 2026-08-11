import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Image, Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { radii, spacing, useKeatingTheme } from "@/constants/theme";
import type { ChatMessage, MessageFeedback } from "@/lib/types";
import { MessageContent } from "./MessageContent";
import { AgentTrace } from "./AgentTrace";
import { hasOrderedToolTrace } from "@/lib/agent-trace-order";

export function MessageBubble({
  message,
  sessionId,
  saved,
  streaming = false,
  onFeedback,
  onSave,
  onFork,
  forkDisabled = false,
  onCardResult,
}: {
  message: ChatMessage;
  sessionId?: string;
  saved: boolean;
  /** True while this message is still receiving streamed tokens. */
  streaming?: boolean;
  onFeedback: (feedback: MessageFeedback) => void;
  onSave: () => void;
  onFork: () => void;
  forkDisabled?: boolean;
  /** Sends a learner turn produced by an interactive card in this message. */
  onCardResult: (text: string) => Promise<void>;
}) {
  const theme = useKeatingTheme();
  const styles = createStyles(theme);
  if (message.role === "user") {
    return (
      <View style={styles.userRow}>
        <View style={styles.userBubble}>
          {message.attachments?.length ? (
            <View style={styles.userAttachments}>
              {message.attachments.map((attachment) => attachment.kind === "image" && attachment.uri ? (
                <View key={attachment.id} style={styles.userImageAttachment}>
                  <Image
                    accessibilityLabel={`Attached image ${attachment.name}`}
                    accessibilityIgnoresInvertColors
                    source={{ uri: attachment.uri }}
                    style={styles.userImage}
                    resizeMode="cover"
                  />
                  <Text numberOfLines={1} style={styles.userAttachmentName}>{attachment.name}</Text>
                </View>
              ) : (
                <View key={attachment.id} style={styles.userDocumentAttachment}>
                  <Ionicons
                    name={attachment.localState === "missing" ? "cloud-offline-outline" : "document-text-outline"}
                    size={18}
                    color={theme.colors.primaryText}
                  />
                  <View style={styles.userAttachmentCopy}>
                    <Text numberOfLines={1} style={styles.userAttachmentName}>{attachment.name}</Text>
                    {attachment.localState === "missing" ? (
                      <Text style={styles.userAttachmentMissing}>File not on this device</Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          ) : null}
          {message.content ? <Text selectable style={styles.userText}>{message.content}</Text> : null}
        </View>
      </View>
    );
  }

  const orderedTrace = hasOrderedToolTrace(message.agentEvents);

  return (
    <View style={styles.assistantBlock}>
      <Text style={styles.speaker}>KEATING</Text>
      {message.agentEvents?.length ? (
        <AgentTrace
          events={message.agentEvents}
          streaming={streaming}
          sessionId={sessionId}
          messageId={message.id}
          ordered={orderedTrace}
          onLearnerTurn={onCardResult}
        />
      ) : null}
      {!orderedTrace ? (
        <MessageContent
          messageId={message.id}
          content={message.content}
          streaming={streaming}
          onCardResult={onCardResult}
        />
      ) : null}
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fork lesson from this response"
          accessibilityState={{ disabled: forkDisabled }}
          disabled={forkDisabled}
          onPress={onFork}
          style={({ pressed }) => [styles.actionButton, pressed && styles.actionPressed, forkDisabled && styles.actionDisabled]}
        >
          <Text style={styles.actionText}>Fork here</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** A soft pulsing block that marks where the next token will land. */
function StreamingCaret() {
  const styles = createStyles(useKeatingTheme());
  const opacity = useRef(new Animated.Value(0.25)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(1);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 520, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.25, duration: 520, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reduceMotion]);

  return <Animated.View accessibilityLabel="Keating is responding" style={[styles.caret, { opacity }]} />;
}

function FeedbackButton({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const styles = createStyles(useKeatingTheme());
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

function createStyles(theme: ReturnType<typeof useKeatingTheme>) {
  const { colors, type } = theme;
  return StyleSheet.create({
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
  userAttachments: { gap: spacing.sm, marginBottom: spacing.sm },
  userImageAttachment: { gap: spacing.xs },
  userImage: { width: 200, maxWidth: "100%", height: 132, borderRadius: radii.sm, backgroundColor: colors.surfacePressed },
  userDocumentAttachment: {
    minHeight: 44,
    maxWidth: 240,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surfaceRaised,
  },
  userAttachmentCopy: { flex: 1, minWidth: 0 },
  userAttachmentName: { ...type.caption, ...type.monoBold, flexShrink: 1, color: colors.text },
  userAttachmentMissing: { ...type.caption, color: colors.textMuted, marginTop: 1 },
  assistantBlock: { paddingVertical: spacing.lg },
  speaker: { ...type.caption, ...type.monoBold, color: colors.primaryText, marginBottom: spacing.sm },
  caret: { width: 9, height: 18, marginTop: spacing.xs, borderRadius: 2, backgroundColor: colors.primary },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.lg },
  actionsHidden: { display: "none" },
  actionButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionPressed: { backgroundColor: colors.surfacePressed },
  selectedButton: { borderColor: colors.primaryStrong, backgroundColor: colors.surfaceRaised },
  savedButton: { borderColor: colors.border, opacity: 0.72 },
  actionDisabled: { opacity: 0.48 },
  actionText: { ...type.caption, color: colors.textMuted, fontWeight: "600" },
  selectedText: { color: colors.primaryText },
  savedText: { color: colors.textMuted },
  });
}

import { useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Button } from "@/components/Buttons";
import { MessageBubble } from "@/components/MessageBubble";
import { Screen } from "@/components/Screen";
import { colors, radii, spacing, type } from "@/constants/theme";
import { providerDefinition } from "@/lib/provider-config";
import type { ChatMessage } from "@/lib/types";
import { useKeating } from "@/state/KeatingProvider";

const QUICK_STARTS = [
  { label: "Learn a topic", prompt: "Help me learn a topic. Start by asking what I already understand." },
  { label: "Build a study plan", prompt: "Build me a concise study plan. Ask for the subject and my time horizon first." },
  { label: "Quiz me", prompt: "Quiz me on something I am learning. Ask for the topic, then give one question at a time." },
  { label: "Repair a misconception", prompt: "Help me find and repair a misconception. Ask me to explain the idea in my own words first." },
] as const;

export default function TutorScreen() {
  const router = useRouter();
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const [draft, setDraft] = useState("");
  const {
    state,
    activeSession,
    isGenerating,
    streamingMessageId,
    generationError,
    storageError,
    isProviderConfigured,
    sendMessage,
    retryLastResponse,
    stopGeneration,
    newSession,
    setMessageFeedback,
    saveArtifact,
  } = useKeating();

  const savedMessageIds = useMemo(() => new Set(state.artifacts.map((artifact) => artifact.messageId)), [state.artifacts]);
  const provider = providerDefinition(state.providerSettings.provider);

  // The streaming placeholder is empty until the first token lands; hide it so
  // the waiting state reads as one indicator rather than a blank bubble.
  const visibleMessages = useMemo(
    () => activeSession.messages.filter((message) => message.content.length > 0),
    [activeSession.messages],
  );
  const awaitingFirstToken = isGenerating
    && activeSession.messages.some((message) => message.id === streamingMessageId && message.content.length === 0);

  const submit = () => {
    const content = draft.trim();
    if (!content || isGenerating) return;
    setDraft("");
    void sendMessage(content);
  };

  const startPrompt = (prompt: string) => {
    if (!isProviderConfigured) {
      router.push("/settings");
      return;
    }
    void sendMessage(prompt);
  };

  return (
    <Screen scroll={false} contentContainerStyle={styles.screenContent}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.wordmark}>KEATING</Text>
            <Text numberOfLines={1} style={styles.sessionTitle}>{activeSession.title}</Text>
          </View>
          <Button compact variant="secondary" onPress={() => newSession()} accessibilityLabel="Start a new lesson">
            New lesson
          </Button>
        </View>

        {storageError ? <Banner tone="error" text={`Local storage: ${storageError}`} /> : null}
        {generationError ? (
          <View style={styles.errorBanner} accessibilityRole="alert">
            <Text style={styles.errorText}>{generationError}</Text>
            <View style={styles.errorActions}>
              <Button compact variant="quiet" onPress={() => void retryLastResponse()}>Retry response</Button>
              <Button compact variant="quiet" onPress={() => router.push("/settings")}>Open settings</Button>
            </View>
          </View>
        ) : null}

        <FlatList
          ref={listRef}
          style={styles.messageList}
          contentContainerStyle={[styles.messageContent, visibleMessages.length === 0 && styles.emptyMessageContent]}
          data={visibleMessages}
          keyExtractor={(message) => message.id}
          keyboardShouldPersistTaps="handled"
          // Streaming resizes the list every flush, so follow it without
          // animation to avoid queued, stuttering scrolls.
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: !streamingMessageId })}
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              saved={savedMessageIds.has(item.id)}
              streaming={item.id === streamingMessageId}
              onFeedback={(feedback) => setMessageFeedback(item.id, feedback)}
              onSave={() => saveArtifact(item.id)}
              onCardResult={(text) => void sendMessage(text)}
            />
          )}
          ListEmptyComponent={(
            <View style={styles.intro}>
              <Text style={styles.introMark}>✦</Text>
              <Text style={styles.introTitle}>What are you trying to understand?</Text>
              <Text style={styles.introBody}>
                Keating will ask what you know, find the missing bridge, and keep you doing the thinking.
              </Text>
              {!isProviderConfigured ? (
                <View style={styles.setupCallout}>
                  <Text style={styles.setupTitle}>Connect {provider.label} to begin</Text>
                  <Text style={styles.setupBody}>Your key stays in Android Keystore and requests go directly to the provider.</Text>
                  <Button onPress={() => router.push("/settings")}>Configure provider</Button>
                </View>
              ) : null}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.quickStarts}
              >
                {QUICK_STARTS.map((item) => (
                  <Pressable
                    key={item.label}
                    accessibilityRole="button"
                    onPress={() => startPrompt(item.prompt)}
                    style={({ pressed }) => [styles.quickStart, pressed && styles.quickStartPressed]}
                  >
                    <Text style={styles.quickStartText}>{item.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}
          ListFooterComponent={awaitingFirstToken ? <ThinkingIndicator /> : null}
        />

        <View style={styles.composer}>
          <TextInput
            accessibilityLabel="Message Keating"
            placeholder={isProviderConfigured ? "Ask, explain, or paste what you are working on…" : "Configure a provider to begin"}
            placeholderTextColor={colors.textFaint}
            editable={isProviderConfigured && !isGenerating}
            multiline
            maxLength={12_000}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={submit}
            blurOnSubmit={false}
            style={styles.input}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isGenerating ? "Stop response" : "Send message"}
            disabled={!isGenerating && (!draft.trim() || !isProviderConfigured)}
            onPress={isGenerating ? stopGeneration : submit}
            style={({ pressed }) => [
              styles.sendButton,
              pressed && styles.sendPressed,
              !isGenerating && (!draft.trim() || !isProviderConfigured) && styles.sendDisabled,
            ]}
          >
            <Text style={styles.sendText}>{isGenerating ? "■" : "↑"}</Text>
          </Pressable>
        </View>
        <Text style={styles.modelLabel}>{provider.label} · {state.providerSettings.model}</Text>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function ThinkingIndicator() {
  return (
    <View style={styles.thinking} accessibilityLabel="Keating is thinking">
      <Text style={styles.thinkingMark}>✦</Text>
      <Text style={styles.thinkingText}>Building the next bridge…</Text>
    </View>
  );
}

function Banner({ text, tone }: { text: string; tone: "error" }) {
  return <View style={[styles.banner, tone === "error" && styles.errorBanner]}><Text style={styles.errorText}>{text}</Text></View>;
}

const styles = StyleSheet.create({
  screenContent: { paddingTop: spacing.sm, paddingBottom: spacing.sm },
  keyboardView: { flex: 1 },
  header: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  wordmark: { ...type.mono, color: colors.primary, fontSize: 14, lineHeight: 18, fontWeight: "800", letterSpacing: 1.8 },
  sessionTitle: { ...type.caption, color: colors.textMuted, marginTop: 2 },
  banner: { padding: spacing.md, borderRadius: radii.md, marginTop: spacing.sm },
  errorBanner: {
    padding: spacing.md,
    marginTop: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.errorSurface,
    borderWidth: 1,
    borderColor: "#63322e",
  },
  errorText: { ...type.caption, color: colors.error },
  errorActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm },
  messageList: { flex: 1 },
  messageContent: { paddingVertical: spacing.md },
  emptyMessageContent: { flexGrow: 1, justifyContent: "center" },
  intro: { alignItems: "center", paddingVertical: spacing.xl },
  introMark: { ...type.mono, color: colors.primary, fontSize: 36 },
  introTitle: { ...type.title, color: colors.text, textAlign: "center", marginTop: spacing.md },
  introBody: { ...type.body, color: colors.textMuted, textAlign: "center", maxWidth: 520, marginTop: spacing.sm },
  setupCallout: {
    width: "100%",
    maxWidth: 480,
    gap: spacing.md,
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  setupTitle: { ...type.heading, color: colors.text },
  setupBody: { ...type.body, color: colors.textMuted },
  quickStarts: { gap: spacing.sm, paddingTop: spacing.xl, paddingHorizontal: spacing.xs },
  quickStart: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickStartPressed: { backgroundColor: colors.surfacePressed, borderColor: colors.borderStrong },
  quickStartText: { ...type.label, color: colors.text },
  thinking: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.lg },
  thinkingMark: { ...type.mono, color: colors.primary, fontSize: 18 },
  thinkingText: { ...type.body, color: colors.textMuted },
  composer: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    ...type.body,
    flex: 1,
    minHeight: 48,
    maxHeight: 128,
    paddingHorizontal: spacing.lg,
    paddingVertical: 11,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    textAlignVertical: "top",
  },
  sendButton: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.primary,
  },
  sendPressed: { backgroundColor: colors.primaryStrong },
  sendDisabled: { opacity: 0.42 },
  sendText: { color: colors.primaryInk, fontSize: 24, lineHeight: 26, fontWeight: "800" },
  modelLabel: { ...type.caption, color: colors.textFaint, textAlign: "center", paddingTop: spacing.xs },
});

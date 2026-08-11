import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Image,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button } from "@/components/Buttons";
import { Composer } from "@/components/Composer";
import { MessageBubble } from "@/components/MessageBubble";
import { ModelSelectorSheet } from "@/components/ModelSelectorSheet";
import { Screen } from "@/components/Screen";
import { radii, spacing, useKeatingTheme } from "@/constants/theme";
import { providerDefinition } from "@/lib/provider-config";
import {
  MAX_COMPOSER_ATTACHMENTS,
  pickComposerAttachments,
  removeComposerAttachmentFile,
} from "@/lib/composer-attachments";
import { clearComposerDraft, loadComposerDraft, saveComposerDraft } from "@/lib/composer-draft-storage";
import { isChatMessageVisible } from "@/lib/message-visibility";
import { transcribeAudioUri } from "@/lib/speech-to-text";
import type { ChatAttachment, ChatAttachmentKind, ChatMessage } from "@/lib/types";
import { parentSessionTitle } from "@/lib/session-lineage";
import { useKeating } from "@/state/KeatingProvider";
import { useUiSettings } from "@/state/UiSettingsProvider";

const QUICK_STARTS = [
  { label: "Learn a topic", prompt: "Help me learn a topic. Start by asking what I already understand." },
  { label: "Build a study plan", prompt: "Build me a concise study plan. Ask for the subject and my time horizon first." },
  { label: "Quiz me", prompt: "Quiz me on something I am learning. Ask for the topic, then give one question at a time." },
  { label: "Repair a misconception", prompt: "Help me find and repair a misconception. Ask me to explain the idea in my own words first." },
] as const;

export default function TutorScreen() {
  const theme = useKeatingTheme();
  const colors = theme.colors;
  const styles = createStyles(theme);
  const router = useRouter();
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const draftRef = useRef("");
  const attachmentsRef = useRef<ChatAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [draftReadySessionId, setDraftReadySessionId] = useState<string | null>(null);
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
  const { settings: uiSettings, updateSettings } = useUiSettings();
  const {
    state,
    activeSession,
    hydrated,
    isGenerating,
    streamingMessageId,
    generationError,
    storageError,
    isProviderConfigured,
    supportsReasoning,
    reasoningLevels,
    sendMessage,
    retryLastResponse,
    stopGeneration,
    newSession,
    forkSession,
    selectSession,
    selectProviderModel,
    setMessageFeedback,
    saveArtifact,
  } = useKeating();

  const savedMessageIds = useMemo(() => new Set(state.artifacts.map((artifact) => artifact.messageId)), [state.artifacts]);
  const provider = providerDefinition(state.providerSettings.provider);
  const forkParentTitle = parentSessionTitle(activeSession, state.sessions);
  const swipeToSessions = useMemo(
    () => PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) => (
        gesture.dx < -12
        && Math.abs(gesture.dx) > Math.abs(gesture.dy)
      ),
      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dx <= -72 && Math.abs(gesture.dy) <= 48) router.push("/sessions");
      },
    }),
    [router],
  );

  // The streaming placeholder is empty until the first token lands; hide it so
  // the waiting state reads as one indicator rather than a blank bubble.
  const visibleMessages = useMemo(
    () => activeSession.messages.filter(isChatMessageVisible),
    [activeSession.messages],
  );
  const awaitingFirstToken = isGenerating
    && activeSession.messages.some((message) => message.id === streamingMessageId && message.content.length === 0);

  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);

  useEffect(() => {
    if (!hydrated) return undefined;
    let cancelled = false;
    setDraftReadySessionId(null);
    void loadComposerDraft(activeSession.id).then((saved) => {
      if (cancelled) return;
      setDraft(saved.text);
      setAttachments(saved.attachments);
      draftRef.current = saved.text;
      attachmentsRef.current = saved.attachments;
      setAttachmentError(null);
      setDraftReadySessionId(activeSession.id);
    }).catch((error) => {
      if (cancelled) return;
      setAttachmentError(error instanceof Error ? error.message : "Could not restore this draft.");
      setDraftReadySessionId(activeSession.id);
    });
    return () => { cancelled = true; };
  }, [activeSession.id, hydrated]);

  useEffect(() => {
    if (!hydrated) return undefined;
    const sessionId = activeSession.id;
    return () => {
      void saveComposerDraft(sessionId, {
        text: draftRef.current,
        attachments: attachmentsRef.current,
      });
    };
  }, [activeSession.id, hydrated]);

  useEffect(() => {
    if (draftReadySessionId !== activeSession.id) return undefined;
    const timer = setTimeout(() => {
      void saveComposerDraft(activeSession.id, { text: draft, attachments }).catch((error) => {
        setAttachmentError(error instanceof Error ? error.message : "Could not save this draft.");
      });
    }, 180);
    return () => clearTimeout(timer);
  }, [activeSession.id, attachments, draft, draftReadySessionId]);

  const submit = () => {
    const content = draft.trim();
    if ((!content && attachments.length === 0) || isGenerating || attachmentBusy) return;
    const sentAttachments = attachments;
    draftRef.current = "";
    attachmentsRef.current = [];
    setDraft("");
    setAttachments([]);
    setAttachmentError(null);
    void clearComposerDraft(activeSession.id);
    void sendMessage(content, sentAttachments);
  };

  const addAttachments = async (kind: ChatAttachmentKind) => {
    setAttachmentBusy(true);
    setAttachmentError(null);
    try {
      const added = await pickComposerAttachments({
        kind,
        remainingSlots: MAX_COMPOSER_ATTACHMENTS - attachments.length,
        existingBytes: attachments.reduce((total, attachment) => total + attachment.size, 0),
      });
      if (added.length) setAttachments((current) => {
        const next = [...current, ...added];
        attachmentsRef.current = next;
        return next;
      });
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "Could not attach that file.");
    } finally {
      setAttachmentBusy(false);
    }
  };

  const removeAttachment = (attachment: ChatAttachment) => {
    try {
      removeComposerAttachmentFile(attachment);
      setAttachments((current) => {
        const next = current.filter((entry) => entry.id !== attachment.id);
        attachmentsRef.current = next;
        return next;
      });
      setAttachmentError(null);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : `Could not remove ${attachment.name}.`);
    }
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
        <View {...swipeToSessions.panHandlers} style={styles.header}>
          <View style={styles.headerCopy}>
            <View style={styles.headerIdentityRow}>
              <Image accessibilityLabel="Keating" source={require("../../../assets/brand/logo-lockup.png")} style={styles.headerLockup} resizeMode="contain" />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Change model. Current model: ${provider.label} ${state.providerSettings.model}`}
                onPress={() => setModelSelectorOpen(true)}
                style={({ pressed }) => [styles.modelButton, pressed && styles.modelButtonPressed]}
              >
                <Text numberOfLines={1} style={styles.modelButtonLabel}>
                  {provider.label} · {state.providerSettings.model}
                </Text>
                <Ionicons name="chevron-down" size={14} color={colors.textFaint} />
              </Pressable>
            </View>
            {activeSession.title !== "New lesson" ? (
              <Text numberOfLines={1} style={styles.sessionTitle}>{activeSession.title}</Text>
            ) : null}
          </View>
              <Button compact variant="secondary" onPress={() => {
                for (const attachment of attachments) removeComposerAttachmentFile(attachment);
                attachmentsRef.current = [];
                draftRef.current = "";
                setAttachments([]);
                setDraft("");
                setAttachmentError(null);
                void clearComposerDraft(activeSession.id);
                newSession();
              }} accessibilityLabel="Start a new lesson">
            New lesson
          </Button>
        </View>

        {storageError ? <Banner styles={styles} text={`Local storage: ${storageError}`} /> : null}
        {activeSession.parentSessionId ? (
          <View style={styles.forkBanner}>
            <View style={styles.forkCopy}>
              <Text style={styles.forkLabel}>Forked from</Text>
              <Text numberOfLines={1} style={styles.forkTitle}>{forkParentTitle}</Text>
            </View>
            {state.sessions.some((session) => session.id === activeSession.parentSessionId) ? (
              <Button compact variant="quiet" onPress={() => selectSession(activeSession.parentSessionId!)}>Open original</Button>
            ) : null}
          </View>
        ) : null}
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
              sessionId={activeSession.id}
              saved={savedMessageIds.has(item.id)}
              streaming={item.id === streamingMessageId}
              onFeedback={(feedback) => setMessageFeedback(item.id, feedback)}
              onSave={() => saveArtifact(item.id)}
              onFork={() => forkSession(activeSession.id, item.id)}
              forkDisabled={isGenerating}
              onCardResult={(text) => sendMessage(text)}
            />
          )}
          ListEmptyComponent={(
            <View style={styles.intro}>
              <Image accessibilityLabel="Keating" source={require("../../../assets/brand/logo-lockup.png")} style={styles.introLockup} resizeMode="contain" />
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
          ListFooterComponent={awaitingFirstToken ? <ThinkingIndicator styles={styles} /> : null}
        />

        <Composer
          value={draft}
          onChangeText={setDraft}
          onSubmit={submit}
          onStop={stopGeneration}
          isGenerating={isGenerating}
          enabled={isProviderConfigured}
          placeholder={isProviderConfigured ? "Message Keating" : "Configure a provider to begin"}
          modelLabel={`${provider.label} · ${state.providerSettings.model}`}
          onSelectModel={() => setModelSelectorOpen(true)}
          supportsReasoning={supportsReasoning}
          reasoningLevels={reasoningLevels}
          reasoningLevel={uiSettings.reasoningLevel}
          onReasoningLevelChange={(reasoningLevel) => updateSettings({ reasoningLevel })}
          onStartLive={() => router.push("/live")}
          onTranscribeAudio={(uri, mimeType) => transcribeAudioUri(uri, mimeType, state.providerSettings.provider)}
          attachments={attachments}
          attachmentError={attachmentError}
          attachmentBusy={attachmentBusy}
          onAddImages={() => void addAttachments("image")}
          onAddDocuments={() => void addAttachments("document")}
          onRemoveAttachment={removeAttachment}
        />

        <ModelSelectorSheet
          visible={modelSelectorOpen}
          current={state.providerSettings}
          selectionDisabled={isGenerating}
          onClose={() => setModelSelectorOpen(false)}
          onSelect={(model) => {
            selectProviderModel(model);
            setModelSelectorOpen(false);
          }}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

function ThinkingIndicator({ styles }: { styles: ReturnType<typeof createStyles> }) {
  return (
    <View style={styles.thinking} accessibilityLabel="Keating is thinking">
      <Image
        accessibilityIgnoresInvertColors
        source={require("../../../assets/brand/mascot-head-v2.png")}
        style={styles.thinkingMascot}
        resizeMode="contain"
      />
      <Text style={styles.thinkingText}>Building the next bridge…</Text>
    </View>
  );
}

function Banner({ text, styles }: { text: string; styles: ReturnType<typeof createStyles> }) {
  return <View style={[styles.banner, styles.errorBanner]}><Text style={styles.errorText}>{text}</Text></View>;
}

function createStyles(theme: ReturnType<typeof useKeatingTheme>) {
  const { colors, type } = theme;
  return StyleSheet.create({
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
  headerIdentityRow: { minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  headerLockup: { width: 106, height: 28 },
  modelButton: {
    minWidth: 0,
    maxWidth: 152,
    minHeight: 44,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
  },
  modelButtonPressed: { backgroundColor: colors.surfacePressed },
  modelButtonLabel: { ...type.caption, minWidth: 0, flexShrink: 1, color: colors.textMuted },
  sessionTitle: { ...type.caption, color: colors.textMuted, marginTop: 2 },
  banner: { padding: spacing.md, borderRadius: radii.md, marginTop: spacing.sm },
  errorBanner: {
    padding: spacing.md,
    marginTop: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.errorSurface,
    borderWidth: 1,
    borderColor: colors.error,
  },
  errorText: { ...type.caption, color: colors.error },
  errorActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm },
  forkBanner: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingLeft: spacing.md,
    marginTop: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
  },
  forkCopy: { flex: 1, minWidth: 0 },
  forkLabel: { ...type.caption, ...type.monoBold, color: colors.primaryText, textTransform: "uppercase" },
  forkTitle: { ...type.caption, color: colors.textMuted, marginTop: 2 },
  messageList: { flex: 1 },
  messageContent: { paddingVertical: spacing.md },
  emptyMessageContent: { flexGrow: 1, justifyContent: "center" },
  intro: { alignItems: "center", paddingVertical: spacing.xl },
  introLockup: { width: 156, height: 72, marginBottom: spacing.sm },
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
  thinkingMascot: { width: 40, height: 40 },
  thinkingText: { ...type.body, color: colors.textMuted },
  });
}

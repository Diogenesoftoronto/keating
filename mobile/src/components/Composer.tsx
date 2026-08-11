import Ionicons from "@expo/vector-icons/Ionicons";
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import { useRef, useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { radii, spacing, useKeatingTheme } from "@/constants/theme";
import type { ChatAttachment } from "@/lib/types";
import { REASONING_LEVEL_OPTIONS, type ReasoningLevel } from "@/lib/ui-settings";

interface ComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  isGenerating: boolean;
  /** False while no provider credential is stored; the input stays read-only. */
  enabled: boolean;
  placeholder: string;
  modelLabel: string;
  onSelectModel: () => void;
  /** The thinking control is hidden for models that reject the parameter. */
  supportsReasoning: boolean;
  reasoningLevels: readonly ReasoningLevel[];
  reasoningLevel: ReasoningLevel;
  onReasoningLevelChange: (level: ReasoningLevel) => void;
  /** Opens a live voice session against this conversation. */
  onStartLive: () => void;
  /** Transcribes an app-cache audio recording and returns editable prompt text. */
  onTranscribeAudio: (uri: string, mimeType: string) => Promise<string>;
  attachments: readonly ChatAttachment[];
  attachmentError: string | null;
  attachmentBusy: boolean;
  onAddImages: () => void;
  onAddDocuments: () => void;
  onRemoveAttachment: (attachment: ChatAttachment) => void;
}

/**
 * The chat composer, matching the web build: a bordered card holding an
 * actions menu, the input, and a single send-or-stop control, with the
 * teaching reminder sitting underneath.
 */
export function Composer({
  value,
  onChangeText,
  onSubmit,
  onStop,
  isGenerating,
  enabled,
  placeholder,
  modelLabel,
  onSelectModel,
  supportsReasoning,
  reasoningLevels,
  reasoningLevel,
  onReasoningLevelChange,
  onStartLive,
  onTranscribeAudio,
  attachments,
  attachmentError,
  attachmentBusy,
  onAddImages,
  onAddDocuments,
  onRemoveAttachment,
}: ComposerProps) {
  const theme = useKeatingTheme();
  const { colors } = theme;
  const styles = createStyles(theme);
  const [menuOpen, setMenuOpen] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [dictationPhase, setDictationPhase] = useState<"idle" | "starting" | "recording" | "transcribing">("idle");
  const [dictationError, setDictationError] = useState<string | null>(null);
  const lastRecordingRef = useRef<string | null>(null);
  const startPromiseRef = useRef<Promise<boolean> | null>(null);
  const dictationPhaseRef = useRef(dictationPhase);
  const holdModeRef = useRef(false);
  const ignoreNextPressRef = useRef(false);
  const sendDisabled = !isGenerating && ((!value.trim() && attachments.length === 0) || !enabled || attachmentBusy);

  const setPhase = (phase: typeof dictationPhase) => {
    dictationPhaseRef.current = phase;
    setDictationPhase(phase);
  };
  const appendTranscript = (text: string) => {
    const transcript = text.trim();
    if (transcript) onChangeText(value.trim() ? `${value.trimEnd()} ${transcript}` : transcript);
  };
  const beginDictation = (): Promise<boolean> => {
    if (dictationPhaseRef.current !== "idle") return Promise.resolve(false);
    setDictationError(null);
    setPhase("starting");
    const pending = (async () => {
      try {
        const permission = await requestRecordingPermissionsAsync();
        if (!permission.granted) throw new Error("Microphone permission is required for dictation. Enable it in system settings and retry.");
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        recorder.record({ forDuration: 120 });
        setPhase("recording");
        return true;
      } catch (error) {
        setPhase("idle");
        setDictationError(error instanceof Error ? error.message : "Could not start dictation.");
        return false;
      }
    })();
    startPromiseRef.current = pending;
    return pending;
  };
  const transcribeRecording = async (uri: string) => {
    setPhase("transcribing");
    setDictationError(null);
    try {
      appendTranscript(await onTranscribeAudio(uri, "audio/mp4"));
      lastRecordingRef.current = null;
      setPhase("idle");
    } catch (error) {
      setPhase("idle");
      setDictationError(error instanceof Error ? error.message : "Could not transcribe that recording.");
    }
  };
  const finishDictation = async () => {
    const started = await startPromiseRef.current;
    startPromiseRef.current = null;
    if (!started || dictationPhaseRef.current !== "recording") return;
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error("The microphone did not create a recording. Try again.");
      lastRecordingRef.current = uri;
      await transcribeRecording(uri);
    } catch (error) {
      setPhase("idle");
      setDictationError(error instanceof Error ? error.message : "Could not finish dictation.");
    } finally {
      void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    }
  };
  const toggleDictation = () => {
    if (ignoreNextPressRef.current) {
      ignoreNextPressRef.current = false;
      return;
    }
    if (dictationPhaseRef.current === "idle") void beginDictation();
    else if (dictationPhaseRef.current === "recording") void finishDictation();
  };

  return (
    <View style={styles.wrapper}>
      <View style={styles.card}>
        {attachments.length ? (
          <ScrollView
            horizontal
            keyboardShouldPersistTaps="handled"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.attachments}
            accessibilityLabel={`${attachments.length} attachment${attachments.length === 1 ? "" : "s"} ready`}
          >
            {attachments.map((attachment) => (
              <AttachmentChip
                key={attachment.id}
                attachment={attachment}
                disabled={isGenerating || attachmentBusy}
                onRemove={() => onRemoveAttachment(attachment)}
              />
            ))}
          </ScrollView>
        ) : null}
        {attachmentError ? (
          <View accessibilityRole="alert" style={styles.attachmentErrorRow}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
            <Text style={styles.attachmentError}>{attachmentError}</Text>
          </View>
        ) : null}
        {dictationError ? (
          <View accessibilityRole="alert" style={styles.attachmentErrorRow}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
            <Text style={styles.attachmentError}>{dictationError}</Text>
            {lastRecordingRef.current ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry transcription"
                onPress={() => void transcribeRecording(lastRecordingRef.current!)}
                style={({ pressed }) => [styles.retryVoice, pressed && styles.iconButtonPressed]}
              >
                <Text style={styles.retryVoiceText}>Retry</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        <View style={styles.row}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="More actions"
            accessibilityState={{ expanded: menuOpen }}
            onPress={() => setMenuOpen(true)}
            style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
          >
            <Ionicons name="add" size={20} color={colors.textMuted} />
          </Pressable>

          <TextInput
            accessibilityLabel="Message Keating"
            placeholder={placeholder}
            placeholderTextColor={colors.textFaint}
            editable={enabled && !isGenerating}
            multiline
            maxLength={12_000}
            value={value}
            onChangeText={onChangeText}
            onSubmitEditing={onSubmit}
            // Enter inserts a newline on a phone; sending is the button's job.
            submitBehavior="newline"
            style={styles.input}
          />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={dictationPhase === "recording" ? "Stop dictation" : dictationPhase === "transcribing" ? "Transcribing audio" : "Dictate a message"}
            accessibilityHint="Tap to start and stop, or hold while speaking"
            accessibilityState={{ busy: dictationPhase === "starting" || dictationPhase === "transcribing", disabled: isGenerating }}
            disabled={isGenerating || dictationPhase === "starting" || dictationPhase === "transcribing"}
            delayLongPress={240}
            onLongPress={() => {
              ignoreNextPressRef.current = true;
              holdModeRef.current = true;
              void beginDictation();
            }}
            onPressOut={() => {
              if (!holdModeRef.current) return;
              holdModeRef.current = false;
              void finishDictation();
            }}
            onPress={toggleDictation}
            style={({ pressed }) => [styles.iconButton, dictationPhase === "recording" && styles.recordingButton, pressed && styles.iconButtonPressed]}
          >
            <Ionicons name={dictationPhase === "recording" ? "stop" : "mic-outline"} size={19} color={dictationPhase === "recording" ? colors.error : colors.textMuted} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start a live conversation"
            accessibilityHint="Opens Keating Live"
            onPress={onStartLive}
            style={({ pressed }) => [styles.iconButton, styles.liveButton, pressed && styles.livePressed]}
          >
            <Ionicons name="pulse" size={19} color={colors.primaryInk} />
            <Text style={styles.liveLabel}>Live</Text>
          </Pressable>

          {/* Send or stop — never both, so the control never shifts position. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isGenerating ? "Stop response" : "Send message"}
            disabled={sendDisabled}
            onPress={isGenerating ? onStop : onSubmit}
            style={({ pressed }) => [
              styles.iconButton,
              isGenerating ? styles.stopButton : styles.sendButton,
              pressed && (isGenerating ? styles.stopPressed : styles.sendPressed),
              sendDisabled && styles.sendDisabled,
            ]}
          >
            <Ionicons
              name={isGenerating ? "square" : "arrow-up"}
              size={isGenerating ? 14 : 20}
              color={isGenerating ? colors.error : colors.primaryInk}
            />
          </Pressable>
        </View>
      </View>

      <Text style={styles.hint}>
        keating won&apos;t give you the answer — <Text style={styles.hintAccent}>that&apos;s the point</Text>
      </Text>

      <ActionSheet
        visible={menuOpen}
        title="Composer"
        onClose={() => setMenuOpen(false)}
      >
        <SheetItem
          icon="image-outline"
          label="Add images"
          value="Photos and diagrams, up to 8 MB each"
          disabled={isGenerating || attachmentBusy}
          onPress={() => {
            setMenuOpen(false);
            onAddImages();
          }}
        />
        <SheetItem
          icon="document-attach-outline"
          label="Add documents"
          value="PDF, text, Markdown, code, CSV, or JSON"
          disabled={isGenerating || attachmentBusy}
          onPress={() => {
            setMenuOpen(false);
            onAddDocuments();
          }}
        />
        <SheetItem
          icon="cube-outline"
          label="Model"
          value={modelLabel}
          onPress={() => {
            setMenuOpen(false);
            onSelectModel();
          }}
        />
        {supportsReasoning ? (
          <SheetItem
            icon="bulb-outline"
            label="Thinking"
            value={reasoningLabel(reasoningLevel)}
            disabled={isGenerating}
            onPress={() => {
              setMenuOpen(false);
              setThinkingOpen(true);
            }}
          />
        ) : null}
      </ActionSheet>

      <ActionSheet
        visible={thinkingOpen}
        title="Thinking budget"
        onClose={() => setThinkingOpen(false)}
      >
        {REASONING_LEVEL_OPTIONS.filter((option) => reasoningLevels.includes(option.value)).map((option) => (
          <SheetItem
            key={option.value}
            icon={option.value === reasoningLevel ? "radio-button-on" : "radio-button-off"}
            label={option.label}
            value={option.description}
            selected={option.value === reasoningLevel}
            onPress={() => {
              onReasoningLevelChange(option.value);
              setThinkingOpen(false);
            }}
          />
        ))}
      </ActionSheet>
    </View>
  );
}

function AttachmentChip({
  attachment,
  disabled,
  onRemove,
}: {
  attachment: ChatAttachment;
  disabled: boolean;
  onRemove: () => void;
}) {
  const theme = useKeatingTheme();
  const styles = createStyles(theme);
  return (
    <View style={styles.attachmentChip}>
      {attachment.kind === "image" && attachment.uri ? (
        <Image accessibilityIgnoresInvertColors source={{ uri: attachment.uri }} style={styles.attachmentPreview} />
      ) : (
        <View style={styles.attachmentDocumentIcon}>
          <Ionicons name="document-text-outline" size={18} color={theme.colors.primaryText} />
        </View>
      )}
      <View style={styles.attachmentCopy}>
        <Text numberOfLines={1} style={styles.attachmentName}>{attachment.name}</Text>
        <Text style={styles.attachmentMeta}>{formatAttachmentSize(attachment.size)}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${attachment.name}`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onRemove}
        hitSlop={4}
        style={({ pressed }) => [styles.attachmentRemove, pressed && styles.iconButtonPressed]}
      >
        <Ionicons name="close" size={17} color={theme.colors.textMuted} />
      </Pressable>
    </View>
  );
}

function formatAttachmentSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function reasoningLabel(level: ReasoningLevel): string {
  return REASONING_LEVEL_OPTIONS.find((option) => option.value === level)?.label ?? level;
}

function ActionSheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const styles = createStyles(useKeatingTheme());
  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Close ${title}`} style={styles.scrim} onPress={onClose} />
        <View accessibilityViewIsModal accessibilityLabel={title} style={styles.sheet}>
          <Text style={styles.sheetTitle}>{title}</Text>
          {children}
        </View>
      </View>
    </Modal>
  );
}

function SheetItem({
  icon,
  label,
  value,
  onPress,
  selected = false,
  disabled = false,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  value?: string;
  onPress: () => void;
  selected?: boolean;
  disabled?: boolean;
}) {
  const theme = useKeatingTheme();
  const styles = createStyles(theme);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.sheetItem, pressed && styles.sheetItemPressed, disabled && styles.sheetItemDisabled]}
    >
      <Ionicons name={icon} size={18} color={selected ? theme.colors.primaryText : theme.colors.textMuted} />
      <View style={styles.sheetItemCopy}>
        <Text style={[styles.sheetItemLabel, selected && styles.sheetItemLabelSelected]}>{label}</Text>
        {value ? <Text numberOfLines={1} style={styles.sheetItemValue}>{value}</Text> : null}
      </View>
    </Pressable>
  );
}

function createStyles(theme: ReturnType<typeof useKeatingTheme>) {
  const { colors, type } = theme;
  return StyleSheet.create({
    wrapper: { paddingTop: spacing.sm },
    card: {
      flexDirection: "column",
      gap: spacing.sm,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      padding: spacing.sm,
    },
    attachments: { flexDirection: "row", gap: spacing.sm, paddingBottom: spacing.xs },
    attachmentChip: {
      width: 220,
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      borderRadius: radii.sm,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceRaised,
      paddingLeft: spacing.xs,
    },
    attachmentPreview: { width: 40, height: 40, borderRadius: radii.sm, backgroundColor: colors.surfacePressed },
    attachmentDocumentIcon: {
      width: 40,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radii.sm,
      backgroundColor: colors.surfacePressed,
    },
    attachmentCopy: { flex: 1, minWidth: 0 },
    attachmentName: { ...type.caption, ...type.monoBold, color: colors.text },
    attachmentMeta: { ...type.caption, color: colors.textMuted },
    attachmentRemove: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radii.sm },
    attachmentErrorRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.xs, paddingHorizontal: spacing.xs },
    attachmentError: { ...type.caption, flex: 1, color: colors.error },
    retryVoice: { minWidth: 52, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: radii.sm },
    retryVoiceText: { ...type.label, color: colors.primaryText },
    row: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
    iconButton: {
      width: 44,
      height: 44,
      flexShrink: 0,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radii.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    iconButtonPressed: { backgroundColor: colors.surfacePressed },
    input: {
      ...type.body,
      flex: 1,
      minWidth: 0,
      minHeight: 44,
      maxHeight: 160,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      color: colors.text,
      textAlignVertical: "center",
    },
    sendButton: { borderColor: "transparent", backgroundColor: colors.primary },
    sendPressed: { backgroundColor: colors.primaryStrong },
    sendDisabled: { opacity: 0.42 },
    stopButton: { borderWidth: 2, borderColor: colors.error, backgroundColor: "transparent" },
    stopPressed: { backgroundColor: colors.errorSurface },
    recordingButton: { borderWidth: 2, borderColor: colors.error, backgroundColor: colors.errorSurface },
    liveButton: { width: 64, flexDirection: "row", gap: 4, borderColor: "transparent", backgroundColor: colors.primary },
    liveLabel: { ...type.caption, ...type.monoBold, color: colors.primaryInk },
    livePressed: { backgroundColor: colors.primaryStrong },
    hint: { ...type.caption, color: colors.textFaint, paddingTop: spacing.xs, paddingHorizontal: spacing.xs },
    hintAccent: { color: colors.primaryText },
    overlay: { flex: 1, justifyContent: "flex-end" },
    scrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.overlay },
    sheet: {
      width: "100%",
      maxWidth: 760,
      alignSelf: "center",
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.xxl,
      gap: spacing.xs,
      borderTopLeftRadius: radii.lg,
      borderTopRightRadius: radii.lg,
      backgroundColor: colors.background,
      borderTopWidth: 1,
      borderColor: colors.border,
    },
    sheetTitle: { ...type.caption, ...type.mono, color: colors.textMuted, textTransform: "uppercase", marginBottom: spacing.sm },
    sheetItem: {
      minHeight: 56,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      borderRadius: radii.md,
    },
    sheetItemPressed: { backgroundColor: colors.surfacePressed },
    sheetItemDisabled: { opacity: 0.45 },
    sheetItemCopy: { flex: 1 },
    sheetItemLabel: { ...type.label, color: colors.text },
    sheetItemLabelSelected: { color: colors.primaryText },
    sheetItemValue: { ...type.caption, color: colors.textMuted, marginTop: 2 },
  });
}

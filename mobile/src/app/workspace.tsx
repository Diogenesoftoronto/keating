import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Screen } from "@/components/Screen";
import { radii, spacing, useKeatingTheme } from "@/constants/theme";
import { parseMobileWorkspaceProgram } from "@/lib/mobile-workspace/program";
import { useMobileWorkspace } from "@/state/MobileWorkspaceProvider";

export default function WorkspaceScreen() {
  const theme = useKeatingTheme();
  const styles = createStyles(theme);
  const { state, ready, busy, error, proposeSource, activate, rollback, clearError } = useMobileWorkspace();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const selected = state?.files.find((file) => file.path === selectedPath) ?? state?.files[0];
  const [draft, setDraft] = useState("");
  const [intent, setIntent] = useState("Improve my mobile learning workspace");

  useEffect(() => { if (selected && selected.path !== selectedPath) setSelectedPath(selected.path); }, [selected, selectedPath]);
  useEffect(() => { setDraft(selected?.source ?? ""); }, [selected?.path, selected?.source]);
  const pending = useMemo(() => state?.overlays.filter((overlay) => overlay.parentId === state.activeOverlayId && overlay.id !== state.activeOverlayId).at(-1), [state]);
  const dirty = !!selected && draft !== selected.source;

  if (!ready || !state || !selected) {
    return <Screen title="Mobile workspace" subtitle="Opening the local source workspace"><ActivityIndicator color={theme.colors.primaryText} /></Screen>;
  }

  const propose = async () => { if (dirty) await proposeSource(selected.path, draft, intent); };

  return (
    <Screen title="Mobile workspace" subtitle="A visible, bounded program layered over the signed app">
      <View style={styles.metadata}>
        <Status label="Base" value={state.base.id} styles={styles} />
        <Status label="Runtime" value={state.base.runtimeVersion} styles={styles} />
        <Status label="Active" value={state.activeOverlayId ?? "base"} styles={styles} />
      </View>

      {error ? (
        <Pressable accessibilityRole="button" onPress={clearError} style={styles.error}>
          <Ionicons name="warning-outline" size={18} color={theme.colors.error} />
          <Text style={styles.errorText}>{error}</Text>
        </Pressable>
      ) : null}

      <Text style={styles.label}>Source file</Text>
      <View style={styles.fileTabs}>
        {state.files.map((file) => (
          <Pressable key={file.path} onPress={() => setSelectedPath(file.path)} style={[styles.fileTab, selected.path === file.path && styles.fileTabActive]}>
            <Text style={[styles.fileTabText, selected.path === file.path && styles.fileTabTextActive]}>{file.path}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        accessibilityLabel={`Source for ${selected.path}`}
        autoCapitalize="none" autoCorrect={false} multiline
        onChangeText={setDraft} value={draft}
        style={styles.editor} textAlignVertical="top"
      />

      <Text style={styles.label}>Change intent</Text>
      <TextInput accessibilityLabel="Change intent" onChangeText={setIntent} value={intent} style={styles.intent} />

      <View style={styles.actions}>
        <Action label="Save proposal" icon="git-commit-outline" disabled={!dirty || busy || !intent.trim()} onPress={() => void propose()} styles={styles} />
        <Action label="Activate" icon="play-outline" disabled={!pending || busy} onPress={() => pending && void activate(pending.id)} styles={styles} primary />
        <Action label="Roll back" icon="arrow-undo-outline" disabled={!state.activeOverlayId || busy} onPress={() => void rollback()} styles={styles} />
      </View>

      {pending ? <Text style={styles.note}>Pending: {pending.intent} · {pending.id}</Text> : null}
      {state.receipts.at(-1) ? (
        <View style={styles.receipt}>
          <Text style={styles.receiptTitle}>Last activation: {state.receipts.at(-1)!.status}</Text>
          {state.receipts.at(-1)!.checks.map((check) => <Text key={check.id} style={styles.note}>{check.status === "passed" ? "✓" : "×"} {check.message}</Text>)}
        </View>
      ) : null}

      <WorkspacePreview source={selected.source} styles={styles} />
    </Screen>
  );
}

function Status({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.status}><Text style={styles.statusLabel}>{label}</Text><Text numberOfLines={1} style={styles.statusValue}>{value}</Text></View>;
}

function Action({ label, icon, disabled, onPress, primary, styles }: { label: string; icon: React.ComponentProps<typeof Ionicons>["name"]; disabled: boolean; onPress: () => void; primary?: boolean; styles: ReturnType<typeof createStyles> }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button, primary && styles.buttonPrimary, disabled && styles.buttonDisabled]}><Ionicons name={icon} size={16} color={primary ? styles.buttonPrimaryText.color : styles.buttonText.color} /><Text style={primary ? styles.buttonPrimaryText : styles.buttonText}>{label}</Text></Pressable>;
}

function WorkspacePreview({ source, styles }: { source: string; styles: ReturnType<typeof createStyles> }) {
  let title = "Preview unavailable";
  let details = "Activate valid source to preview it.";
  try {
    const program = parseMobileWorkspaceProgram(source);
    const heading = program.screen.children.find((block) => block.type === "heading");
    title = heading?.type === "heading" ? heading.text : "Workspace preview";
    details = `${program.screen.children.length} bounded components · gap ${program.screen.gap}`;
  } catch { /* source remains editable and activation will explain the validation error */ }
  return <View style={styles.preview}><Text style={styles.previewTitle}>{title}</Text><Text style={styles.note}>{details}</Text></View>;
}

function createStyles(theme: ReturnType<typeof useKeatingTheme>) {
  const { colors, type } = theme;
  return StyleSheet.create({
    metadata: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg, marginBottom: spacing.lg },
    status: { minWidth: 92 }, statusLabel: { ...type.caption, color: colors.textMuted }, statusValue: { ...type.mono, fontSize: 12, color: colors.text },
    label: { ...type.label, color: colors.textMuted, marginTop: spacing.md, marginBottom: spacing.xs },
    fileTabs: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginBottom: spacing.sm },
    fileTab: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.sm, borderWidth: 1, borderColor: colors.border },
    fileTabActive: { backgroundColor: colors.surfacePressed },
    fileTabText: { ...type.mono, fontSize: 11, color: colors.textMuted }, fileTabTextActive: { color: colors.text },
    editor: { ...type.mono, minHeight: 280, fontSize: 12, lineHeight: 18, color: colors.text, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.md },
    intent: { ...type.body, color: colors.text, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: spacing.sm },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.lg },
    button: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, paddingHorizontal: spacing.md },
    buttonPrimary: { backgroundColor: colors.primaryText, borderColor: colors.primaryText }, buttonDisabled: { opacity: 0.4 },
    buttonText: { ...type.label, color: colors.text }, buttonPrimaryText: { ...type.label, color: colors.background },
    note: { ...type.caption, color: colors.textMuted, marginTop: spacing.sm },
    receipt: { marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }, receiptTitle: { ...type.label, color: colors.text },
    error: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingVertical: spacing.sm }, errorText: { ...type.body, flex: 1, color: colors.error },
    preview: { marginTop: spacing.xl, paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border }, previewTitle: { ...type.heading, color: colors.text },
  });
}

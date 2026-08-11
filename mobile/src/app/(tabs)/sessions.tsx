import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "@/components/Buttons";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { radii, spacing, useKeatingTheme } from "@/constants/theme";
import { buildSessionTreeRows, parentSessionTitle } from "@/lib/session-lineage";
import type { ChatSession } from "@/lib/types";
import { useKeating } from "@/state/KeatingProvider";

function sessionPreview(session: ChatSession): string {
  const last = session.messages[session.messages.length - 1];
  return last?.content.replace(/\s+/g, " ").trim() || "No messages yet";
}

export default function SessionsScreen() {
  const theme = useKeatingTheme();
  const { colors } = theme;
  const styles = createStyles(theme);
  const router = useRouter();
  const [query, setQuery] = useState("");
  const { state, isGenerating, newSession, forkSession, selectSession, deleteSession } = useKeating();
  const sessionRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return buildSessionTreeRows(state.sessions).filter(({ session }) => {
      const parentTitle = parentSessionTitle(session, state.sessions) ?? "";
      return !normalized || `${session.title} ${sessionPreview(session)} ${parentTitle}`.toLowerCase().includes(normalized);
    });
  }, [query, state.sessions]);

  const openSession = (sessionId: string) => {
    selectSession(sessionId);
    router.replace("/");
  };

  const confirmDelete = (session: ChatSession) => {
    Alert.alert(
      "Delete lesson?",
      `“${session.title}” and its saved notes will be removed from this device.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete lesson", style: "destructive", onPress: () => deleteSession(session.id) },
      ],
    );
  };

  const forkWholeSession = (sessionId: string) => {
    if (!forkSession(sessionId)) return;
    router.replace("/");
  };

  return (
    <Screen
      title="Sessions"
      subtitle={`${state.sessions.length} local lesson${state.sessions.length === 1 ? "" : "s"}`}
      action={<Button compact onPress={() => { newSession(); router.replace("/"); }}>New lesson</Button>}
    >
      <TextInput
        accessibilityLabel="Search lessons"
        placeholder="Search lessons"
        placeholderTextColor={colors.textFaint}
        value={query}
        onChangeText={setQuery}
        style={styles.search}
      />
      <View style={styles.list}>
        {sessionRows.map(({ session, depth }) => (
          <View
            key={session.id}
            style={[
              styles.row,
              session.id === state.activeSessionId && styles.activeRow,
              depth > 0 && { marginLeft: Math.min(depth, 2) * spacing.lg },
            ]}
          >
            <View style={styles.rowCopy}>
              <View style={styles.rowTitleLine}>
                <Text numberOfLines={1} style={styles.rowTitle}>{session.title}</Text>
                {session.id === state.activeSessionId ? <Text style={styles.activeLabel}>CURRENT</Text> : null}
              </View>
              {session.parentSessionId ? (
                <Text numberOfLines={1} style={styles.lineage}>
                  ↳ Forked from {parentSessionTitle(session, state.sessions)}
                </Text>
              ) : null}
              <Text numberOfLines={2} style={styles.preview}>{sessionPreview(session)}</Text>
              <Text style={styles.meta}>{session.messages.length} messages · {new Date(session.updatedAt).toLocaleDateString()}</Text>
            </View>
            <View style={styles.rowActions}>
              <Button
                compact
                variant="secondary"
                accessibilityLabel={`Open lesson ${session.title}`}
                onPress={() => openSession(session.id)}
              >
                Open
              </Button>
              <Button
                compact
                variant="quiet"
                disabled={isGenerating}
                accessibilityLabel={`Fork lesson ${session.title}`}
                onPress={() => forkWholeSession(session.id)}
              >
                Fork
              </Button>
              <Button
                compact
                variant="danger"
                accessibilityLabel={`Delete lesson ${session.title}`}
                onPress={() => confirmDelete(session)}
              >
                Delete
              </Button>
            </View>
          </View>
        ))}
        {sessionRows.length === 0 ? (
          <EmptyState title="No matching lessons" body="Try another search phrase, or start a new lesson." />
        ) : null}
      </View>
    </Screen>
  );
}

function createStyles(theme: ReturnType<typeof useKeatingTheme>) {
  const { colors, type } = theme;
  return StyleSheet.create({
  search: {
    ...type.body,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  list: { gap: spacing.md, marginTop: spacing.lg },
  row: {
    minHeight: 120,
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  activeRow: { borderColor: colors.primaryStrong },
  rowCopy: { minWidth: 0 },
  rowTitleLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rowTitle: { ...type.heading, flex: 1, color: colors.text },
  activeLabel: { ...type.caption, ...type.monoBold, color: colors.primaryText },
  lineage: { ...type.caption, color: colors.primaryText, marginTop: spacing.xs },
  preview: { ...type.body, color: colors.textMuted, marginTop: spacing.sm },
  meta: { ...type.caption, color: colors.textFaint, marginTop: spacing.md },
  rowActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: spacing.sm },
  });
}

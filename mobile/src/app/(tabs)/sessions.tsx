import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "@/components/Buttons";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { colors, radii, spacing, type } from "@/constants/theme";
import type { ChatSession } from "@/lib/types";
import { useKeating } from "@/state/KeatingProvider";

function sessionPreview(session: ChatSession): string {
  const last = session.messages[session.messages.length - 1];
  return last?.content.replace(/\s+/g, " ").trim() || "No messages yet";
}

export default function SessionsScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const { state, newSession, selectSession, deleteSession } = useKeating();
  const sessions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return state.sessions
      .filter((session) => !normalized || `${session.title} ${sessionPreview(session)}`.toLowerCase().includes(normalized))
      .sort((left, right) => right.updatedAt - left.updatedAt);
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
        {sessions.map((session) => (
          <Pressable
            key={session.id}
            accessibilityRole="button"
            accessibilityLabel={`Open lesson ${session.title}`}
            onPress={() => openSession(session.id)}
            style={({ pressed }) => [
              styles.row,
              session.id === state.activeSessionId && styles.activeRow,
              pressed && styles.pressedRow,
            ]}
          >
            <View style={styles.rowCopy}>
              <View style={styles.rowTitleLine}>
                <Text numberOfLines={1} style={styles.rowTitle}>{session.title}</Text>
                {session.id === state.activeSessionId ? <Text style={styles.activeLabel}>OPEN</Text> : null}
              </View>
              <Text numberOfLines={2} style={styles.preview}>{sessionPreview(session)}</Text>
              <Text style={styles.meta}>{session.messages.length} messages · {new Date(session.updatedAt).toLocaleDateString()}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Delete lesson ${session.title}`}
              hitSlop={8}
              onPress={(event) => { event.stopPropagation(); confirmDelete(session); }}
              style={({ pressed }) => [styles.deleteButton, pressed && styles.deletePressed]}
            >
              <Text style={styles.deleteText}>Delete</Text>
            </Pressable>
          </Pressable>
        ))}
        {sessions.length === 0 ? (
          <EmptyState title="No matching lessons" body="Try another search phrase, or start a new lesson." />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
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
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  activeRow: { borderColor: colors.primaryStrong },
  pressedRow: { backgroundColor: colors.surfacePressed },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitleLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rowTitle: { ...type.heading, flex: 1, color: colors.text },
  activeLabel: { ...type.caption, ...type.mono, color: colors.primary, fontWeight: "700" },
  preview: { ...type.body, color: colors.textMuted, marginTop: spacing.sm },
  meta: { ...type.caption, color: colors.textFaint, marginTop: spacing.md },
  deleteButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.sm, borderRadius: radii.sm },
  deletePressed: { backgroundColor: colors.errorSurface },
  deleteText: { ...type.caption, color: colors.error, fontWeight: "600" },
});

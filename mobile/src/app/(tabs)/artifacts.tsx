import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { EmptyState } from "@/components/EmptyState";
import { MarkdownText } from "@/components/MarkdownText";
import { Screen } from "@/components/Screen";
import { radii, spacing, useKeatingTheme } from "@/constants/theme";
import type { GeneratedArtifactKind, StudyArtifact } from "@/lib/types";
import { useKeating } from "@/state/KeatingProvider";
import { Button } from "@/components/Buttons";
import { createMobileNeedleSearch, mobileNeedleArtifactSources } from "@/lib/needle-retrieval";
import { needleDownload } from "@/lib/needle-model";
import { needleQueryText } from "@keating/learner-contracts";

const KIND_LABEL: Record<StudyArtifact["kind"], string> = {
  note: "Study note",
  "study-plan": "Study plan",
  "concept-map": "Concept map",
  quiz: "Quiz",
  explanation: "Explanation",
};

export default function ArtifactsScreen() {
  const theme = useKeatingTheme();
  const { colors } = theme;
  const styles = createStyles(theme);
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { state, createLearningArtifact, deleteArtifact } = useKeating();
  const localModel = useSyncExternalStore(needleDownload.subscribe, needleDownload.snapshot);
  const search = useMemo(() => createMobileNeedleSearch(), []);
  const pending = useRef<AbortController | null>(null);
  const sourceRef = useRef({ query, artifacts: state.artifacts });
  sourceRef.current = { query, artifacts: state.artifacts };
  const [searching, setSearching] = useState(false);
  const [searchNotice, setSearchNotice] = useState("");
  const [semantic, setSemantic] = useState<{ query: string; source: StudyArtifact[]; ids: string[]; considered: number } | null>(null);
  useEffect(() => { void needleDownload.refresh(); }, []);
  useEffect(() => {
    pending.current?.abort();
    setSearching(false); setSearchNotice(""); setSemantic(null);
    return () => { pending.current?.abort(); search.clear(); };
  }, [query, state.artifacts, localModel.phase, search]);
  const artifacts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const lexical = state.artifacts.filter((artifact) => !normalized || `${artifact.title} ${artifact.content}`.toLowerCase().includes(normalized));
    if (!semantic || semantic.query !== query || semantic.source !== state.artifacts || localModel.phase !== "ready") return lexical;
    const selected = semantic.ids.flatMap(id => { const item = state.artifacts.find(item => item.id === id); return item ? [item] : []; });
    return [...selected, ...lexical.filter(item => !semantic.ids.includes(item.id))];
  }, [query, state.artifacts, semantic, localModel.phase]);
  const searchMeaning = async () => {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    const source = state.artifacts, input = query;
    const current = () => pending.current === controller && sourceRef.current.query === input && sourceRef.current.artifacts === source;
    setSearching(true); setSearchNotice("");
    const candidates = mobileNeedleArtifactSources(source);
    const result = await search.search(needleQueryText(input), candidates, { signal: controller.signal, current, limit: 8 });
    if (!current() || controller.signal.aborted) return;
    setSearching(false);
    if (!result) { setSearchNotice("Local search is unavailable. Text matches are still shown."); return; }
    const ids = [...new Set(result.matches.flatMap(row => row.source.artifactId ? [row.source.artifactId] : []))];
    setSemantic({ query: input, source, ids, considered: new Set(candidates.map(row => row.artifactId)).size });
  };

  const copy = async (artifact: StudyArtifact) => {
    await Clipboard.setStringAsync(artifact.content);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const confirmDelete = (artifact: StudyArtifact) => {
    Alert.alert("Delete saved note?", `“${artifact.title}” will be removed from this device.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete note", style: "destructive", onPress: () => deleteArtifact(artifact.id) },
    ]);
  };

  const createArtifact = (kind: GeneratedArtifactKind) => {
    const normalizedTopic = topic.trim();
    if (!normalizedTopic) return;
    const artifactId = createLearningArtifact(normalizedTopic, kind);
    setTopic("");
    setExpandedId(artifactId);
  };

  return (
    <Screen title="Library" subtitle="Responses you chose to keep for review">
      <View style={styles.creator}>
        <Text style={styles.creatorTitle}>Build an offline study artifact</Text>
        <Text style={styles.creatorBody}>
          Plans, maps, and quizzes use the same deterministic Keating engine as the web app. No provider or network is required.
        </Text>
        <TextInput
          accessibilityLabel="Artifact topic"
          placeholder="Topic, for example Bayes' rule"
          placeholderTextColor={colors.textFaint}
          value={topic}
          onChangeText={setTopic}
          returnKeyType="done"
          style={styles.search}
        />
        <View style={styles.creatorActions}>
          <Pressable
            accessibilityRole="button"
            disabled={!topic.trim()}
            onPress={() => createArtifact("study-plan")}
            style={({ pressed }) => [styles.createAction, pressed && styles.actionPressed, !topic.trim() && styles.disabled]}
          >
            <Text style={styles.createActionText}>Build study plan</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={!topic.trim()}
            onPress={() => createArtifact("concept-map")}
            style={({ pressed }) => [styles.createAction, pressed && styles.actionPressed, !topic.trim() && styles.disabled]}
          >
            <Text style={styles.createActionText}>Build concept map</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={!topic.trim()}
            onPress={() => createArtifact("quiz")}
            style={({ pressed }) => [styles.createAction, pressed && styles.actionPressed, !topic.trim() && styles.disabled]}
          >
            <Text style={styles.createActionText}>Build practice quiz</Text>
          </Pressable>
        </View>
      </View>
      {state.artifacts.length > 0 ? (
        <TextInput
          accessibilityLabel="Search saved notes"
          placeholder="Search saved notes"
          placeholderTextColor={colors.textFaint}
          value={query}
          onChangeText={setQuery}
          style={styles.search}
        />
      ) : null}
      {state.artifacts.length > 0 && query.trim() ? (
        <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
          <Button compact variant="secondary" disabled={searching || localModel.phase !== "ready"} onPress={() => void searchMeaning()}>
            {searching ? "Searching on this device…" : "Search by meaning"}
          </Button>
          <Text accessibilityLiveRegion="polite" style={styles.creatorBody}>
            {searchNotice || (localModel.phase !== "ready" ? "Download Local recall in Settings to search by meaning."
              : semantic?.query === query && semantic.source === state.artifacts
                ? `Related passages from ${semantic.considered} recent notes, followed by text matches. Similarity is not a relevance guarantee.`
                : "Search recent saved notes on this device. No account or network is needed.")}
          </Text>
        </View>
      ) : null}
      <View style={styles.list}>
        {artifacts.map((artifact) => {
          const expanded = artifact.id === expandedId;
          return (
            <View key={artifact.id} style={styles.card}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                onPress={() => setExpandedId(expanded ? null : artifact.id)}
                style={({ pressed }) => [styles.cardHeader, pressed && styles.cardHeaderPressed]}
              >
                <View style={styles.cardCopy}>
                  <Text style={styles.kind}>{KIND_LABEL[artifact.kind]}</Text>
                  <Text numberOfLines={expanded ? undefined : 2} style={styles.title}>{artifact.title}</Text>
                  <Text style={styles.date}>{new Date(artifact.createdAt).toLocaleDateString()}</Text>
                </View>
                <Text style={styles.expandGlyph}>{expanded ? "−" : "+"}</Text>
              </Pressable>
              {expanded ? (
                <View style={styles.expanded}>
                  <MarkdownText content={artifact.content} />
                  <View style={styles.actions}>
                    <Pressable onPress={() => void copy(artifact)} style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}>
                      <Text style={styles.actionText}>Copy note</Text>
                    </Pressable>
                    <Pressable onPress={() => confirmDelete(artifact)} style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}>
                      <Text style={styles.deleteText}>Delete note</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}
        {state.artifacts.length === 0 ? (
          <EmptyState
            title="Your library is empty"
            body="Save a useful Keating response from a lesson. It will stay available here, even after you switch sessions."
          />
        ) : artifacts.length === 0 ? (
          <EmptyState title="No matching notes" body="Try a different search phrase." />
        ) : null}
      </View>
    </Screen>
  );
}

function createStyles(theme: ReturnType<typeof useKeatingTheme>) {
  const { colors, type } = theme;
  return StyleSheet.create({
  creator: {
    paddingBottom: spacing.xl,
    marginBottom: spacing.xl,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  creatorTitle: { ...type.heading, color: colors.text },
  creatorBody: { ...type.body, color: colors.textMuted, marginTop: spacing.xs, marginBottom: spacing.lg },
  creatorActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  createAction: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  createActionText: { ...type.label, color: colors.text },
  disabled: { opacity: 0.42 },
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
  card: { overflow: "hidden", borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  cardHeader: { minHeight: 96, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg },
  cardHeaderPressed: { backgroundColor: colors.surfacePressed },
  cardCopy: { flex: 1, minWidth: 0 },
  kind: { ...type.caption, ...type.monoBold, color: colors.primaryText },
  title: { ...type.heading, color: colors.text, marginTop: spacing.xs },
  date: { ...type.caption, color: colors.textFaint, marginTop: spacing.xs },
  expandGlyph: { ...type.mono, color: colors.textMuted, fontSize: 24 },
  expanded: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.backgroundDeep },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xl },
  action: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border },
  actionPressed: { backgroundColor: colors.surfacePressed },
  actionText: { ...type.label, color: colors.text },
  deleteText: { ...type.label, color: colors.error },
  });
}

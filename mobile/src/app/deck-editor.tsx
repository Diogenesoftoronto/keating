import { useRef, useState } from "react";
import { useRouter } from "expo-router";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "@/components/Buttons";
import { Screen } from "@/components/Screen";
import { radii, spacing, useKeatingTheme } from "@/constants/theme";
import { useKeating } from "@/state/KeatingProvider";

interface DraftCard {
  key: string;
  front: string;
  back: string;
  tags: string;
}

function newDraftCard(key: number): DraftCard {
  return { key: `draft-card-${key}`, front: "", back: "", tags: "" };
}

export default function DeckEditorScreen() {
  const router = useRouter();
  const learner = useKeating();
  const theme = useKeatingTheme();
  const styles = createStyles(theme);
  const nextCardKey = useRef(2);
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [cards, setCards] = useState<DraftCard[]>(() => [newDraftCard(1)]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateCard = (key: string, patch: Partial<DraftCard>) => {
    setCards((current) => current.map((card) => card.key === key ? { ...card, ...patch } : card));
    setError(null);
  };

  const save = async () => {
    const cleanTitle = title.trim();
    const cleanTopic = topic.trim();
    if (!cleanTitle || !cleanTopic) {
      setError("Add both a deck name and topic before saving.");
      return;
    }
    if (cards.some((card) => !card.front.trim() || !card.back.trim())) {
      setError("Every card needs both a prompt and an answer. Your draft is still here.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const deckId = await learner.createLearnerDeck(cleanTitle, cleanTopic, cards.map((card) => ({
        front: card.front.trim(),
        back: card.back.trim(),
        tags: [...new Set(card.tags.split(",").map((tag) => tag.trim()).filter(Boolean))],
      })));
      router.replace({ pathname: "/review", params: { deckId } } as never);
    } catch (cause) {
      setError(cause instanceof Error && cause.message
        ? cause.message
        : "Keating could not save this deck. Your draft is still here; try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      title="New deck"
      subtitle="Create portable cards for local spaced repetition"
      action={<Button compact variant="quiet" disabled={saving} onPress={() => router.back()}>Cancel</Button>}
    >
      <Text style={styles.provenance}>The complete deck is committed to the local learner repository before review opens. Anki package transfer is not available in this mobile build yet.</Text>
      <Field label="Deck name" value={title} onChangeText={(value) => { setTitle(value); setError(null); }} placeholder="Cell biology" styles={styles} />
      <Field label="Topic" value={topic} onChangeText={(value) => { setTopic(value); setError(null); }} placeholder="Biology" styles={styles} />

      <View style={styles.sectionHeader}>
        <View style={styles.sectionCopy}>
          <Text style={styles.sectionTitle}>Cards</Text>
          <Text style={styles.muted}>{cards.length} {cards.length === 1 ? "card" : "cards"} · new cards are due immediately</Text>
        </View>
        <Button compact variant="secondary" disabled={saving || cards.length >= 512} onPress={() => {
          const key = nextCardKey.current++;
          setCards((current) => [...current, newDraftCard(key)]);
        }}>Add card</Button>
      </View>

      {cards.map((card, index) => (
        <View key={card.key} style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Card {index + 1}</Text>
            {cards.length > 1 ? <Button compact variant="quiet" disabled={saving} onPress={() => setCards((current) => current.filter((candidate) => candidate.key !== card.key))}>Remove</Button> : null}
          </View>
          <Field label="Prompt" value={card.front} onChangeText={(value) => updateCard(card.key, { front: value })} placeholder="What should I recall?" multiline styles={styles} />
          <Field label="Answer" value={card.back} onChangeText={(value) => updateCard(card.key, { back: value })} placeholder="The answer or explanation" multiline styles={styles} />
          <Field label="Tags (comma-separated)" value={card.tags} onChangeText={(value) => updateCard(card.key, { tags: value })} placeholder="definitions, exam 1" styles={styles} />
        </View>
      ))}

      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Button loading={saving} disabled={!learner.learnerRepositoryReady} onPress={() => void save()}>Save deck and review</Button>
    </Screen>
  );
}

function Field({ label, value, onChangeText, placeholder, multiline = false, styles }: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  styles: ReturnType<typeof createStyles>;
}) {
  const theme = useKeatingTheme();
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput
      accessibilityLabel={label}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={theme.colors.textFaint}
      multiline={multiline}
      textAlignVertical={multiline ? "top" : "center"}
      maxLength={16_384}
      style={[styles.input, multiline && styles.multiline]}
    />
  </View>;
}

function createStyles(theme: ReturnType<typeof useKeatingTheme>) {
  const { colors, type } = theme;
  return StyleSheet.create({
    provenance: { ...type.caption, color: colors.textMuted, lineHeight: 19, marginBottom: spacing.lg },
    field: { gap: spacing.xs, marginBottom: spacing.md },
    label: { ...type.label, color: colors.text },
    input: { ...type.body, minHeight: 48, color: colors.text, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    multiline: { minHeight: 96 },
    sectionHeader: { minHeight: 56, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, marginTop: spacing.lg, marginBottom: spacing.md },
    sectionCopy: { flex: 1, minWidth: 0 },
    sectionTitle: { ...type.heading, color: colors.text },
    muted: { ...type.caption, color: colors.textMuted, marginTop: 2 },
    card: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.surfaceRaised, padding: spacing.md, marginBottom: spacing.md },
    cardHeader: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
    cardTitle: { ...type.label, color: colors.text },
    error: { ...type.body, color: colors.error, backgroundColor: colors.errorSurface, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.md },
  });
}

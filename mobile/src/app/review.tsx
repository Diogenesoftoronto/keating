import { useMemo, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { applyReview, formatDueIn, formatInterval, type SrsRating } from "@keating/learner-contracts";
import { Button } from "@/components/Buttons";
import { Screen } from "@/components/Screen";
import { radii, spacing, useKeatingTheme } from "@/constants/theme";
import { buildReviewQueue } from "@/lib/learner-study";
import { useKeating } from "@/state/KeatingProvider";

const RATINGS: ReadonlyArray<{ rating: SrsRating; label: string }> = [
  { rating: 0, label: "Again" },
  { rating: 1, label: "Hard" },
  { rating: 2, label: "Good" },
  { rating: 3, label: "Easy" },
];

export default function ReviewScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ deckId?: string | string[] }>();
  const deckId = typeof params.deckId === "string" ? params.deckId : undefined;
  const learner = useKeating();
  const theme = useKeatingTheme();
  const styles = createStyles(theme);
  const [startedAt] = useState(() => new Date().toISOString());
  const [revealed, setRevealed] = useState(false);
  const [completed, setCompleted] = useState<Set<string>>(() => new Set());
  const [ratingBusy, setRatingBusy] = useState<SrsRating | null>(null);
  const [retryRating, setRetryRating] = useState<SrsRating | null>(null);
  const [error, setError] = useState<string | null>(null);

  const queueResult = useMemo(() => {
    if (!learner.learnerData) return { queue: [] as ReturnType<typeof buildReviewQueue>, error: null };
    try {
      return { queue: buildReviewQueue(learner.learnerData, startedAt, deckId ? [deckId] : undefined), error: null };
    } catch (cause) {
      return { queue: [] as ReturnType<typeof buildReviewQueue>, error: cause instanceof Error ? cause.message : "Keating could not load the review queue." };
    }
  }, [deckId, learner.learnerData, startedAt]);
  const current = queueResult.queue.find((entry) => !completed.has(`${entry.deckId}:${entry.card.id}`)) ?? null;

  const rate = async (rating: SrsRating) => {
    if (!current || ratingBusy !== null) return;
    setRatingBusy(rating);
    setError(null);
    setRetryRating(null);
    try {
      await learner.recordLearnerCardReview(current.deckId, current.card.id, rating);
      setCompleted((previous) => new Set(previous).add(`${current.deckId}:${current.card.id}`));
      setRevealed(false);
    } catch (cause) {
      setRetryRating(rating);
      setError(cause instanceof Error && cause.message
        ? cause.message
        : "Keating could not save that rating. The current card is still here; try again.");
    } finally {
      setRatingBusy(null);
    }
  };

  if (!learner.learnerRepositoryReady) {
    return <Screen title="Review" subtitle="Opening the local review queue…"><Text style={styles.muted}>Your next cards will appear when the learner repository is ready.</Text></Screen>;
  }
  if (queueResult.error) {
    return <Screen title="Review" subtitle="Local spaced repetition"><Text accessibilityRole="alert" style={styles.error}>{queueResult.error}</Text><Button compact variant="secondary" onPress={() => router.back()}>Back</Button></Screen>;
  }
  if (!current) {
    return (
      <Screen title="Review complete" subtitle="Local spaced repetition" action={<Button compact variant="quiet" onPress={() => router.back()}>Back</Button>}>
        <View style={styles.completeCard}>
          <Text style={styles.completeTitle}>No more due cards in this review.</Text>
          <Text style={styles.muted}>Ratings were saved one at a time before the queue advanced. Cards you rated Again will return when their ten-minute interval is due.</Text>
          <Button onPress={() => router.replace("/learn" as never)}>Back to Coming Up</Button>
        </View>
      </Screen>
    );
  }

  const position = queueResult.queue.findIndex((entry) => entry.deckId === current.deckId && entry.card.id === current.card.id) + 1;
  return (
    <Screen
      title="Review"
      subtitle={`${current.deckTitle} · ${position}/${queueResult.queue.length} due`}
      action={<Button compact variant="quiet" disabled={ratingBusy !== null} onPress={() => router.back()}>Back</Button>}
    >
      <Text style={styles.meta}>{current.overdue ? "Overdue" : "Due"} {formatDueIn(current.dueAt, startedAt)} · {current.deckTopic}</Text>
      <View style={styles.card}>
        <Text style={styles.kicker}>{revealed ? "ANSWER" : "PROMPT"}</Text>
        <Text style={styles.cardText}>{revealed ? current.card.back : current.card.front}</Text>
        {!revealed ? <Button onPress={() => setRevealed(true)}>Reveal answer</Button> : null}
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
          {retryRating !== null ? <Button compact variant="secondary" disabled={ratingBusy !== null} onPress={() => void rate(retryRating)}>Retry save</Button> : null}
        </View>
      ) : null}

      {revealed ? (
        <View style={styles.ratings}>
          <Text style={styles.ratePrompt}>How well did you recall it?</Text>
          <View style={styles.ratingRow}>
            {RATINGS.map(({ rating, label }) => {
              const next = applyReview(current.card.srs, rating, startedAt);
              return <Button key={rating} compact variant={rating === 0 ? "danger" : rating === 2 ? "primary" : "secondary"} loading={ratingBusy === rating} disabled={ratingBusy !== null} onPress={() => void rate(rating)}>{label} · {formatInterval(next.appliedIntervalDays)}</Button>;
            })}
          </View>
          <Text style={styles.muted}>The displayed interval is calculated from this card’s current local schedule. Keating advances only after the rating is stored.</Text>
        </View>
      ) : null}
    </Screen>
  );
}

function createStyles(theme: ReturnType<typeof useKeatingTheme>) {
  const { colors, type } = theme;
  return StyleSheet.create({
    meta: { ...type.caption, ...type.mono, color: colors.textMuted, marginBottom: spacing.md },
    card: { minHeight: 260, justifyContent: "space-between", borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.lg, backgroundColor: colors.surfaceRaised, padding: spacing.lg, gap: spacing.lg },
    kicker: { ...type.caption, ...type.monoBold, color: colors.primaryText, letterSpacing: 1 },
    cardText: { ...type.heading, color: colors.text, lineHeight: 29 },
    ratings: { marginTop: spacing.lg, gap: spacing.sm },
    ratePrompt: { ...type.label, color: colors.text },
    ratingRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    muted: { ...type.body, color: colors.textMuted, lineHeight: 23 },
    errorBox: { borderRadius: radii.md, backgroundColor: colors.errorSurface, padding: spacing.md, gap: spacing.sm, marginTop: spacing.md },
    error: { ...type.body, color: colors.error, lineHeight: 22 },
    completeCard: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surfaceRaised, padding: spacing.lg, gap: spacing.md },
    completeTitle: { ...type.heading, color: colors.text },
  });
}

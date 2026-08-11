import { useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { AppState, StyleSheet, Text, View } from "react-native";
import { formatDueIn, type StudyPriority } from "@keating/learner-contracts";
import { Button } from "@/components/Buttons";
import { Screen } from "@/components/Screen";
import { radii, spacing, useKeatingTheme } from "@/constants/theme";
import { buildLearnerProgress, type LearnerTopicProgress } from "@/lib/learner-progress";
import { buildComingUp, type ComingUpItem } from "@/lib/learner-study";
import { useKeating } from "@/state/KeatingProvider";

const PRIORITIES: readonly StudyPriority[] = ["focus", "maintain", "low"];

export default function LearnScreen() {
  const router = useRouter();
  const learner = useKeating();
  const theme = useKeatingTheme();
  const styles = createStyles(theme);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nowIso, setNowIso] = useState(() => new Date().toISOString());
  const learnerData = learner.learnerData;

  useEffect(() => {
    const refresh = () => setNowIso(new Date().toISOString());
    const interval = setInterval(refresh, 60_000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, []);

  const projection = useMemo(() => {
    if (!learnerData) return null;
    try {
      const progress = buildLearnerProgress(learnerData, Date.parse(nowIso));
      return { nowIso, progress, comingUp: buildComingUp(learnerData, progress, nowIso) };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : "Keating could not read local learner data." };
    }
  }, [learnerData, nowIso]);

  const setPriority = async (item: ComingUpItem, priority: StudyPriority) => {
    if (item.priority === priority) return;
    const key = `priority:${item.id}`;
    setBusy(key);
    setError(null);
    try {
      await learner.setLearnerStudyPriority(item.targetType, item.targetId, priority);
    } catch (cause) {
      setError(actionError(cause, "Keating could not save that priority. Your review schedule was not changed."));
    } finally {
      setBusy(null);
    }
  };

  const updateGoal = async (goalId: string, stepId: string, status: "in_progress" | "done") => {
    const key = `goal:${goalId}:${stepId}`;
    setBusy(key);
    setError(null);
    try {
      await learner.updateLearnerGoalStep(goalId, stepId, status);
    } catch (cause) {
      setError(actionError(cause, "Keating could not save that goal step. Try again; it remains unchanged."));
    } finally {
      setBusy(null);
    }
  };

  const practiceInTutor = async (item: ComingUpItem) => {
    const key = `practice:${item.id}`;
    setBusy(key);
    setError(null);
    const prompt = item.targetType === "verification"
      ? `Help me work through this saved verification: ${item.title}. Ask one retrieval question at a time.`
      : `Give me a short retrieval practice on ${item.topic}. Do not give the answer until I attempt it.`;
    try {
      const sessionId = await learner.startNewSessionWithMessage(prompt);
      if (!sessionId) throw new Error("Keating could not start a new lesson.");
      router.replace("/");
    } catch (cause) {
      setError(actionError(cause, "Keating could not start that practice lesson. Your learner data was not changed."));
    } finally {
      setBusy(null);
    }
  };

  if (!learner.learnerRepositoryReady) {
    return <Screen title="Learn & Coming Up" subtitle="Opening your local learner workspace…"><Text style={styles.muted}>Your goals, decks, reviews, and evidence stay on this device while the learner repository opens.</Text></Screen>;
  }
  if (!projection || !learnerData) {
    return <Screen title="Learn & Coming Up" subtitle="Your local learner workspace"><Text style={styles.muted}>No learner snapshot is available yet. Return to Tutor and try again after local storage finishes opening.</Text></Screen>;
  }
  if ("error" in projection) {
    return <Screen title="Learn & Coming Up" subtitle="Your local learner workspace"><Text accessibilityRole="alert" style={styles.error}>{projection.error}</Text></Screen>;
  }

  const { progress, comingUp } = projection;
  const activeGoals = progress.goals.filter((goal) => goal.completedSteps < goal.totalSteps).length;
  const assessedTopics = progress.topics.filter((topic) => topic.mastery !== null).length;

  return (
    <Screen
      title="Learn & Coming Up"
      subtitle="Local goals, planned practice, and evidence—not inferred study streaks"
      action={<Button compact variant="quiet" onPress={() => router.back()}>Back</Button>}
    >
      <View style={styles.metrics}>
        <Metric label="Due cards" value={String(comingUp.dueCardCount)} styles={styles} />
        <Metric label="Active goals" value={String(activeGoals)} styles={styles} />
        <Metric label="Assessed topics" value={String(assessedTopics)} styles={styles} />
      </View>
      <Text style={styles.provenance}>Usage and model tokens live separately in Usage & study activity. This workspace shows actionable local learning records only.</Text>

      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

      <Section title="Today" styles={styles}>
        {comingUp.dueCardCount > 0 ? (
          <View style={styles.todayCard}>
            <Text style={styles.todayTitle}>{comingUp.dueCardCount} card{comingUp.dueCardCount === 1 ? "" : "s"} due{comingUp.overdueCardCount ? ` · ${comingUp.overdueCardCount} overdue` : ""}</Text>
            <Text style={styles.muted}>{comingUp.estimatedMinutes} estimated minutes across your current plan.</Text>
            <Button onPress={() => router.push("/review" as never)}>Review due cards</Button>
          </View>
        ) : <Empty text="No cards are due right now. New decks and review history appear here when you save or import them." styles={styles} />}
      </Section>

      {PRIORITIES.map((lane) => (
        <Section key={lane} title={laneLabel(lane)} styles={styles}>
          {comingUp.lanes[lane].length ? comingUp.lanes[lane].map((item) => (
            <ComingUpCard
              key={item.id}
              item={item}
              nowIso={nowIso}
              busy={busy === `priority:${item.id}` || busy === `practice:${item.id}`}
              onPriority={(priority) => void setPriority(item, priority)}
              onReview={item.targetType === "deck" && item.dueCount > 0 ? () => router.push({ pathname: "/review", params: { deckId: item.targetId } } as never) : undefined}
              onPractice={item.targetType === "verification" || item.targetType === "topic" ? () => void practiceInTutor(item) : undefined}
              styles={styles}
            />
          )) : <Empty text={`Nothing in ${laneLabel(lane).toLocaleLowerCase()} yet.`} styles={styles} />}
        </Section>
      ))}

      <Section title="Goals" styles={styles}>
        {progress.goals.length ? progress.goals.map((goal) => (
          <View key={goal.id} style={styles.card}>
            <Text style={styles.cardTitle}>{goal.title}</Text>
            {goal.description ? <Text style={styles.muted}>{goal.description}</Text> : null}
            <Text style={styles.meta}>{goal.completedSteps}/{goal.totalSteps} steps complete</Text>
            {goal.nextIncompleteStep ? (
              <View style={styles.goalNext}>
                <Text style={styles.goalStep}>{goal.nextIncompleteStep.title}</Text>
                {goal.nextIncompleteStep.successCriteria.length ? <Text style={styles.muted}>{goal.nextIncompleteStep.successCriteria.join(" · ")}</Text> : null}
                <Button
                  compact
                  variant="secondary"
                  loading={busy === `goal:${goal.id}:${goal.nextIncompleteStep.id}`}
                  onPress={() => void updateGoal(goal.id, goal.nextIncompleteStep!.id, goal.nextIncompleteStep!.status === "not_started" ? "in_progress" : "done")}
                >{goal.nextIncompleteStep.status === "not_started" ? "Start step" : "Mark step done"}</Button>
              </View>
            ) : <Text style={styles.success}>All stored steps are complete.</Text>}
          </View>
        )) : <Empty text="Goals created in a lesson will appear here once saved to your learner record." styles={styles} />}
      </Section>

      <Section title="Topic evidence" styles={styles}>
        {progress.topics.length ? progress.topics.map((topic) => <TopicCard key={topic.topic} topic={topic} styles={styles} />)
          : <Empty text="A topic appears after study activity or an assessment is recorded. Keating does not infer mastery from a lesson title." styles={styles} />}
      </Section>

      <Section title="Decks" styles={styles}>
        <Button compact variant="secondary" onPress={() => router.push("/deck-editor" as never)}>Create deck</Button>
        {learnerData.decks.length ? learnerData.decks.map((deck) => {
          const item = comingUp.items.find((candidate) => candidate.targetType === "deck" && candidate.targetId === deck.id);
          return <View key={deck.id} style={styles.deckRow}>
            <View style={styles.rowCopy}><Text style={styles.cardTitle}>{deck.title}</Text><Text style={styles.muted}>{deck.cards.length} cards · {item?.dueCount ?? 0} due{item?.nextDueAt ? ` · next ${formatDueIn(item.nextDueAt, nowIso)}` : ""}</Text></View>
            <Button compact variant="secondary" disabled={!item?.dueCount} onPress={() => router.push({ pathname: "/review", params: { deckId: deck.id } } as never)}>Review</Button>
          </View>;
        }) : <Empty text="No portable decks yet. Create one here for offline review; Anki package transfer is not in this mobile build yet." styles={styles} />}
      </Section>

      <Section title="Learner-recorded context" styles={styles}>
        <Text style={styles.provenance}>These are your own saved strengths and weaknesses, not Keating’s assessed performance labels.</Text>
        <Text style={styles.meta}>Strengths: {displayList(progress.learnerRecordedContext.strengths)}</Text>
        <Text style={styles.meta}>Weaknesses: {displayList(progress.learnerRecordedContext.weaknesses)}</Text>
        <Button compact variant="secondary" onPress={() => router.push("/settings" as never)}>Edit About you</Button>
      </Section>
    </Screen>
  );
}

function ComingUpCard({ item, nowIso, busy, onPriority, onReview, onPractice, styles }: {
  item: ComingUpItem;
  nowIso: string;
  busy: boolean;
  onPriority: (priority: StudyPriority) => void;
  onReview?: () => void;
  onPractice?: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return <View style={styles.card}>
    <Text style={styles.cardTitle}>{item.title}</Text>
    <Text style={styles.muted}>{item.description}</Text>
    <Text style={styles.meta}>{item.dueCount ? `${item.dueCount} due${item.overdueCount ? ` · ${item.overdueCount} overdue` : ""}` : "No cards due"}{item.nextDueAt ? ` · next ${formatDueIn(item.nextDueAt, nowIso)}` : ""}{item.estimatedMinutes ? ` · ${item.estimatedMinutes} min` : ""}</Text>
    <View style={styles.priorityRow}>
      {PRIORITIES.map((priority) => <Button key={priority} compact variant={item.priority === priority ? "primary" : "quiet"} disabled={busy} onPress={() => onPriority(priority)}>{laneLabel(priority)}</Button>)}
    </View>
    <Text style={styles.intent}>{item.prioritySource === "learner" ? "Your priority choice changes attention, not the review schedule." : "Suggested from due work; change it without changing the review schedule."}</Text>
    {onReview ? <Button compact onPress={onReview}>Review deck</Button> : null}
    {onPractice ? <Button compact variant="secondary" loading={busy} onPress={onPractice}>Practice in Tutor</Button> : null}
  </View>;
}

function TopicCard({ topic, styles }: { topic: LearnerTopicProgress; styles: ReturnType<typeof createStyles> }) {
  const status = topic.status === "insufficient" ? "Insufficient assessed evidence" : topic.status.replace("-", " ");
  return <View style={styles.card}>
    <Text style={styles.cardTitle}>{topic.topic}</Text>
    <Text style={styles.meta}>{status} · confidence {Math.round(topic.confidence * 100)}% from {topic.evidenceCount} scored/review record{topic.evidenceCount === 1 ? "" : "s"}</Text>
    <Text style={styles.muted}>Mastery: {topic.mastery === null ? "not assessed" : `${Math.round(topic.mastery * 100)}%`} · Retention: {topic.retention === null ? "no card-review evidence" : `${Math.round(topic.retention * 100)}%`}</Text>
    {topic.pendingAssessmentCount ? <Text style={styles.intent}>{topic.pendingAssessmentCount} assessment{topic.pendingAssessmentCount === 1 ? " is" : "s are"} still pending.</Text> : null}
  </View>;
}

function Metric({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

function Section({ title, children, styles }: { title: string; children: React.ReactNode; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text>{children}</View>;
}

function Empty({ text, styles }: { text: string; styles: ReturnType<typeof createStyles> }) {
  return <Text style={styles.muted}>{text}</Text>;
}

function laneLabel(priority: StudyPriority): string {
  return priority === "focus" ? "Focus" : priority === "maintain" ? "Maintain" : "Low";
}

function displayList(values: readonly string[]): string {
  return values.length ? values.join(" · ") : "None recorded";
}

function actionError(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function createStyles(theme: ReturnType<typeof useKeatingTheme>) {
  const { colors, type } = theme;
  return StyleSheet.create({
    metrics: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.lg },
    metric: { flexGrow: 1, minWidth: 102, width: "30%", borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised, padding: spacing.md },
    metricValue: { ...type.heading, ...type.monoBold, color: colors.text },
    metricLabel: { ...type.caption, color: colors.textMuted, marginTop: 2 },
    section: { marginTop: spacing.md, marginBottom: spacing.xl },
    sectionTitle: { ...type.heading, color: colors.text, marginBottom: spacing.sm },
    card: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised, borderRadius: radii.md, padding: spacing.md, gap: spacing.sm, marginBottom: spacing.sm },
    todayCard: { borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surfaceRaised, borderRadius: radii.md, padding: spacing.md, gap: spacing.sm },
    todayTitle: { ...type.label, color: colors.text },
    cardTitle: { ...type.label, color: colors.text },
    muted: { ...type.body, color: colors.textMuted },
    provenance: { ...type.caption, color: colors.textMuted, lineHeight: 19, marginBottom: spacing.md },
    meta: { ...type.caption, ...type.mono, color: colors.textMuted },
    intent: { ...type.caption, color: colors.primaryText, lineHeight: 18 },
    priorityRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
    goalNext: { gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
    goalStep: { ...type.label, color: colors.text },
    success: { ...type.caption, color: colors.primaryText },
    deckRow: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: spacing.sm },
    rowCopy: { flex: 1, minWidth: 0, gap: 2 },
    error: { ...type.body, color: colors.error, backgroundColor: colors.errorSurface, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.md },
  });
}

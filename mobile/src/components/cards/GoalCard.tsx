import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Buttons";
import { radii, spacing, useKeatingTheme } from "@/constants/theme";
import type { GoalStep, GoalStepStatus, LearnerGoal } from "@/lib/interactive-tags";
import { readCardState, writeCardState } from "@/state/card-state";

const KIND_LABEL: Record<GoalStep["kind"], string> = {
  concept: "Concept",
  practice: "Practice",
  project: "Project",
  milestone: "Milestone",
  reflection: "Reflect",
};

const NEXT_STATUS: Record<GoalStepStatus, GoalStepStatus> = {
  not_started: "in_progress",
  in_progress: "done",
  done: "not_started",
};

const STATUS_MARK: Record<GoalStepStatus, string> = {
  not_started: "○",
  in_progress: "◐",
  done: "●",
};

export function GoalCard({
  goal,
  cardKey,
  initialStatuses,
  onStepStatusChange,
  onReport,
}: {
  goal: LearnerGoal;
  cardKey: string;
  /** Durable statuses reconstructed from the portable repository after restart. */
  initialStatuses?: Record<string, GoalStepStatus>;
  /** Commits the learner-owned step state before reflecting it in the card. */
  onStepStatusChange: (stepIndex: number, status: GoalStepStatus) => Promise<void>;
  /** Sends the learner's progress back to the teacher so it can re-plan. */
  onReport: (report: string) => Promise<void>;
}) {
  const theme = useKeatingTheme();
  const styles = createStyles(theme);
  const [statuses, setStatuses] = useState<Record<string, GoalStepStatus>>(
    () =>
      readCardState<Record<string, GoalStepStatus>>(cardKey)
      ?? initialStatuses
      ?? Object.fromEntries(goal.steps.map((step) => [step.id, step.status])),
  );
  const [busyStepId, setBusyStepId] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const durableStatusSignature = initialStatuses ? JSON.stringify(initialStatuses) : null;

  useEffect(() => {
    if (!initialStatuses) return;
    writeCardState(cardKey, initialStatuses);
    setStatuses((current) => JSON.stringify(current) === durableStatusSignature ? current : initialStatuses);
  }, [cardKey, durableStatusSignature]);

  const statusOf = (step: GoalStep) => statuses[step.id] ?? step.status;
  const done = goal.steps.filter((step) => statusOf(step) === "done").length;
  const percent = goal.steps.length === 0 ? 0 : Math.round((done / goal.steps.length) * 100);
  const nextStep = goal.steps.find((step) => statusOf(step) !== "done");
  const changed = goal.steps.some((step) => statusOf(step) !== step.status);

  const cycle = async (step: GoalStep, stepIndex: number) => {
    if (busyStepId !== null) return;
    const nextStatus = NEXT_STATUS[statusOf(step)];
    setBusyStepId(step.id);
    setError(null);
    try {
      await onStepStatusChange(stepIndex, nextStatus);
      const next = { ...statuses, [step.id]: nextStatus };
      writeCardState(cardKey, next);
      setStatuses(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this goal step. Try again.");
    } finally {
      setBusyStepId(null);
    }
  };

  const report = async () => {
    const lines = [
      `Progress on "${goal.title}": ${done}/${goal.steps.length} steps done.`,
      "",
      ...goal.steps.map((step) => `- ${step.title} → ${statusOf(step).replace("_", " ")}`),
      "",
      nextStep ? `I'm working on: ${nextStep.title}. What should I do next?` : "That's the whole plan. What comes after this?",
    ];
    setReporting(true);
    setError(null);
    try {
      await onReport(lines.join("\n"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your progress is saved, but Keating could not respond. Try again.");
    } finally {
      setReporting(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>LEARNING GOAL</Text>
      <Text style={styles.title}>{goal.title}</Text>
      {goal.description ? <Text style={styles.description}>{goal.description}</Text> : null}

      <View style={styles.progressRow}>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${percent}%` }]} />
        </View>
        <Text style={styles.progressText}>
          {done}/{goal.steps.length}
        </Text>
      </View>

      <View style={styles.steps}>
        {goal.steps.map((step, index) => {
          const status = statusOf(step);
          return (
            <Pressable
              key={step.id}
              accessibilityRole="button"
              accessibilityLabel={`${step.title} — ${status.replace("_", " ")}. Tap to advance.`}
              disabled={busyStepId !== null}
              onPress={() => void cycle(step, index)}
              style={({ pressed }) => [
                styles.step,
                status === "done" && styles.stepDone,
                step.id === nextStep?.id && styles.stepNext,
                pressed && styles.stepPressed,
              ]}
            >
              <Text style={[styles.mark, status === "done" && styles.markDone]}>{STATUS_MARK[status]}</Text>
              <View style={styles.stepBody}>
                <Text style={styles.stepTitle}>
                  {index + 1}. {step.title}
                </Text>
                <Text style={styles.stepKind}>{KIND_LABEL[step.kind]}</Text>
                {step.description ? <Text style={styles.stepDescription}>{step.description}</Text> : null}
                {step.successCriteria.map((criterion) => (
                  <Text key={criterion} style={styles.criterion}>
                    · {criterion}
                  </Text>
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>

      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

      <Button onPress={() => void report()} variant="secondary" compact disabled={!changed || busyStepId !== null || reporting}>
        {reporting ? "Sending progress…" : changed ? "Tell Keating my progress" : "Tap a step to mark progress"}
      </Button>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useKeatingTheme>) {
  const { colors, type } = theme;
  return StyleSheet.create({
  card: {
    marginVertical: spacing.md,
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  kicker: { ...type.caption, ...type.monoBold, color: colors.primaryText, letterSpacing: 1 },
  title: { ...type.heading, color: colors.text },
  description: { ...type.body, color: colors.textMuted },
  progressRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs },
  track: { flex: 1, height: 6, borderRadius: radii.pill, backgroundColor: colors.surfacePressed, overflow: "hidden" },
  fill: { height: "100%", borderRadius: radii.pill, backgroundColor: colors.primary },
  progressText: { ...type.caption, ...type.mono, color: colors.textMuted },
  steps: { gap: spacing.sm, marginTop: spacing.sm },
  step: {
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stepPressed: { backgroundColor: colors.surfacePressed },
  stepDone: { borderColor: colors.primaryStrong },
  stepNext: { backgroundColor: colors.surfaceRaised },
  mark: { ...type.body, color: colors.textMuted, width: 18 },
  markDone: { color: colors.primaryText },
  stepBody: { flex: 1, gap: 2 },
  stepTitle: { ...type.label, color: colors.text },
  stepKind: { ...type.caption, color: colors.textFaint, textTransform: "uppercase", letterSpacing: 0.6 },
  stepDescription: { ...type.caption, color: colors.textMuted, lineHeight: 18 },
  criterion: { ...type.caption, color: colors.textFaint },
  error: { ...type.caption, color: colors.warning },
  });
}

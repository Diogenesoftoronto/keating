import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Buttons";
import { colors, radii, spacing, type } from "@/constants/theme";
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
  onReport,
}: {
  goal: LearnerGoal;
  cardKey: string;
  /** Sends the learner's progress back to the teacher so it can re-plan. */
  onReport: (report: string) => void;
}) {
  const [statuses, setStatuses] = useState<Record<string, GoalStepStatus>>(
    () =>
      readCardState<Record<string, GoalStepStatus>>(cardKey)
      ?? Object.fromEntries(goal.steps.map((step) => [step.id, step.status])),
  );

  const statusOf = (step: GoalStep) => statuses[step.id] ?? step.status;
  const done = goal.steps.filter((step) => statusOf(step) === "done").length;
  const percent = goal.steps.length === 0 ? 0 : Math.round((done / goal.steps.length) * 100);
  const nextStep = goal.steps.find((step) => statusOf(step) !== "done");
  const changed = goal.steps.some((step) => statusOf(step) !== step.status);

  const cycle = (step: GoalStep) => {
    const next = { ...statuses, [step.id]: NEXT_STATUS[statusOf(step)] };
    writeCardState(cardKey, next);
    setStatuses(next);
  };

  const report = () => {
    const lines = [
      `Progress on "${goal.title}": ${done}/${goal.steps.length} steps done.`,
      "",
      ...goal.steps.map((step) => `- ${step.title} → ${statusOf(step).replace("_", " ")}`),
      "",
      nextStep ? `I'm working on: ${nextStep.title}. What should I do next?` : "That's the whole plan. What comes after this?",
    ];
    onReport(lines.join("\n"));
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
              onPress={() => cycle(step)}
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

      <Button onPress={report} variant="secondary" compact disabled={!changed}>
        {changed ? "Tell Keating my progress" : "Tap a step to mark progress"}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginVertical: spacing.md,
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  kicker: { ...type.caption, ...type.mono, color: colors.primary, fontWeight: "700", letterSpacing: 1 },
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
  markDone: { color: colors.primary },
  stepBody: { flex: 1, gap: 2 },
  stepTitle: { ...type.label, color: colors.text },
  stepKind: { ...type.caption, color: colors.textFaint, textTransform: "uppercase", letterSpacing: 0.6 },
  stepDescription: { ...type.caption, color: colors.textMuted, lineHeight: 18 },
  criterion: { ...type.caption, color: colors.textFaint },
});

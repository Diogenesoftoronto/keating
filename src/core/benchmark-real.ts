import type {
  LearnerProfile,
  RealLearnerOutcome,
  SimulationWeights,
  TeacherPolicy,
  TeachingSimulation,
  TopicDefinition
} from "./types.js";

export const MIN_REAL_OUTCOMES = 5;

type OutcomeSignal = "thumbs-up" | "thumbs-down" | "confused";

export interface ScoreableLearnerOutcome {
  topic: string;
  feedbackSignal: OutcomeSignal;
  masteryEstimate: number;
  outcomeScore: number;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function feedbackToOutcomeScore(signal: OutcomeSignal): number {
  switch (signal) {
    case "thumbs-up": return 0.85;
    case "thumbs-down": return 0.15;
    case "confused": return 0.35;
  }
}

export function hasEnoughRealData(outcomes: ScoreableLearnerOutcome[]): boolean {
  return outcomes.length >= MIN_REAL_OUTCOMES;
}

export function blendRealSyntheticScore(realScore: number, syntheticMean: number, realOutcomeCount: number): number {
  const realShare = clamp(0.5 + Math.min(0.4, realOutcomeCount / 20), 0.5, 0.9);
  const syntheticShare = 1 - realShare;
  return clamp(realScore * realShare + syntheticMean * syntheticShare, 0, 1);
}

export function computeRealOutcomeScore(
  outcomes: ScoreableLearnerOutcome[] | RealLearnerOutcome[],
  policy: TeacherPolicy,
  topic: TopicDefinition,
  weights: SimulationWeights
): TeachingSimulation {
  const defaultLearner: LearnerProfile = {
    id: "real-learner",
    priorKnowledge: 0.5,
    abstractionComfort: 0.5,
    analogyNeed: 0.5,
    dialoguePreference: 0.5,
    diagramAffinity: 0.5,
    persistence: 0.5,
    transferDesire: 0.5,
    anxiety: 0.3,
  };

  const avgOutcome = mean(outcomes.map((outcome) => outcome.outcomeScore));
  const upRatio =
    outcomes.filter((outcome) => outcome.feedbackSignal === "thumbs-up").length /
    outcomes.length;
  const confusedRatio =
    outcomes.filter((outcome) => outcome.feedbackSignal === "confused").length /
    outcomes.length;
  const downRatio =
    outcomes.filter((outcome) => outcome.feedbackSignal === "thumbs-down").length /
    outcomes.length;
  const avgMastery = mean(outcomes.map((outcome) => outcome.masteryEstimate));

  const masteryGain = clamp(avgOutcome * 0.6 + avgMastery * 0.4);
  const retention = clamp(
    masteryGain * (0.55 + policy.retrievalPractice * 0.45)
  );
  const engagement = clamp(avgOutcome * 0.7 + upRatio * 0.3);
  const transfer = clamp(
    retention * (0.55 + policy.interdisciplinaryBias * 0.25 + avgMastery * 0.2)
  );
  const confusion = clamp(confusedRatio * 0.6 + downRatio * 0.4);
  const score = clamp(
    masteryGain * weights.masteryGain +
      retention * weights.retention +
      engagement * weights.engagement +
      transfer * weights.transfer -
      confusion * weights.confusion,
    0,
    1
  );

  const explanations: string[] = [];
  if (upRatio > 0.6) explanations.push("learner gave mostly positive feedback");
  if (confusedRatio > 0.3) explanations.push("learner was frequently confused");
  if (downRatio > 0.2) explanations.push("learner gave substantial negative feedback");
  if (avgMastery > 0.7) explanations.push("mastery estimates are high");
  if (avgMastery < 0.3) explanations.push("mastery estimates are low");
  if (explanations.length === 0) explanations.push("learner feedback is mixed");

  return {
    learner: defaultLearner,
    topic,
    masteryGain,
    retention,
    engagement,
    transfer,
    confusion,
    score,
    breakdown: {
      intuitionFit: avgOutcome,
      rigorFit: avgOutcome * policy.formalism,
      dialogueFit: avgOutcome * policy.socraticRatio,
      diagramFit: avgOutcome * policy.diagramBias,
      practiceFit: clamp(upRatio * policy.exerciseCount / 5),
      reflectionFit: avgOutcome * policy.reflectionBias,
      overload: confusion,
    },
    explanation: ["Real learner outcome (N=" + outcomes.length + ").", ...explanations],
  };
}

export function simulateDeterministicTeaching(
  policy: TeacherPolicy,
  topic: TopicDefinition,
  learner: LearnerProfile,
  weights: SimulationWeights
): TeachingSimulation {
  const intuitionFit = 1 - Math.abs(policy.analogyDensity - learner.analogyNeed);
  const rigorTarget = clamp((topic.formalism + learner.abstractionComfort) / 2);
  const rigorFit = 1 - Math.abs(policy.formalism - rigorTarget);
  const dialogueFit = 1 - Math.abs(policy.socraticRatio - learner.dialoguePreference);
  const diagramTarget = topic.visualizable ? learner.diagramAffinity : 0.2;
  const diagramFit = 1 - Math.abs(policy.diagramBias - diagramTarget);
  const practiceNeed = clamp(1 - learner.priorKnowledge + learner.anxiety * 0.2);
  const practiceFit = 1 - Math.abs(policy.exerciseCount / 5 - practiceNeed);
  const reflectionFit = 1 - Math.abs(policy.reflectionBias - learner.transferDesire);
  const overload = clamp(
    policy.formalism * 0.35 +
      (policy.exerciseCount / 5) * 0.15 +
      policy.challengeRate * 0.3 -
      learner.persistence * 0.2 +
      learner.anxiety * 0.25 -
      learner.priorKnowledge * 0.15
  );

  const masteryGain = clamp(
    0.14 +
      intuitionFit * 0.18 +
      rigorFit * 0.2 +
      dialogueFit * 0.12 +
      diagramFit * 0.09 +
      practiceFit * 0.12 +
      (1 - overload) * 0.18
  );
  const retention = clamp(masteryGain * (0.55 + policy.retrievalPractice * 0.45));
  const engagement = clamp(
    0.12 +
      intuitionFit * 0.16 +
      dialogueFit * 0.16 +
      diagramFit * 0.1 +
      reflectionFit * 0.14 +
      (1 - overload) * 0.18
  );
  const transfer = clamp(
    masteryGain * (0.55 + policy.interdisciplinaryBias * 0.25 + learner.transferDesire * 0.2)
  );
  const confusion = clamp(
    0.04 +
      overload * 0.55 +
      Math.abs(policy.formalism - learner.abstractionComfort) * 0.18 +
      Math.abs(policy.challengeRate - learner.persistence) * 0.12
  );
  const score = clamp(
    masteryGain * weights.masteryGain +
      retention * weights.retention +
      engagement * weights.engagement +
      transfer * weights.transfer -
      confusion * weights.confusion,
    0,
    1
  );

  return {
    learner,
    topic,
    masteryGain,
    retention,
    engagement,
    transfer,
    confusion,
    score,
    breakdown: {
      intuitionFit,
      rigorFit,
      dialogueFit,
      diagramFit,
      practiceFit,
      reflectionFit,
      overload,
    },
    explanation: ["Deterministic algebraic baseline."],
  };
}

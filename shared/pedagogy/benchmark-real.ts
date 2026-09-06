import type {
  BenchmarkMeasurement,
  LearnerProfile,
  SimulationWeights,
  TeacherPolicy,
  TeachingSimulation,
  TopicDefinition,
} from "./types.js";

export const MIN_REAL_OUTCOMES = 5;

export type OutcomeSignal = "thumbs-up" | "thumbs-down" | "confused";

export interface ScoreableLearnerOutcome {
  topic: string;
  feedbackSignal: OutcomeSignal;
  quizScore?: number | null;
  masteryEstimate: number;
  outcomeScore: number;
  evidenceKind?: "explicit-feedback" | "inferred-feedback" | "graded-assessment";
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function classifyDominantSignal(
  simulations: readonly TeachingSimulation[],
  kind: "strength" | "weakness",
): string {
  if (simulations.length === 0) return "no learner feedback";
  if (simulations.every((entry) => entry.evidence?.kind === "retrospective")) {
    if (kind === "weakness") return "learning gain, retention, and transfer unmeasured";
    return simulations.some((entry) => entry.evidence?.score.source === "observed")
      ? "graded assessment performance (descriptive)"
      : "learner feedback proxy";
  }
  const metrics = {
    intuitionFit: mean(simulations.map((entry) => entry.breakdown.intuitionFit)),
    rigorFit: mean(simulations.map((entry) => entry.breakdown.rigorFit)),
    dialogueFit: mean(simulations.map((entry) => entry.breakdown.dialogueFit)),
    diagramFit: mean(simulations.map((entry) => entry.breakdown.diagramFit)),
    practiceFit: mean(simulations.map((entry) => entry.breakdown.practiceFit)),
    reflectionFit: mean(simulations.map((entry) => entry.breakdown.reflectionFit)),
    overload: mean(simulations.map((entry) => entry.breakdown.overload)),
  };
  const ordered = Object.entries(metrics).sort((left, right) =>
    kind === "strength" ? right[1] - left[1] : left[1] - right[1]
  );
  return ordered[0]?.[0] ?? "unknown";
}

export function feedbackToOutcomeScore(signal: OutcomeSignal): number {
  switch (signal) {
    case "thumbs-up": return 0.85;
    case "thumbs-down": return 0.15;
    case "confused": return 0.35;
  }
}

export function hasEnoughRealData(outcomes: ScoreableLearnerOutcome[]): boolean {
  // Compatibility threshold for corpus size only; never a validation or promotion gate.
  return outcomes.length >= MIN_REAL_OUTCOMES;
}

export function blendRealSyntheticScore(realScore: number, syntheticMean: number, realOutcomeCount: number): number {
  const realShare = clamp(0.5 + Math.min(0.4, realOutcomeCount / 20), 0.5, 0.9);
  const syntheticShare = 1 - realShare;
  return clamp(realScore * realShare + syntheticMean * syntheticShare, 0, 1);
}

export function computeRealOutcomeScore(
  outcomes: ScoreableLearnerOutcome[],
  _policy: TeacherPolicy,
  topic: TopicDefinition,
  _weights: SimulationWeights,
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

  const validScore = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
  const quizScores = outcomes
    .map((outcome) => outcome.quizScore)
    .filter(validScore);
  const avgQuiz = quizScores.length > 0 ? mean(quizScores) : null;
  // Quiz adapters historically create feedback labels from grades. Those are
  // not independent reports of satisfaction or confusion.
  const feedback = outcomes.filter((outcome) => outcome.evidenceKind !== "graded-assessment"
    && outcome.quizScore == null && validScore(outcome.outcomeScore));
  const avgFeedback = feedback.length > 0 ? mean(feedback.map((outcome) => outcome.outcomeScore)) : null;
  const confusedRatio = feedback.length > 0
    ? feedback.filter((outcome) => outcome.feedbackSignal === "confused").length / feedback.length
    : null;
  const unavailable = (note: string): BenchmarkMeasurement => ({ value: null, source: "unavailable", sampleSize: 0, note });
  const assessmentPerformance: BenchmarkMeasurement = avgQuiz === null
    ? unavailable("No graded assessment was recorded.")
    : { value: avgQuiz, source: "observed", sampleSize: quizScores.length, note: "Recorded assessment performance; assistance and starting ability are unspecified." };
  const feedbackProxy: BenchmarkMeasurement = avgFeedback === null
    ? unavailable("No feedback signal was recorded.")
    : { value: avgFeedback, source: "proxy", sampleSize: feedback.length, note: "Feedback proxy; not measured learning or engagement." };
  const scoreEvidence = avgQuiz === null ? feedbackProxy : assessmentPerformance;
  // The scoring rule is fixed. Historical evidence must not improve merely
  // because a candidate changes its policy or the optimizer changes weights.
  const score = scoreEvidence.value ?? 0;
  const engagement = avgFeedback ?? 0;
  const confusion = confusedRatio ?? 0;

  const explanations = ["Historical records describe past interactions; they do not evaluate this candidate policy."];
  if (avgQuiz !== null) {
    explanations.push(`Recorded assessment average is ${(avgQuiz * 100).toFixed(0)}% across ${quizScores.length} quiz(zes); this is not measured learning gain.`);
  } else if (avgFeedback !== null) {
    explanations.push(`Score is a feedback proxy from ${feedback.length} signal(s), not a learning outcome.`);
  } else {
    explanations.push("No usable graded assessment or feedback score was recorded.");
  }
  explanations.push("Learning gain, retention, and transfer are unknown: paired baseline, delayed, and transfer assessments are absent.");

  return {
    learner: defaultLearner,
    topic,
    masteryGain: 0,
    retention: 0,
    engagement,
    transfer: 0,
    confusion,
    score,
    breakdown: {
      intuitionFit: 0,
      rigorFit: 0,
      dialogueFit: 0,
      diagramFit: 0,
      practiceFit: 0,
      reflectionFit: 0,
      overload: confusion,
    },
    explanation: [`Retrospective learner evidence (N=${outcomes.length}).`, ...explanations],
    evidence: {
      kind: "retrospective",
      scoringRule: "assessment-mean-or-feedback-proxy-v1",
      score: scoreEvidence,
      assessmentPerformance,
      metrics: {
        masteryGain: unavailable("Learning gain requires a comparable baseline and post-assessment."),
        retention: unavailable("Retention requires a delayed unaided assessment."),
        engagement: feedbackProxy,
        transfer: unavailable("Transfer requires an unaided assessment in a new context."),
        confusion: confusedRatio === null ? unavailable("No confusion signal was recorded.")
          : { value: confusedRatio, source: "proxy", sampleSize: feedback.length, note: "Fraction of feedback signals labeled confused; labels may be inferred." },
      },
      feedbackCounts: {
        explicit: feedback.filter((outcome) => outcome.evidenceKind === "explicit-feedback").length,
        inferred: feedback.filter((outcome) => outcome.evidenceKind === "inferred-feedback").length,
        unclassified: feedback.filter((outcome) => outcome.evidenceKind === undefined).length,
      },
      eligibleForPromotion: false,
    },
  };
}

export function simulateDeterministicTeaching(
  policy: TeacherPolicy,
  topic: TopicDefinition,
  learner: LearnerProfile,
  weights: SimulationWeights,
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
    policy.formalism * 0.35
      + (policy.exerciseCount / 5) * 0.15
      + policy.challengeRate * 0.3
      - learner.persistence * 0.2
      + learner.anxiety * 0.25
      - learner.priorKnowledge * 0.15,
  );

  const masteryGain = clamp(
    0.14
      + intuitionFit * 0.18
      + rigorFit * 0.2
      + dialogueFit * 0.12
      + diagramFit * 0.09
      + practiceFit * 0.12
      + (1 - overload) * 0.18,
  );
  const retention = clamp(masteryGain * (0.55 + policy.retrievalPractice * 0.45));
  const engagement = clamp(
    0.12
      + intuitionFit * 0.16
      + dialogueFit * 0.16
      + diagramFit * 0.1
      + reflectionFit * 0.14
      + (1 - overload) * 0.18,
  );
  const transfer = clamp(
    masteryGain * (0.55 + policy.interdisciplinaryBias * 0.25 + learner.transferDesire * 0.2),
  );
  const confusion = clamp(
    0.04
      + overload * 0.55
      + Math.abs(policy.formalism - learner.abstractionComfort) * 0.18
      + Math.abs(policy.challengeRate - learner.persistence) * 0.12,
  );
  const score = clamp(
    masteryGain * weights.masteryGain
      + retention * weights.retention
      + engagement * weights.engagement
      + transfer * weights.transfer
      - confusion * weights.confusion,
    0,
    1,
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
    explanation: ["Synthetic deterministic algebraic baseline; not observed learner outcomes."],
  };
}

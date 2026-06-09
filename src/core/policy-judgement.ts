import type {
  BenchmarkResult,
  EvolutionCandidate,
  LearnerState,
  RealLearnerOutcome,
  SimulationWeights,
  TeacherPolicy
} from "./types.js";
import { runBenchmarkSuite } from "./benchmark.js";
import { resolveTopic } from "./topics.js";
import { clamp } from "./util.js";

export interface PolicyObjectiveVector {
  realScore: number;
  counterfactualRobustness: number;
  mastery: number;
  transfer: number;
  lowConfusion: number;
  evidenceReadiness: number;
}

export interface PolicyJudgementCandidate {
  label: string;
  policy: TeacherPolicy;
  benchmark: BenchmarkResult;
  counterfactualBenchmark?: BenchmarkResult;
  preferenceScore: number;
}

export function generateCounterfactualLearnerState(
  base: LearnerState,
  outcomes: RealLearnerOutcome[]
): LearnerState {
  const feedback = outcomes.flatMap((outcome, index) => {
    const variants: Array<"thumbs-up" | "thumbs-down" | "confused"> =
      outcome.feedbackSignal === "thumbs-up"
        ? ["thumbs-up", "confused"]
        : outcome.feedbackSignal === "confused"
          ? ["confused", "thumbs-down"]
          : ["thumbs-down", "confused"];

    return variants.map((signal, variantIndex) => ({
      topic: resolveTopic(outcome.topic).slug,
      timestamp: new Date(Date.now() + index * 10 + variantIndex).toISOString(),
      signal,
      comment: `counterfactual:${outcome.feedbackSignal}->${signal}`
    }));
  });

  return {
    ...base,
    id: `${base.id}-counterfactual`,
    feedback,
    coveredTopics: mergeCoveredTopics(base, outcomes)
  };
}

export async function counterfactualBenchmark(
  cwd: string,
  baseState: LearnerState,
  outcomes: RealLearnerOutcome[],
  policy: TeacherPolicy,
  focusTopic: string | undefined,
  seed: number,
  traceLimit: number,
  weights: SimulationWeights
): Promise<BenchmarkResult | undefined> {
  if (outcomes.length === 0) return undefined;
  const state = generateCounterfactualLearnerState(baseState, outcomes);
  return runBenchmarkSuite(cwd, policy, focusTopic, seed, traceLimit, weights, state);
}

export function policyObjectiveVector(candidate: PolicyJudgementCandidate): PolicyObjectiveVector {
  const primary = candidate.benchmark;
  const cf = candidate.counterfactualBenchmark;
  const topicMeans = primary.topicBenchmarks;
  const cfScore = cf ? cf.overallScore / 100 : primary.overallScore / 100;
  const mean = (values: number[]) => values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

  return {
    realScore: clamp(primary.overallScore / 100),
    counterfactualRobustness: clamp(cfScore),
    mastery: clamp(mean(topicMeans.map((topic) => topic.meanMasteryGain))),
    transfer: clamp(mean(topicMeans.map((topic) => topic.meanTransfer))),
    lowConfusion: clamp(1 - mean(topicMeans.map((topic) => topic.meanConfusion))),
    evidenceReadiness: primary.trace.dataSource === "learner-feedback" ? 1 : primary.trace.dataSource === "learner-feedback-sparse" ? 0.35 : 0
  };
}

function objectiveValues(candidate: PolicyJudgementCandidate): number[] {
  const vector = policyObjectiveVector(candidate);
  return [
    vector.realScore,
    vector.counterfactualRobustness,
    vector.mastery,
    vector.transfer,
    vector.lowConfusion,
    vector.evidenceReadiness
  ];
}

function aggregate(vector: PolicyObjectiveVector): number {
  return (
    vector.realScore * 0.36 +
    vector.counterfactualRobustness * 0.22 +
    vector.mastery * 0.14 +
    vector.transfer * 0.12 +
    vector.lowConfusion * 0.1 +
    vector.evidenceReadiness * 0.06
  );
}

export function prosperPolicyPreference(left: PolicyJudgementCandidate, right: PolicyJudgementCandidate): number {
  const leftValues = objectiveValues(left);
  const rightValues = objectiveValues(right);
  let wins = 0;
  let losses = 0;
  for (let index = 0; index < leftValues.length; index += 1) {
    if (leftValues[index] > rightValues[index]) wins += 1;
    if (leftValues[index] < rightValues[index]) losses += 1;
  }
  const aggregateDelta = aggregate(policyObjectiveVector(left)) - aggregate(policyObjectiveVector(right));
  return wins - losses + aggregateDelta * 2;
}

export function prosperPolicyWinner<T extends PolicyJudgementCandidate>(candidates: T[]): T {
  let best = candidates[0];
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const score = candidates.reduce((sum, opponent) => {
      if (candidate === opponent) return sum;
      return sum + prosperPolicyPreference(candidate, opponent);
    }, 0);
    candidate.preferenceScore = score;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

export function applyProsperScores(candidates: EvolutionCandidate[]): EvolutionCandidate[] {
  if (candidates.length === 0) return candidates;
  const wrapped = candidates.map((candidate) => ({
    ...candidate,
    label: candidate.policy.name,
    preferenceScore: candidate.preferenceScore ?? 0
  }));
  prosperPolicyWinner(wrapped);
  for (let index = 0; index < candidates.length; index += 1) {
    candidates[index].preferenceScore = wrapped[index].preferenceScore;
  }
  return candidates;
}

function mergeCoveredTopics(base: LearnerState, outcomes: RealLearnerOutcome[]): LearnerState["coveredTopics"] {
  const bySlug = new Map(base.coveredTopics.map((topic) => [topic.slug, topic]));
  for (const outcome of outcomes) {
    const topic = resolveTopic(outcome.topic);
    if (bySlug.has(topic.slug)) continue;
    bySlug.set(topic.slug, {
      slug: topic.slug,
      domain: topic.domain,
      lastSeen: new Date().toISOString(),
      masteryEstimate: outcome.masteryEstimate,
      sessionCount: 1
    });
  }
  return [...bySlug.values()];
}

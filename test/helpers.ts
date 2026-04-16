import * as fc from "fast-check";

import type { TeacherPolicy, SimulationWeights, LearnerProfile, TopicDefinition, BenchmarkResult, TopicBenchmark, TeachingSimulation, BenchmarkTopicTrace, MapElitesGrid, MapElitesCell } from "../src/core/types.js";
import { clampPolicy, clampWeights } from "../src/core/policy.js";

// ─── fast-check Arbitraries ────────────────────────────────────────────────

export const arbPolicyName = fc.string({ minLength: 1, maxLength: 32 });

export const arbPolicy: fc.Arbitrary<TeacherPolicy> = fc.record({
  name: arbPolicyName,
  analogyDensity: fc.double({ min: 0, max: 1, noNaN: true }),
  socraticRatio: fc.double({ min: 0, max: 1, noNaN: true }),
  formalism: fc.double({ min: 0, max: 1, noNaN: true }),
  retrievalPractice: fc.double({ min: 0, max: 1, noNaN: true }),
  exerciseCount: fc.integer({ min: 1, max: 5 }),
  diagramBias: fc.double({ min: 0, max: 1, noNaN: true }),
  reflectionBias: fc.double({ min: 0, max: 1, noNaN: true }),
  interdisciplinaryBias: fc.double({ min: 0, max: 1, noNaN: true }),
  challengeRate: fc.double({ min: 0, max: 1, noNaN: true }),
});

export const arbWeights: fc.Arbitrary<SimulationWeights> = fc.record({
  masteryGain: fc.double({ min: 0.01, max: 1, noNaN: true }),
  retention: fc.double({ min: 0.01, max: 1, noNaN: true }),
  engagement: fc.double({ min: 0.01, max: 1, noNaN: true }),
  transfer: fc.double({ min: 0.01, max: 1, noNaN: true }),
  confusion: fc.double({ min: 0.01, max: 1, noNaN: true }),
});

export const arbLearnerProfile: fc.Arbitrary<LearnerProfile> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 16 }),
  priorKnowledge: fc.double({ min: 0, max: 1, noNaN: true }),
  abstractionComfort: fc.double({ min: 0, max: 1, noNaN: true }),
  analogyNeed: fc.double({ min: 0, max: 1, noNaN: true }),
  dialoguePreference: fc.double({ min: 0, max: 1, noNaN: true }),
  diagramAffinity: fc.double({ min: 0, max: 1, noNaN: true }),
  persistence: fc.double({ min: 0, max: 1, noNaN: true }),
  transferDesire: fc.double({ min: 0, max: 1, noNaN: true }),
  anxiety: fc.double({ min: 0, max: 1, noNaN: true }),
});

export const arbDescriptorKey = fc.constantFrom(
  "analogyDensity", "socraticRatio", "formalism", "retrievalPractice",
  "exerciseCount", "diagramBias", "reflectionBias", "interdisciplinaryBias", "challengeRate"
);

export const arbDescriptors = fc.array(arbDescriptorKey, { minLength: 1, maxLength: 4 }).map(arr => [...new Set(arr)]);

export const arbResolution = fc.integer({ min: 2, max: 20 });

export const arbTopicSlug = fc.string({ unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")), minLength: 3, maxLength: 24 });

export const arbDomain = fc.constantFrom(
  "math", "science", "philosophy", "code", "law",
  "politics", "psychology", "medicine", "arts", "history", "general"
);

export const arbTopicDefinition: fc.Arbitrary<TopicDefinition> = fc.record({
  slug: arbTopicSlug,
  title: fc.string({ minLength: 1, maxLength: 48 }),
  domain: arbDomain,
  summary: fc.string({ maxLength: 200 }),
  intuition: fc.array(fc.string({ maxLength: 80 }), { maxLength: 4 }),
  formalCore: fc.array(fc.string({ maxLength: 80 }), { maxLength: 4 }),
  prerequisites: fc.array(fc.string({ maxLength: 40 }), { maxLength: 6 }),
  misconceptions: fc.array(fc.string({ maxLength: 80 }), { maxLength: 4 }),
  examples: fc.array(fc.string({ maxLength: 80 }), { maxLength: 4 }),
  exercises: fc.array(fc.string({ maxLength: 80 }), { maxLength: 4 }),
  reflections: fc.array(fc.string({ maxLength: 80 }), { maxLength: 4 }),
  diagramNodes: fc.array(fc.string({ maxLength: 40 }), { maxLength: 8 }),
  formalism: fc.double({ min: 0, max: 1, noNaN: true }),
  visualizable: fc.boolean(),
  interdisciplinaryHooks: fc.array(fc.string({ maxLength: 60 }), { maxLength: 4 }),
});

export const arbScore = fc.double({ min: 0, max: 100, noNaN: true });

// ─── Deterministic Benchmark Stub (Antithesis: controlled entropy) ────────

function deterministicScore(policy: TeacherPolicy, weights: SimulationWeights): number {
  const w = clampWeights(weights);
  const p = clampPolicy(policy);
  const raw =
    p.analogyDensity * w.masteryGain * 30 +
    p.socraticRatio * w.engagement * 25 +
    p.formalism * w.retention * 20 +
    p.retrievalPractice * w.transfer * 15 +
    (1 - p.challengeRate) * w.confusion * 10;
  return Math.max(0, Math.min(100, raw + 20));
}

export function stubBenchmarkResult(
  policy: TeacherPolicy,
  weights: SimulationWeights,
  seed: number
): BenchmarkResult {
  const p = clampPolicy(policy);
  const w = clampWeights(weights);
  const overallScore = deterministicScore(p, w);
  const topicBenchmark: TopicBenchmark = {
    topic: { slug: "stub-topic", title: "Stub Topic", domain: "math", summary: "stub", intuition: [], formalCore: [], prerequisites: [], misconceptions: [], examples: [], exercises: [], reflections: [], diagramNodes: [], formalism: 0.5, visualizable: true, interdisciplinaryHooks: [] },
    learnerCount: 3,
    meanScore: overallScore,
    meanMasteryGain: p.analogyDensity * 0.6 + 0.2,
    meanRetention: p.retrievalPractice * 0.5 + 0.3,
    meanEngagement: p.socraticRatio * 0.4 + 0.3,
    meanTransfer: p.interdisciplinaryBias * 0.3 + 0.2,
    meanConfusion: p.challengeRate * 0.3,
    topLearners: [],
    strugglingLearners: [],
    dominantStrength: "intuitionFit",
    dominantWeakness: "overload"
  };
  const trace: BenchmarkTopicTrace = {
    topic: "stub-topic",
    topLearners: [],
    strugglingLearners: [],
    metricMeans: { masteryGain: topicBenchmark.meanMasteryGain, retention: topicBenchmark.meanRetention, engagement: topicBenchmark.meanEngagement, transfer: topicBenchmark.meanTransfer, confusion: topicBenchmark.meanConfusion },
    dominantStrength: "intuitionFit",
    dominantWeakness: "overload"
  };
  return {
    policy: p,
    suiteName: "stub-suite",
    topicBenchmarks: [topicBenchmark],
    overallScore,
    weakestTopic: "stub-topic",
    trace: { seed, learnerCountPerTopic: 3, topicTraces: [trace] }
  };
}

// ─── Mock Benchmark Suite (DI boundary) ────────────────────────────────────

export type BenchmarkSuiteFn = (
  cwd: string,
  policy: TeacherPolicy,
  focusTopic: string | undefined,
  seed: number,
  traceLimit: number,
  weights: SimulationWeights
) => Promise<BenchmarkResult>;

export function createDeterministicBenchmark(): BenchmarkSuiteFn {
  let callCount = 0;
  const fn: BenchmarkSuiteFn & { callCount: () => number } = async (cwd, policy, focusTopic, seed, traceLimit, weights) => {
    callCount++;
    return stubBenchmarkResult(policy, weights, seed);
  };
  fn.callCount = () => callCount;
  return fn;
}

// ─── Mock Filesystem for archive load/save ─────────────────────────────────

export interface MockFileSystem {
  read: (path: string) => Promise<string>;
  write: (path: string, content: string) => Promise<void>;
  files: Map<string, string>;
}

export function createMockFs(initial: Record<string, string> = {}): MockFileSystem {
  const files = new Map(Object.entries(initial));
  return {
    read: async (path) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    write: async (path, content) => { files.set(path, content); },
    files,
  };
}

// ─── Invariant helpers (Antithesis: validate continuously) ─────────────────

export function policyIsBounded(policy: TeacherPolicy): boolean {
  const numericKeys: Array<keyof TeacherPolicy> = [
    "analogyDensity", "socraticRatio", "formalism", "retrievalPractice",
    "diagramBias", "reflectionBias", "interdisciplinaryBias", "challengeRate"
  ];
  for (const k of numericKeys) {
    const v = policy[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) return false;
  }
  if (typeof policy.exerciseCount !== "number" || policy.exerciseCount < 1 || policy.exerciseCount > 5) return false;
  if (!Number.isInteger(policy.exerciseCount)) return false;
  return true;
}

export function weightsAreNormalized(weights: SimulationWeights): boolean {
  const sum = weights.masteryGain + weights.retention + weights.engagement + weights.transfer + weights.confusion;
  return Math.abs(sum - 1) < 0.02;
}

export function weightsAreBounded(weights: SimulationWeights): boolean {
  for (const v of Object.values(weights)) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) return false;
  }
  return true;
}

export function benchmarkScoresAreBounded(result: BenchmarkResult): boolean {
  if (!Number.isFinite(result.overallScore) || result.overallScore < 0 || result.overallScore > 100) return false;
  for (const tb of result.topicBenchmarks) {
    if (!Number.isFinite(tb.meanScore) || tb.meanScore < 0 || tb.meanScore > 100) return false;
    for (const m of [tb.meanMasteryGain, tb.meanRetention, tb.meanEngagement, tb.meanTransfer, tb.meanConfusion]) {
      if (!Number.isFinite(m) || m < 0 || m > 1) return false;
    }
  }
  return true;
}

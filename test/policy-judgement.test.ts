import { test, expect } from "bun:test";

import { prosperPolicyWinner, type PolicyJudgementCandidate } from "../src/core/policy-judgement.js";
import { DEFAULT_POLICY } from "../src/core/policy.js";
import type { BenchmarkResult, BenchmarkTopicTrace } from "../src/core/types.js";

function benchmark(overallScore: number, mastery: number, transfer: number, confusion: number): BenchmarkResult {
  const trace: BenchmarkTopicTrace = {
    topic: "Derivative",
    topLearners: [],
    strugglingLearners: [],
    metricMeans: {
      masteryGain: mastery,
      retention: mastery,
      engagement: 0.6,
      transfer,
      confusion
    },
    dominantStrength: "test",
    dominantWeakness: "test"
  };
  return {
    policy: DEFAULT_POLICY,
    suiteName: "test",
    overallScore,
    weakestTopic: "Derivative",
    topicBenchmarks: [{
      topic: {
        slug: "derivative",
        title: "Derivative",
        domain: "math",
        summary: "",
        intuition: [],
        formalCore: [],
        prerequisites: [],
        misconceptions: [],
        examples: [],
        exercises: [],
        reflections: [],
        diagramNodes: [],
        formalism: 0.8,
        visualizable: true,
        interdisciplinaryHooks: []
      },
      learnerCount: 1,
      meanScore: overallScore,
      meanMasteryGain: mastery,
      meanRetention: mastery,
      meanEngagement: 0.6,
      meanTransfer: transfer,
      meanConfusion: confusion,
      topLearners: [],
      strugglingLearners: [],
      dominantStrength: "test",
      dominantWeakness: "test"
    }],
    trace: {
      seed: 1,
      learnerCountPerTopic: 1,
      topicTraces: [trace],
      realOutcomeCount: 5,
      syntheticFallback: false,
      dataSource: "learner-feedback"
    }
  };
}

test("PROSPER policy judgement prefers robust balanced candidates over narrow score spikes", () => {
  const narrow: PolicyJudgementCandidate = {
    label: "narrow",
    policy: { ...DEFAULT_POLICY, name: "narrow" },
    benchmark: benchmark(86, 0.45, 0.35, 0.45),
    counterfactualBenchmark: benchmark(40, 0.3, 0.2, 0.65),
    preferenceScore: 0
  };
  const balanced: PolicyJudgementCandidate = {
    label: "balanced",
    policy: { ...DEFAULT_POLICY, name: "balanced" },
    benchmark: benchmark(82, 0.75, 0.72, 0.18),
    counterfactualBenchmark: benchmark(78, 0.7, 0.68, 0.22),
    preferenceScore: 0
  };

  const winner = prosperPolicyWinner([narrow, balanced]);

  expect(winner.label).toBe("balanced");
  expect(balanced.preferenceScore).toBeGreaterThan(narrow.preferenceScore);
});

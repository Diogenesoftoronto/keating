import { test, expect } from "bun:test";
import * as fc from "fast-check";

import { applyFeedbackBias, summarizeTopic } from "../src/core/benchmark.js";
import { DEFAULT_WEIGHTS, clampPolicy, clampWeights } from "../src/core/policy.js";
import type { TeachingSimulation, TopicDefinition, SimulationWeights } from "../src/core/types.js";
import {
  arbPolicy, arbWeights, arbLearnerProfile, arbTopicDefinition,
  policyIsBounded, weightsAreNormalized, weightsAreBounded,
  benchmarkScoresAreBounded
} from "./helpers.js";

// ─── applyFeedbackBias properties ──────────────────────────────────────────

test("ALWAYS: applyFeedbackBias returns bounded and normalized weights", () => {
  fc.assert(fc.property(
    fc.record({
      confusionRate: fc.double({ min: 0, max: 1, noNaN: true }),
      satisfactionRate: fc.double({ min: 0, max: 1, noNaN: true }),
      sampleSize: fc.integer({ min: 5, max: 500 }),
    }),
    (feedback) => {
      const result = applyFeedbackBias(feedback);
      expect(weightsAreBounded(result)).toBe(true);
      expect(weightsAreNormalized(result)).toBe(true);
    }
  ));
});

test("ALWAYS: applyFeedbackBias with sampleSize < 5 returns DEFAULT_WEIGHTS", () => {
  fc.assert(fc.property(
    fc.record({
      confusionRate: fc.double({ min: 0, max: 1, noNaN: true }),
      satisfactionRate: fc.double({ min: 0, max: 1, noNaN: true }),
      sampleSize: fc.integer({ min: 0, max: 4 }),
    }),
    (feedback) => {
      const result = applyFeedbackBias(feedback);
      expect(result.masteryGain).toBe(DEFAULT_WEIGHTS.masteryGain);
      expect(result.confusion).toBe(DEFAULT_WEIGHTS.confusion);
    }
  ));
});

test("ALWAYS: high confusion increases confusion weight relative to default", () => {
  const highConfusion = applyFeedbackBias({ confusionRate: 0.9, satisfactionRate: 0.1, sampleSize: 100 });
  const lowConfusion = applyFeedbackBias({ confusionRate: 0.1, satisfactionRate: 0.9, sampleSize: 100 });
  expect(highConfusion.confusion).toBeGreaterThan(lowConfusion.confusion);
});

// ─── summarizeTopic properties ──────────────────────────────────────────────

test("ALWAYS: summarizeTopic produces bounded mean scores", () => {
  fc.assert(fc.property(
    arbTopicDefinition,
    fc.array(arbLearnerProfile, { minLength: 1, maxLength: 10 }),
    (topic, learners) => {
      const simulations: TeachingSimulation[] = learners.map((learner) => ({
        learner,
        topic,
        masteryGain: Math.random(),
        retention: Math.random(),
        engagement: Math.random(),
        transfer: Math.random(),
        confusion: Math.random() * 0.5,
        score: Math.random(),
        breakdown: {
          intuitionFit: 0.5,
          rigorFit: 0.5,
          dialogueFit: 0.5,
          diagramFit: 0.5,
          practiceFit: 0.5,
          reflectionFit: 0.5,
          overload: 0.3
        },
        explanation: ["test"]
      }));

      const summary = summarizeTopic(topic, simulations, 3);

      expect(summary.meanScore).toBeGreaterThanOrEqual(0);
      expect(summary.meanScore).toBeLessThanOrEqual(100);
      expect(summary.meanMasteryGain).toBeGreaterThanOrEqual(0);
      expect(summary.meanMasteryGain).toBeLessThanOrEqual(1);
      expect(summary.meanConfusion).toBeGreaterThanOrEqual(0);
      expect(summary.meanConfusion).toBeLessThanOrEqual(1);
      expect(summary.learnerCount).toBe(learners.length);
      expect(summary.dominantStrength.length).toBeGreaterThan(0);
      expect(summary.dominantWeakness.length).toBeGreaterThan(0);
    }
  ));
});

test("ALWAYS: summarizeTopic with empty simulations still returns valid structure", () => {
  fc.assert(fc.property(
    arbTopicDefinition,
    (topic) => {
      const summary = summarizeTopic(topic, [], 3);
      expect(summary.learnerCount).toBe(0);
      expect(Number.isFinite(summary.meanScore)).toBe(true);
    }
  ));
});

// ─── Simulation metric invariants ──────────────────────────────────────────

test("ALWAYS: all simulation metrics are in [0,1] range when clamped", () => {
  fc.assert(fc.property(
    arbPolicy, arbLearnerProfile, arbTopicDefinition, arbWeights,
    (policy, learner, topic, weights) => {
      const p = clampPolicy(policy);
      const w = clampWeights(weights);

      const intuitionFit = 1 - Math.abs(p.analogyDensity - learner.analogyNeed);
      const rigorTarget = Math.max(0, Math.min(1, (topic.formalism + learner.abstractionComfort) / 2));
      const rigorFit = 1 - Math.abs(p.formalism - rigorTarget);
      const overload = Math.max(0, Math.min(1,
        p.formalism * 0.35 +
        (p.exerciseCount / 5) * 0.15 +
        p.challengeRate * 0.3 -
        learner.persistence * 0.2 +
        learner.anxiety * 0.25 -
        learner.priorKnowledge * 0.15
      ));

      expect(intuitionFit).toBeGreaterThanOrEqual(-0.01);
      expect(intuitionFit).toBeLessThanOrEqual(1.01);
      expect(rigorFit).toBeGreaterThanOrEqual(-0.01);
      expect(rigorFit).toBeLessThanOrEqual(1.01);
      expect(overload).toBeGreaterThanOrEqual(-0.01);
      expect(overload).toBeLessThanOrEqual(1.01);
    }
  ));
});

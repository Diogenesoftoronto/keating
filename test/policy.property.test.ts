/** Property checks for policy clamping and normalized simulation weights. */
import { expect, test } from "bun:test";
import * as fc from "fast-check";

import { clampPolicy, clampWeights } from "../src/core/policy.js";
import { DEFAULT_POLICY } from "../src/core/policy.js";
import type { SimulationWeights, TeacherPolicy } from "../src/core/types.js";
import { arbPolicy, arbUnboundedPolicy } from "./helpers.js";

const scalarFields = [
  "analogyDensity", "socraticRatio", "formalism", "retrievalPractice",
  "diagramBias", "reflectionBias", "interdisciplinaryBias", "challengeRate",
] as const;

test("clampPolicy preserves every valid scalar and the policy name", () => {
  fc.assert(fc.property(arbPolicy, (policy) => {
    const result = clampPolicy(policy);
    expect(result.name).toBe(policy.name);
    expect(result.exerciseCount).toBe(policy.exerciseCount);
    for (const field of scalarFields) expect(result[field]).toBe(policy[field]);
  }), { numRuns: 80 });
});

test("clampPolicy bounds fractional exercise counts and always returns an integer", () => {
  fc.assert(fc.property(arbUnboundedPolicy, (policy) => {
    const count = clampPolicy(policy).exerciseCount;
    expect(Number.isInteger(count)).toBe(true);
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(5);
    if (policy.exerciseCount >= 1 && policy.exerciseCount <= 5) {
      expect(Math.abs(count - policy.exerciseCount)).toBeLessThanOrEqual(0.5);
    }
  }), { numRuns: 100 });
});

test("clampWeights preserves valid normalized weights", () => {
  const arbNormalizedWeights = fc.tuple(
    fc.double({ min: 0.02, max: 0.92, noNaN: true }),
    fc.double({ min: 0.02, max: 0.92, noNaN: true }),
    fc.double({ min: 0.02, max: 0.92, noNaN: true }),
    fc.double({ min: 0.02, max: 0.92, noNaN: true }),
    fc.double({ min: 0.02, max: 0.92, noNaN: true }),
  ).map(([a, b, c, d, e]) => {
    const total = a + b + c + d + e;
    return {
      masteryGain: a / total,
      retention: b / total,
      engagement: c / total,
      transfer: d / total,
      confusion: e / total,
    } satisfies SimulationWeights;
  });

  fc.assert(fc.property(arbNormalizedWeights, (weights) => {
    expect(clampWeights(weights)).toEqual(weights);
  }), { numRuns: 80 });
});

test("clamping remains idempotent for bounded and out-of-range policies", () => {
  fc.assert(fc.property(
    fc.oneof(arbPolicy, arbUnboundedPolicy),
    (policy: TeacherPolicy) => {
      const once = clampPolicy(policy);
      expect(clampPolicy(once)).toEqual(once);
      expect(once.name).toBe(policy.name);
    },
  ), { numRuns: 100 });
  expect(clampPolicy(DEFAULT_POLICY)).toEqual(DEFAULT_POLICY);
});

test("weight normalization is idempotent for arbitrary finite inputs", () => {
  const finiteWeights = fc.record({
    masteryGain: fc.double({ min: -5, max: 5, noNaN: true }),
    retention: fc.double({ min: -5, max: 5, noNaN: true }),
    engagement: fc.double({ min: -5, max: 5, noNaN: true }),
    transfer: fc.double({ min: -5, max: 5, noNaN: true }),
    confusion: fc.double({ min: -5, max: 5, noNaN: true }),
  });
  fc.assert(fc.property(finiteWeights, (weights) => {
    const once = clampWeights(weights);
    expect(clampWeights(once)).toEqual(once);
    expect(Object.values(once).every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(Object.values(once).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 3);
  }), { numRuns: 80 });
});

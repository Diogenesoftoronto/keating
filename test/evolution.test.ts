import { test, expect } from "bun:test";
import * as fc from "fast-check";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runBenchmarkSuite, applyFeedbackBias } from "../src/core/benchmark.js";
import { evolvePolicy, noveltyScore } from "../src/core/evolution.js";
import { DEFAULT_POLICY, DEFAULT_WEIGHTS, clampPolicy, clampWeights } from "../src/core/policy.js";
import type { TeacherPolicy, SimulationWeights } from "../src/core/types.js";
import {
  arbPolicy, arbWeights, arbLearnerProfile,
  policyIsBounded, weightsAreNormalized, weightsAreBounded,
  benchmarkScoresAreBounded
} from "./helpers.js";

// ─── Novelty score: pure-function properties (no I/O) ──────────────────────

test("ALWAYS: noveltyScore returns 0 for identical policy against itself", () => {
  fc.assert(fc.property(arbPolicy, (policy) => {
    const p = clampPolicy(policy);
    const novelty = noveltyScore([p], p);
    expect(Math.abs(novelty)).toBeLessThan(0.001);
  }));
});

test("ALWAYS: noveltyScore returns 1 for empty archive", () => {
  fc.assert(fc.property(arbPolicy, (policy) => {
    const p = clampPolicy(policy);
    const novelty = noveltyScore([], p);
    expect(novelty).toBe(1);
  }));
});

test("ALWAYS: noveltyScore is non-negative", () => {
  fc.assert(fc.property(
    fc.array(arbPolicy, { minLength: 0, maxLength: 5 }), arbPolicy,
    (archive, candidate) => {
      const clampedArchive = archive.map(p => clampPolicy(p));
      const c = clampPolicy(candidate);
      const novelty = noveltyScore(clampedArchive, c);
      expect(novelty).toBeGreaterThanOrEqual(0);
    }
  ));
});

test("ALWAYS: noveltyScore decreases as archive grows more similar to candidate", () => {
  fc.assert(fc.property(arbPolicy, arbPolicy, (base, other) => {
    const b = clampPolicy(base);
    const o = clampPolicy(other);
    const candidate = clampPolicy({ ...b, analogyDensity: b.analogyDensity + 0.5, formalism: b.formalism + 0.3 });

    const smallArchiveNovelty = noveltyScore([o], candidate);
    const withSimilar = noveltyScore([o, { ...b, name: "similar", analogyDensity: b.analogyDensity + 0.45, formalism: b.formalism + 0.28 } as TeacherPolicy], candidate);

    expect(withSimilar).toBeLessThanOrEqual(smallArchiveNovelty + 0.001);
  }));
});

test("ALWAYS: noveltyScore is symmetric in distance", () => {
  fc.assert(fc.property(arbPolicy, arbPolicy, (a, b) => {
    const pa = clampPolicy(a);
    const pb = clampPolicy(b);
    const distAB = noveltyScore([pa], pb);
    const distBA = noveltyScore([pb], pa);
    expect(Math.abs(distAB - distBA)).toBeLessThan(0.001);
  }));
});

// ─── Feedback bias: pure-function properties ────────────────────────────────

test("ALWAYS: applyFeedbackBias returns normalized weights", () => {
  fc.assert(fc.property(
    fc.record({
      confusionRate: fc.double({ min: 0, max: 1, noNaN: true }),
      satisfactionRate: fc.double({ min: 0, max: 1, noNaN: true }),
      sampleSize: fc.integer({ min: 5, max: 1000 }),
    }),
    (feedback) => {
      const result = applyFeedbackBias(feedback);
      expect(weightsAreNormalized(result)).toBe(true);
      expect(weightsAreBounded(result)).toBe(true);
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

// ─── clamping invariants (differential testing) ────────────────────────────

test("ALWAYS: clampPolicy always produces bounded policy", () => {
  fc.assert(fc.property(
    fc.record({
      name: fc.string({ minLength: 1, maxLength: 8 }),
      analogyDensity: fc.double({ min: -10, max: 10, noNaN: true }),
      socraticRatio: fc.double({ min: -10, max: 10, noNaN: true }),
      formalism: fc.double({ min: -10, max: 10, noNaN: true }),
      retrievalPractice: fc.double({ min: -10, max: 10, noNaN: true }),
      exerciseCount: fc.integer({ min: -100, max: 100 }),
      diagramBias: fc.double({ min: -10, max: 10, noNaN: true }),
      reflectionBias: fc.double({ min: -10, max: 10, noNaN: true }),
      interdisciplinaryBias: fc.double({ min: -10, max: 10, noNaN: true }),
      challengeRate: fc.double({ min: -10, max: 10, noNaN: true }),
    }),
    (raw) => {
      const clamped = clampPolicy(raw);
      expect(policyIsBounded(clamped)).toBe(true);
    }
  ));
});

test("ALWAYS: clampWeights always produces normalized and bounded weights", () => {
  fc.assert(fc.property(
    fc.record({
      masteryGain: fc.double({ min: -5, max: 5, noNaN: true }),
      retention: fc.double({ min: -5, max: 5, noNaN: true }),
      engagement: fc.double({ min: -5, max: 5, noNaN: true }),
      transfer: fc.double({ min: -5, max: 5, noNaN: true }),
      confusion: fc.double({ min: -5, max: 5, noNaN: true }),
    }),
    (raw) => {
      const clamped = clampWeights(raw);
      expect(weightsAreBounded(clamped)).toBe(true);
      expect(weightsAreNormalized(clamped)).toBe(true);
    }
  ));
});

test("ALWAYS: clampPolicy is idempotent", () => {
  fc.assert(fc.property(arbPolicy, (policy) => {
    const once = clampPolicy(policy);
    const twice = clampPolicy(once);
    expect(twice).toEqual(once);
  }));
});

test("ALWAYS: clampWeights converges (3 iterations produce stable invariants)", () => {
  fc.assert(fc.property(arbWeights, (weights) => {
    let current = weights;
    for (let i = 0; i < 3; i++) {
      current = clampWeights(current);
      expect(weightsAreBounded(current)).toBe(true);
      expect(weightsAreNormalized(current)).toBe(true);
    }
  }));
});

// ─── Integration tests (algebraic fallback) ─────────────────────────────────

test("accepted evolution candidates never underperform the current best by construction", async () => {
  const origError = console.error;
  console.error = () => {};
  try {
    const workdir = await mkdtemp(join(tmpdir(), "keating-evolution-"));
    const archivePath = join(workdir, "archive.json");
    const run = await evolvePolicy(archivePath, DEFAULT_POLICY, undefined, 3, 1234);

    expect(run.best.overallScore).toBeGreaterThanOrEqual(run.baseline.overallScore - 0.01);
    for (const candidate of run.acceptedCandidates) {
      expect(candidate.novelty).toBeGreaterThanOrEqual(0.05);
      expect(candidate.benchmark.overallScore).toBeGreaterThanOrEqual(run.baseline.overallScore - 0.01);
      expect(policyIsBounded(candidate.policy)).toBe(true);
    }

    const saved = JSON.parse(await readFile(archivePath, "utf8"));
    expect(saved.currentPolicy.name).toBe(run.best.policy.name);
    expect(benchmarkScoresAreBounded(run.best)).toBe(true);
    expect(benchmarkScoresAreBounded(run.baseline)).toBe(true);
  } finally {
    console.error = origError;
  }
}, 60000);

test("benchmark suite remains deterministic for fixed policy and seed", async () => {
  const origError = console.error;
  console.error = () => {};
  try {
    const left = await runBenchmarkSuite(process.cwd(), DEFAULT_POLICY, "derivative", 99);
    const right = await runBenchmarkSuite(process.cwd(), DEFAULT_POLICY, "derivative", 99);
    expect(left).toEqual(right);
  } finally {
    console.error = origError;
  }
}, 60000);

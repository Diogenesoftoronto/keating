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
  arbPolicy, arbWeights, arbUnboundedPolicy, arbUnboundedWeights, arbLearnerProfile,
  policyIsBounded, weightsAreNormalized, weightsAreBounded,
  benchmarkScoresAreBounded, suppressConsoleError, createDeterministicBenchmark
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

test("ALWAYS: noveltyScore is symmetric for singleton archives", () => {
  fc.assert(fc.property(arbPolicy, arbPolicy, (a, b) => {
    const pa = clampPolicy(a);
    const pb = clampPolicy(b);
    const distAB = noveltyScore([pa], pb);
    const distBA = noveltyScore([pb], pa);
    expect(Math.abs(distAB - distBA)).toBeLessThan(0.001);
  }));
});

test("ALWAYS: noveltyScore with multi-member archive differs from symmetric swap", () => {
  fc.assert(fc.property(arbPolicy, arbPolicy, arbPolicy, (a, b, c) => {
    const pa = clampPolicy(a);
    const pb = clampPolicy(b);
    const pc = clampPolicy(c);
    const fromAB = noveltyScore([pa, pb], pc);
    const fromAC = noveltyScore([pa, pc], pb);
    expect(typeof fromAB).toBe("number");
    expect(typeof fromAC).toBe("number");
    expect(fromAB).toBeGreaterThanOrEqual(0);
    expect(fromAC).toBeGreaterThanOrEqual(0);
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
  fc.assert(fc.property(arbUnboundedPolicy, (raw) => {
    const clamped = clampPolicy(raw);
    expect(policyIsBounded(clamped)).toBe(true);
  }));
});

test("ALWAYS: clampWeights always produces normalized and bounded weights", () => {
  fc.assert(fc.property(arbUnboundedWeights, (raw) => {
    const clamped = clampWeights(raw);
    expect(weightsAreBounded(clamped)).toBe(true);
    expect(weightsAreNormalized(clamped)).toBe(true);
  }));
});

test("ALWAYS: clampPolicy is idempotent", () => {
  fc.assert(fc.property(arbPolicy, (policy) => {
    const once = clampPolicy(policy);
    const twice = clampPolicy(once);
    expect(twice).toEqual(once);
  }));
});

test("ALWAYS: clampWeights is idempotent", () => {
  fc.assert(fc.property(arbWeights, (weights) => {
    const once = clampWeights(weights);
    const twice = clampWeights(once);
    expect(twice).toEqual(once);
  }));
});

test("ALWAYS: clampPolicy on unbounded input is idempotent after first clamp", () => {
  fc.assert(fc.property(arbUnboundedPolicy, (raw) => {
    const once = clampPolicy(raw);
    const twice = clampPolicy(once);
    expect(twice).toEqual(once);
  }));
});

test("ALWAYS: clampWeights on unbounded input is idempotent after first clamp", () => {
  fc.assert(fc.property(arbUnboundedWeights, (raw) => {
    const once = clampWeights(raw);
    const twice = clampWeights(once);
    expect(twice).toEqual(once);
  }));
});

// ─── Integration tests (using deterministic benchmark stub) ────────────────

test("accepted evolution candidates never underperform the current best by construction", async () => {
  if (!process.env.GOOGLE_API_KEY && !process.env.GEMINI_API_KEY) return;
  await suppressConsoleError(async () => {
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
  });
}, 60000);

test("benchmark suite remains deterministic for fixed policy and seed", async () => {
  if (!process.env.GOOGLE_API_KEY && !process.env.GEMINI_API_KEY) return;
  await suppressConsoleError(async () => {
    const left = await runBenchmarkSuite(process.cwd(), DEFAULT_POLICY, "derivative", 99);
    const right = await runBenchmarkSuite(process.cwd(), DEFAULT_POLICY, "derivative", 99);
    expect(left).toEqual(right);
  });
}, 60000);

import { test, expect } from "bun:test";
import * as fc from "fast-check";
import { optimizePolicy } from "../src/core/ax-optimizer.js";
import { DEFAULT_POLICY, clampPolicy } from "../src/core/policy.js";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureProjectScaffold } from "../src/core/project.js";
import { policyIsBounded, benchmarkScoresAreBounded } from "./helpers.js";

test("GEPA policy optimizer runs and returns an evolution run", async () => {
  const origError = console.error;
  console.error = () => {};
  try {
    const workdir = await mkdtemp(join(tmpdir(), "keating-ax-opt-"));
    await ensureProjectScaffold(workdir);

    const result = await optimizePolicy(workdir, DEFAULT_POLICY, {
      nTrials: 2,
      objectives: ["score"]
    });

    expect(result.baseline).toBeDefined();
    expect(result.best).toBeDefined();
    expect(result.archive).toBeDefined();
    expect(typeof result.baseline.overallScore).toBe("number");
    expect(benchmarkScoresAreBounded(result.baseline)).toBe(true);
    expect(benchmarkScoresAreBounded(result.best)).toBe(true);
    expect(policyIsBounded(result.best.policy)).toBe(true);
    expect(policyIsBounded(result.archive.currentPolicy)).toBe(true);
  } finally {
    console.error = origError;
  }
}, 60000);

test("ALWAYS: GEPA optimizer result has non-negative candidate counts", async () => {
  const origError = console.error;
  console.error = () => {};
  try {
    const workdir = await mkdtemp(join(tmpdir(), "keating-ax-opt-"));
    await ensureProjectScaffold(workdir);

    const result = await optimizePolicy(workdir, DEFAULT_POLICY, {
      nTrials: 2,
      objectives: ["score"]
    });

    expect(result.exploredCandidates.length).toBeGreaterThanOrEqual(0);
    expect(result.acceptedCandidates.length).toBeGreaterThanOrEqual(0);
    expect(result.exploredCandidates.length).toBeGreaterThanOrEqual(result.acceptedCandidates.length);

    for (const candidate of result.exploredCandidates) {
      expect(policyIsBounded(candidate.policy)).toBe(true);
      expect(candidate.novelty).toBeGreaterThanOrEqual(0);
    }
  } finally {
    console.error = origError;
  }
}, 60000);

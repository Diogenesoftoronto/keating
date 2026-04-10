import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runBenchmarkSuite } from "../src/core/benchmark.js";
import { evolvePolicy, noveltyScore } from "../src/core/evolution.js";
import { DEFAULT_POLICY } from "../src/core/policy.js";

test("accepted evolution candidates never underperform the current best by construction", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "keating-evolution-"));
  const archivePath = join(workdir, "archive.json");
  const run = await evolvePolicy(archivePath, DEFAULT_POLICY, undefined, 20, 1234);
  assert.ok(run.best.overallScore >= run.baseline.overallScore);
  for (const candidate of run.acceptedCandidates) {
    assert.ok(candidate.novelty >= 0.05);
    assert.ok(candidate.benchmark.overallScore >= run.baseline.overallScore);
  }
  const saved = JSON.parse(await readFile(archivePath, "utf8"));
  assert.equal(saved.currentPolicy.name, run.best.policy.name);
});

test("noveltyScore uses Euclidean distance in parameter space", () => {
  const base = { ...DEFAULT_POLICY };
  const identical = { ...DEFAULT_POLICY };
  const different = { ...DEFAULT_POLICY, analogyDensity: 0.1, formalism: 0.1 };

  // Identical policy should have zero distance
  const identicalNovelty = noveltyScore([base], identical);
  assert.equal(identicalNovelty, 0);

  // Different policy should have positive distance
  const differentNovelty = noveltyScore([base], different);
  assert.ok(differentNovelty > 0, `expected positive novelty, got ${differentNovelty}`);

  // Empty archive should return 1
  const emptyNovelty = noveltyScore([], different);
  assert.equal(emptyNovelty, 1);
});

test("benchmark suite remains deterministic for fixed policy and seed", async () => {
  const left = await runBenchmarkSuite(process.cwd(), DEFAULT_POLICY, "derivative", 99);
  const right = await runBenchmarkSuite(process.cwd(), DEFAULT_POLICY, "derivative", 99);
  assert.deepEqual(left, right);
});

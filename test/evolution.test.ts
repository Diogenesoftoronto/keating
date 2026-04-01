import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runBenchmarkSuite } from "../src/core/benchmark.js";
import { evolvePolicy } from "../src/core/evolution.js";
import { DEFAULT_POLICY } from "../src/core/policy.js";

test("accepted evolution candidates never underperform the current best by construction", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "keating-evolution-"));
  const archivePath = join(workdir, "archive.json");
  const run = await evolvePolicy(archivePath, DEFAULT_POLICY, undefined, 20, 1234);
  assert.ok(run.best.overallScore >= run.baseline.overallScore);
  for (const candidate of run.acceptedCandidates) {
    assert.ok(candidate.novelty >= 0.08);
    assert.ok(candidate.benchmark.overallScore >= run.baseline.overallScore);
  }
  const saved = JSON.parse(await readFile(archivePath, "utf8"));
  assert.equal(saved.currentPolicy.name, run.best.policy.name);
});

test("benchmark suite remains deterministic for fixed policy and seed", () => {
  const left = runBenchmarkSuite(DEFAULT_POLICY, "derivative", 99);
  const right = runBenchmarkSuite(DEFAULT_POLICY, "derivative", 99);
  assert.deepEqual(left, right);
});

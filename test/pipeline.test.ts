import { test, expect } from "bun:test";
import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { configPath } from "../src/core/config.js";
import { learnerStatePath } from "../src/core/paths.js";
import { loadLearnerState, recordFeedback, saveLearnerState } from "../src/core/learner-state.js";
import {
  animateTopicArtifact,
  autoImproveArtifact,
  benchPolicyArtifact,
  currentPolicySummary,
  ensureProjectScaffold,
  evolvePolicyArtifact,
  evolvePromptArtifact,
  exportKeatingData,
  listArtifacts,
  mapTopicArtifact,
  planTopicArtifact
} from "../src/core/project.js";

test("acceptance pipeline creates plans, maps, animations, benchmark reports, and evolved policy state", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "keating-pipeline-"));
  await ensureProjectScaffold(workdir);
  await mkdir(join(workdir, "pi", "prompts"), { recursive: true });
  await writeFile(
    join(workdir, "pi", "prompts", "learn.md"),
    `---
description: Teach a concept adaptively with a mastery-first lesson loop.
---
Teach the learner the following topic: $@

Workflow:
1. Start with a diagnostic question or assumption check.
2. Give at least one worked example.
3. Ask for retrieval or reconstruction, not just agreement.
`
  );

  const plan = await planTopicArtifact(workdir, "derivative");
  const map = await mapTopicArtifact(workdir, "derivative");
  const animation = await animateTopicArtifact(workdir, "derivative");
  const learnerState = await loadLearnerState(learnerStatePath(workdir));
  for (let i = 0; i < 5; i += 1) {
    recordFeedback(learnerState, "derivative", i === 0 ? "confused" : "thumbs-up");
  }
  await saveLearnerState(learnerStatePath(workdir), learnerState);
  const bench = await benchPolicyArtifact(workdir, "derivative");
  const evolution = await evolvePolicyArtifact(workdir, "derivative");
  const promptEvolution = await evolvePromptArtifact(workdir, "learn");
  const fineTuneExport = await exportKeatingData(workdir, {
    mode: "finetune",
    source: "artifacts",
    format: "chatml",
    redact: true,
    minAssistantChars: 80,
  });

  await access(plan.planPath);
  await access(map.mmdPath);
  await access(animation.playerPath);
  await access(animation.scenePath);
  await access(animation.storyboardPath);
  await access(animation.manifestPath);
  await access(bench.reportPath);
  await access(bench.tracePath!);
  await access(evolution.reportPath);
  await access(evolution.tracePath!);
  await access(evolution.policyPath);
  await access(promptEvolution.reportPath);
  await access(promptEvolution.evolvedPromptPath);
  await access(fineTuneExport.manifestPath);
  await access(configPath(workdir));

  const summary = await currentPolicySummary(workdir);
  const report = await readFile(bench.reportPath, "utf8");
  const trace = await readFile(evolution.tracePath!, "utf8");
  const storyboard = await readFile(animation.storyboardPath, "utf8");
  const manifest = await readFile(animation.manifestPath, "utf8");
  const promptReport = await readFile(promptEvolution.reportPath, "utf8");
  const activePolicy = JSON.parse(await readFile(evolution.policyPath, "utf8"));
  const policyArchive = JSON.parse(await readFile(join(workdir, ".keating", "state", "policy-archive.json"), "utf8"));
  const artifacts = await listArtifacts(workdir);
  expect(summary.includes("Policy:")).toBe(true);
  expect(report.includes("# Benchmark Report")).toBe(true);
  expect(trace.includes("\"decision\"")).toBe(true);
  expect(storyboard.includes("# Animation Storyboard: Derivative")).toBe(true);
  expect(manifest.includes("\"sceneKind\": \"function-graph\"")).toBe(true);
  expect(promptReport.includes("# Prompt Evolution Report: learn")).toBe(true);
  expect(policyArchive.currentPolicy.name).toBe(activePolicy.name);
  expect(Math.abs(policyArchive.bestScore - evolution.bestScore)).toBeLessThan(0.001);
  expect(policyArchive.candidates.length).toBeGreaterThan(0);
  expect(artifacts.some((artifact) => artifact.path.endsWith("animations/derivative/player.html"))).toBe(true);
  expect(artifacts.some((artifact) => artifact.path.endsWith("prompt-evolution/learn.evolved.md"))).toBe(true);
  expect(artifacts.some((artifact) => artifact.path.endsWith("manifest.json"))).toBe(true);
}, { timeout: 60000 });

test("auto-improve writes observable transaction artifacts", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "keating-auto-improve-observability-"));
  await ensureProjectScaffold(workdir);
  await mkdir(join(workdir, "pi", "prompts"), { recursive: true });
  await writeFile(
    join(workdir, "pi", "prompts", "learn.md"),
    `Teach with diagnosis, own voice, retrieval, transfer, and verification.`
  );
  const learnerState = await loadLearnerState(learnerStatePath(workdir));
  for (let i = 0; i < 5; i += 1) {
    recordFeedback(learnerState, "derivative", i === 0 ? "confused" : "thumbs-up");
  }
  await saveLearnerState(learnerStatePath(workdir), learnerState);

  const result = await autoImproveArtifact(workdir, "derivative", { force: true });
  await access(result.reportPath);
  await access(result.observabilityPath);
  await access(result.diagramPath);

  const report = await readFile(result.reportPath, "utf8");
  const observability = JSON.parse(await readFile(result.observabilityPath, "utf8"));
  const diagram = await readFile(result.diagramPath, "utf8");
  expect(report.includes("## Observability Artifacts")).toBe(true);
  expect(observability.artifacts.baselineBenchmark).toContain("derivative-auto-improve-baseline.md");
  expect(observability.artifacts.afterBenchmark).toContain("derivative-auto-improve-after.md");
  expect(observability.artifacts.baselineBenchmark).not.toBe(observability.artifacts.afterBenchmark);
  expect(typeof observability.rollback.triggered).toBe("boolean");
  expect(diagram.includes("flowchart TD")).toBe(true);
}, { timeout: 60000 });

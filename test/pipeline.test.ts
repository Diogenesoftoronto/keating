import { test, expect } from "bun:test";
import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { configPath } from "../src/core/config.js";
import {
  animateTopicArtifact,
  benchPolicyArtifact,
  currentPolicySummary,
  ensureProjectScaffold,
  evolvePolicyArtifact,
  evolvePromptArtifact,
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
  const bench = await benchPolicyArtifact(workdir, "derivative");
  const evolution = await evolvePolicyArtifact(workdir, "derivative");
  const promptEvolution = await evolvePromptArtifact(workdir, "learn");

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
  await access(configPath(workdir));

  const summary = await currentPolicySummary(workdir);
  const report = await readFile(bench.reportPath, "utf8");
  const trace = await readFile(evolution.tracePath!, "utf8");
  const storyboard = await readFile(animation.storyboardPath, "utf8");
  const manifest = await readFile(animation.manifestPath, "utf8");
  const promptReport = await readFile(promptEvolution.reportPath, "utf8");
  const artifacts = await listArtifacts(workdir);
  expect(summary.includes("Policy:")).toBe(true);
  expect(report.includes("# Benchmark Report")).toBe(true);
  expect(trace.includes("\"decision\"")).toBe(true);
  expect(storyboard.includes("# Animation Storyboard: Derivative")).toBe(true);
  expect(manifest.includes("\"sceneKind\": \"function-graph\"")).toBe(true);
  expect(promptReport.includes("# Prompt Evolution Report: learn")).toBe(true);
  expect(artifacts.some((artifact) => artifact.path.endsWith("animations/derivative/player.html"))).toBe(true);
  expect(artifacts.some((artifact) => artifact.path.endsWith("prompt-evolution/learn.evolved.md"))).toBe(true);
}, { timeout: 60000 });

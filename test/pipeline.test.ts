import { afterEach, test, expect } from "bun:test";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { EpisodeJudge, EpisodeRunner, SkillProposer, TeachingCase } from "../shared/evolution/contracts.js";
import { activeTeachingPrompt, teachingBenchmarkArtifact } from "../src/core/teaching-evolution.js";

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

test("acceptance pipeline creates artifacts and unvalidated policy proposals without activating them", async () => {
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
  const policyBefore = await currentPolicySummary(workdir);
  const archivePath = join(workdir, ".keating", "state", "policy-archive.json");
  const archiveBefore = JSON.stringify({ currentPolicy: "existing-policy", candidates: [{ accepted: true, iteration: 1 }] });
  await writeFile(archivePath, archiveBefore);
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
  const proposals = JSON.parse(await readFile(join(workdir, ".keating", "outputs", "evolution", "derivative.proposals.json"), "utf8"));
  const artifacts = await listArtifacts(workdir);
  expect(summary.includes("Policy:")).toBe(true);
  expect(report.includes("# Benchmark Report")).toBe(true);
  expect(trace.includes("\"decision\"")).toBe(true);
  expect(storyboard.includes("# Animation Storyboard: Derivative")).toBe(true);
  expect(manifest.includes("\"sceneKind\": \"function-graph\"")).toBe(true);
  expect(promptReport.includes("# Prompt Evolution Report: learn")).toBe(true);
  expect(summary).toBe(policyBefore);
  expect(await readFile(archivePath, "utf8")).toBe(archiveBefore);
  expect(proposals.status).toBe("unvalidated-proposal");
  expect(proposals.proposals.length).toBeGreaterThan(0);
  expect(proposals.proposals.every((candidate: { decision: { accepted: boolean } }) => !candidate.decision.accepted)).toBe(true);
  expect(await readFile(evolution.reportPath, "utf8")).toContain("active policy is unchanged");
  expect(artifacts.some((artifact) => artifact.path.endsWith("animations/derivative/player.html"))).toBe(true);
  expect(artifacts.some((artifact) => artifact.path.endsWith("prompt-evolution/learn.evolved.md"))).toBe(true);
  expect(artifacts.some((artifact) => artifact.path.endsWith("manifest.json"))).toBe(true);
}, { timeout: 60000 });

const experimentDirs: string[] = [];
afterEach(async () => { await Promise.all(experimentDirs.splice(0).map((cwd) => rm(cwd, { recursive: true, force: true }))); });
async function experimentWorkspace() {
  const cwd = await mkdtemp(join(tmpdir(), "keating-experiment-pipeline-"));
  experimentDirs.push(cwd);
  return cwd;
}
const experimentCases: TeachingCase[] = ["train", "validation", "holdout"].flatMap((split) =>
  Array.from({ length: split === "train" ? 1 : 6 }, (_, index) => ({
    id: `${split}-${index}`, family: `${split}-family-${index}`, domain: "mathematics" as const,
    split: split as TeachingCase["split"], messages: [{ role: "user" as const, content: `Help me understand test concept ${split}-${index}.` }],
    rubric: [
      { id: "accurate", description: "Preserves factual accuracy.", critical: true },
      { id: "diagnostic", description: "Diagnoses the learner misconception.", critical: false },
      { id: "check", description: "Checks an independent learner attempt.", critical: false },
    ],
  })));
function injectedExperiment(mode: "accepted" | "critical-regression" | "failed" = "accepted") {
  const runner: EpisodeRunner = async ({ systemPrompt }) => {
    if (mode === "failed") throw new Error("deterministic transport failure");
    return {
      messages: [{ role: "assistant", content: systemPrompt.includes("PIPELINE_REPAIR_SIGNAL") ? "candidate" : "baseline" }],
      toolCalls: [], model: "deterministic-test-model", runtime: "deterministic-test-runtime",
    };
  };
  const judge: EpisodeJudge = async ({ testCase, execution }) => testCase.rubric.map((criterion) => {
    const candidate = execution.messages[0]?.content === "candidate";
    return { criterionId: criterion.id, passed: criterion.critical ? !(candidate && mode === "critical-regression") : candidate, rationale: "Fixed deterministic fixture judgment." };
  });
  const proposer: SkillProposer = async ({ training }) => ({
    skill: { id: "pipeline-repair", title: "Diagnostic check", instructions: "PIPELINE_REPAIR_SIGNAL: diagnose and check an independent attempt.", hypothesis: "A diagnostic check repairs the observed behavior.", evidenceIds: [training.results[0]!.id] },
    hypothesis: { id: "pipeline-hypothesis", statement: "A diagnostic check repairs the observed behavior.", evidenceIds: [training.results[0]!.id], status: "proposed" },
  });
  return { cases: experimentCases, runner, judge, proposer };
}

test("auto-improve persists fresh episode evidence and activates exactly the accepted revision", async () => {
  const workdir = await experimentWorkspace();
  const before = await activeTeachingPrompt(workdir);
  const result = await autoImproveArtifact(workdir, undefined, injectedExperiment());
  await access(result.reportPath);
  await access(result.observabilityPath);
  await access(result.diagramPath);

  const report = await readFile(result.reportPath, "utf8");
  const observability = JSON.parse(await readFile(result.observabilityPath, "utf8"));
  const diagram = await readFile(result.diagramPath, "utf8");
  expect(result.status).toBe("accepted");
  expect(observability.baselineRevisionId).toBe(before.revisionId);
  expect(observability.humanLearning).toBe("unmeasured");
  expect(observability.validation.decision.accepted).toBe(true);
  expect(observability.holdout.decision.accepted).toBe(true);
  expect(report).toContain("Human learning, retention, and transfer: unmeasured");
  const active = await activeTeachingPrompt(workdir);
  expect(active.revisionId).toBe(observability.candidateRevisionId);
  expect(active.prompt).toContain("PIPELINE_REPAIR_SIGNAL");
  expect(diagram.includes("flowchart TD")).toBe(true);
  await expect(autoImproveArtifact(workdir, undefined, { ...injectedExperiment(), force: true })).rejects.toThrow("holdout_consumed");
});

test("a positive score delta cannot activate a candidate with a critical regression", async () => {
  const cwd = await experimentWorkspace();
  const before = await activeTeachingPrompt(cwd);
  const result = await autoImproveArtifact(cwd, undefined, injectedExperiment("critical-regression"));
  expect(result.delta).toBeGreaterThan(0);
  expect(result.status).toBe("rejected");
  expect(result.experiment.reasons).toContain("critical_criterion_failed");
  expect(result.experiment.holdout).toBeNull();
  expect(await activeTeachingPrompt(cwd)).toEqual(before);
});

test("execution failures remain failed and unscored without changing the active revision", async () => {
  const cwd = await experimentWorkspace();
  const before = await activeTeachingPrompt(cwd);
  const result = await autoImproveArtifact(cwd, undefined, injectedExperiment("failed"));
  expect(result.status).toBe("failed");
  expect(result.baselineScore).toBeNull();
  expect(result.afterScore).toBeNull();
  expect(result.delta).toBeNull();
  expect(await activeTeachingPrompt(cwd)).toEqual(before);
});

test("teaching-bench runs only training cases and never activates a revision", async () => {
  const cwd = await experimentWorkspace();
  const seen: string[] = [];
  const injected = injectedExperiment();
  const { report } = await teachingBenchmarkArtifact(cwd, { ...injected, runner: async (input) => { seen.push(input.caseId); return injected.runner(input); } });
  expect(seen).toEqual(["train-0"]);
  expect(report.split).toBe("train");
  expect(report.evidenceKind).toBe("synthetic");
  expect((await activeTeachingPrompt(cwd)).prompt).not.toContain("PIPELINE_REPAIR_SIGNAL");
});

async function cli(cwd: string, args: string[]) {
  const process = Bun.spawn([Bun.which("bun")!, join(import.meta.dir, "..", "src", "cli", "main.ts"), ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
  return { stdout, stderr, exitCode };
}

test("CLI learning checks expose prompts and persist revision-linked answers", async () => {
  const cwd = await experimentWorkspace();
  const started = await cli(cwd, ["learning-check", "start", "fractions", "--learner", "learner-cli"]);
  expect(started.exitCode).toBe(0);
  const check = JSON.parse(started.stdout);
  expect(check.revisionId).toBe((await activeTeachingPrompt(cwd)).revisionId);
  expect(started.stdout).not.toMatch(/"expected"|"answerKey"|"correctAnswer"/);
  const answers = Object.fromEntries(check.stages[0].items.map((item: { id: string }, index: number) => [item.id, ["1/5", "12", "3/4"][index]]));
  const submitted = await cli(cwd, ["learning-check", "submit", check.id, "precheck", "--answers", JSON.stringify(answers), "--assistance", "none"]);
  expect(submitted.exitCode).toBe(0);
  expect(JSON.parse(submitted.stdout).stages[0].result.score).toBe(1);
  const listed = await cli(cwd, ["learning-check", "list"]);
  expect(JSON.parse(listed.stdout)[0].id).toBe(check.id);
  const shown = await cli(cwd, ["learning-check", "show", check.id]);
  expect(JSON.parse(shown.stdout).stages[0].result.revisionId).toBe(check.revisionId);
}, { timeout: 30000 });

test("CLI rejects holdout access and leaking case packs before provider execution", async () => {
  const cwd = await experimentWorkspace();
  const holdout = await cli(cwd, ["teaching-bench", "--split", "holdout"]);
  expect(holdout.exitCode).toBe(1);
  expect(holdout.stderr).toContain("Unsupported teaching-bench argument");
  const pack = join(cwd, "leaking-cases.json");
  await writeFile(pack, JSON.stringify(experimentCases.map((item) => ({ ...item, family: "same-family" }))));
  const invalid = await cli(cwd, ["auto-improve", "--cases", pack, "--force"]);
  expect(invalid.exitCode).toBe(1);
  expect(invalid.stderr).toContain("case_family_leakage");
  const help = await cli(cwd, ["auto-improve", "--help"]);
  expect(help.exitCode).toBe(0);
  expect(help.stdout).toContain("cooldown only");
}, { timeout: 30000 });

import { readdir, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { loadKeatingConfig } from "./config.js";
import { writeLessonAnimation } from "./animation.js";
import { benchmarkToMarkdown, runBenchmarkSuite } from "./benchmark.js";
import { evolutionToMarkdown, evolvePolicy } from "./evolution.js";
import { buildLessonPlan, lessonPlanToMarkdown } from "./lesson-plan.js";
import { writeLessonMap } from "./map.js";
import { writePromptEvolutionArtifacts } from "./prompt-evolution.js";
import {
  animationsDir,
  benchmarksDir,
  currentPolicyPath,
  ensureKeatingDirs,
  evolutionDir,
  mapsDir,
  plansDir,
  policyArchivePath,
  promptEvolutionDir,
  tracesDir,
  verificationsDir,
  verificationCachePath
} from "./paths.js";
import { ensureConfig } from "./config.js";
import { DEFAULT_POLICY, loadPolicy, savePolicy } from "./policy.js";
import { resolveTopic } from "./topics.js";
import { slugify } from "./util.js";
import {
  buildPendingVerificationResult,
  buildVerificationChecklist,
  loadVerificationCache,
  runCoveVerification,
  saveVerificationCache,
  verificationStatus
} from "./verification.js";
import { type VerificationResult } from "./types.js";
import {
  generateImprovementArtifact,
  loadImprovementArchive,
  improvementHistoryToMarkdown,
  evaluateImprovement,
  acceptImprovement,
  rejectImprovement,
  type ImprovementArtifact
} from "./self-improve.js";

export async function ensureProjectScaffold(cwd: string): Promise<void> {
  await ensureKeatingDirs(cwd);
  await ensureConfig(cwd);
  const policy = await loadPolicy(currentPolicyPath(cwd));
  await savePolicy(currentPolicyPath(cwd), policy ?? DEFAULT_POLICY);
}

export async function planTopicArtifact(cwd: string, topicName: string): Promise<{ planPath: string }> {
  await ensureProjectScaffold(cwd);
  const policy = await loadPolicy(currentPolicyPath(cwd));
  const plan = buildLessonPlan(topicName, policy);
  const planPath = join(plansDir(cwd), `${slugify(topicName)}.md`);
  await writeFile(planPath, lessonPlanToMarkdown(plan), "utf8");
  return { planPath };
}

export async function mapTopicArtifact(
  cwd: string,
  topicName: string
): Promise<{ mmdPath: string; svgPath: string | null }> {
  await ensureProjectScaffold(cwd);
  const policy = await loadPolicy(currentPolicyPath(cwd));
  return writeLessonMap(cwd, topicName, policy);
}

export async function animateTopicArtifact(cwd: string, topicName: string) {
  await ensureProjectScaffold(cwd);
  const policy = await loadPolicy(currentPolicyPath(cwd));
  return writeLessonAnimation(cwd, topicName, policy);
}

export async function benchPolicyArtifact(
  cwd: string,
  focusTopic?: string
): Promise<{ reportPath: string; tracePath: string | null; overallScore: number }> {
  await ensureProjectScaffold(cwd);
  const config = await loadKeatingConfig(cwd);
  const policy = await loadPolicy(currentPolicyPath(cwd));
  const result = await runBenchmarkSuite(cwd, policy, focusTopic, 20260401, config.debug.traceTopLearners);
  const fileName = focusTopic ? `${slugify(focusTopic)}.md` : "core-suite.md";
  const reportPath = join(benchmarksDir(cwd), fileName);
  await writeFile(reportPath, benchmarkToMarkdown(result), "utf8");
  const tracePath = config.debug.persistTraces
    ? join(tracesDir(cwd), `${focusTopic ? slugify(focusTopic) : "core-suite"}-benchmark.json`)
    : null;
  if (tracePath) {
    await writeFile(tracePath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  return { reportPath, tracePath, overallScore: result.overallScore };
}

export async function evolvePolicyArtifact(
  cwd: string,
  focusTopic?: string
): Promise<{ reportPath: string; tracePath: string | null; bestScore: number; policyPath: string }> {
  await ensureProjectScaffold(cwd);
  const config = await loadKeatingConfig(cwd);
  const policyPath = currentPolicyPath(cwd);
  const basePolicy = await loadPolicy(policyPath);
  const run = await evolvePolicy(policyArchivePath(cwd), basePolicy, focusTopic);
  await savePolicy(policyPath, run.best.policy);
  const fileName = focusTopic ? `${slugify(focusTopic)}.md` : "latest.md";
  const reportPath = join(evolutionDir(cwd), fileName);
  await writeFile(reportPath, evolutionToMarkdown(run), "utf8");
  const tracePath = config.debug.persistTraces
    ? join(tracesDir(cwd), `${focusTopic ? slugify(focusTopic) : "latest"}-evolution.json`)
    : null;
  if (tracePath) {
    await writeFile(tracePath, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  }
  return { reportPath, tracePath, bestScore: run.best.overallScore, policyPath };
}

export async function evolvePromptArtifact(
  cwd: string,
  promptName = "learn"
): Promise<{ reportPath: string; evolvedPromptPath: string; bestScore: number; promptPath: string }> {
  await ensureProjectScaffold(cwd);
  return writePromptEvolutionArtifacts(cwd, promptName);
}

export async function verifyTopicArtifact(
  cwd: string,
  topicName: string,
  useLLM = true
): Promise<{ checklistPath: string; alreadyVerified: boolean; result?: VerificationResult }> {
  await ensureProjectScaffold(cwd);
  const topic = resolveTopic(topicName);
  const cachePath = verificationCachePath(cwd);
  const cache = await loadVerificationCache(cachePath);
  const existing = verificationStatus(topic, cache);

  if (existing && existing.claims.every((c) => c.status !== "unconfirmed")) {
    return {
      checklistPath: join(verificationsDir(cwd), `${topic.slug}.md`),
      alreadyVerified: true,
      result: existing
    };
  }

  let result: VerificationResult;
  if (useLLM) {
    try {
      result = await runCoveVerification(cwd, topic);
      cache[topic.slug] = result;
      await saveVerificationCache(cachePath, cache);
    } catch (error) {
      console.warn(`CoVe verification failed for ${topic.slug}, falling back to manual checklist:`, error);
      result = buildPendingVerificationResult(topic);
    }
  } else {
    result = buildPendingVerificationResult(topic);
  }

  const checklist = buildVerificationChecklist(topic, result);
  const checklistPath = join(verificationsDir(cwd), `${topic.slug}.md`);
  await writeFile(checklistPath, checklist, "utf8");

  return { checklistPath, alreadyVerified: false, result };
}

export async function improveArtifact(cwd: string): Promise<ImprovementArtifact> {
  await ensureProjectScaffold(cwd);
  return generateImprovementArtifact(cwd);
}

export async function improveAccept(cwd: string, proposalId: string): Promise<{ afterScore: number; delta: number }> {
  await ensureProjectScaffold(cwd);
  const evaluation = await evaluateImprovement(cwd, 0);
  await acceptImprovement(cwd, proposalId, evaluation.afterScore);
  return { afterScore: evaluation.afterScore, delta: evaluation.delta };
}

export async function improveReject(cwd: string, proposalId: string, snapshots: any[]): Promise<void> {
  await ensureProjectScaffold(cwd);
  await rejectImprovement(cwd, proposalId, snapshots);
}

export async function improveHistory(cwd: string): Promise<string> {
  await ensureProjectScaffold(cwd);
  const archive = await loadImprovementArchive(cwd);
  return improvementHistoryToMarkdown(archive);
}

export async function currentPolicySummary(cwd: string): Promise<string> {
  await ensureProjectScaffold(cwd);
  const policy = await loadPolicy(currentPolicyPath(cwd));
  return [
    `Policy: ${policy.name}`,
    `analogyDensity=${policy.analogyDensity.toFixed(2)}`,
    `socraticRatio=${policy.socraticRatio.toFixed(2)}`,
    `formalism=${policy.formalism.toFixed(2)}`,
    `retrievalPractice=${policy.retrievalPractice.toFixed(2)}`,
    `exerciseCount=${policy.exerciseCount}`,
    `diagramBias=${policy.diagramBias.toFixed(2)}`,
    `reflectionBias=${policy.reflectionBias.toFixed(2)}`,
    `interdisciplinaryBias=${policy.interdisciplinaryBias.toFixed(2)}`,
    `challengeRate=${policy.challengeRate.toFixed(2)}`
  ].join("\n");
}

export async function listArtifacts(cwd: string): Promise<Array<{ label: string; path: string }>> {
  await ensureProjectScaffold(cwd);
  const roots = [
    plansDir(cwd),
    mapsDir(cwd),
    animationsDir(cwd),
    benchmarksDir(cwd),
    evolutionDir(cwd),
    promptEvolutionDir(cwd),
    tracesDir(cwd),
    verificationsDir(cwd)
  ];
  const artifacts: Array<{ label: string; path: string; mtime: number }> = [];

  async function collectFiles(root: string): Promise<string[]> {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    const files: string[] = [];
    for (const entry of entries) {
      if (entry.name === "_vendor") continue;
      const fullPath = join(root, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await collectFiles(fullPath)));
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
    return files;
  }

  for (const root of roots) {
    for (const fullPath of await collectFiles(root)) {
      const info = await stat(fullPath);
      artifacts.push({
        label: `${relative(cwd, fullPath)} (${Math.round(info.size / 1024) || 1}KB)`,
        path: relative(cwd, fullPath),
        mtime: info.mtimeMs
      });
    }
  }

  return artifacts
    .sort((left, right) => right.mtime - left.mtime)
    .map((artifact) => ({ label: artifact.label, path: artifact.path }));
}

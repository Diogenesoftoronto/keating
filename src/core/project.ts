import { copyFile, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { loadKeatingConfig } from "./config.js";
import { writeLessonAnimation } from "./animation.js";
import { applyFeedbackBias, benchmarkToMarkdown, extractHarnessOutcomes, runBenchmarkSuite, type FeedbackSummary } from "./benchmark.js";
import { MIN_REAL_OUTCOMES, hasEnoughRealData } from "./benchmark-real.js";
import {
  buildEngagementTimeline,
  dueTopics,
  dueTopicsToMarkdown,
  engagementTimelineToMarkdown,
  loadEngagementPolicy,
  DEFAULT_ENGAGEMENT_POLICY
} from "./engagement.js";
import { evolutionToMarkdown, evolvePolicy } from "./evolution.js";
import { mapElitesEvolve, mapElitesToMarkdown, mapElitesToEvolutionRun } from "./map-elites.js";
import { buildLessonPlan, lessonPlanToMarkdown } from "./lesson-plan.js";
import { writeLessonMap } from "./map.js";
import { evaluatePromptContent, type PromptObjectiveVector, writePromptEvolutionArtifacts } from "./prompt-evolution.js";
import {
  animationsDir,
  benchmarksDir,
  currentPolicyPath,
  ensureKeatingDirs,
  engagementPolicyPath,
  evolutionDir,
  exportsDir,
  improvementsDir,
  mapsDir,
  plansDir,
  policyArchivePath,
  promptEvolutionDir,
  timelineDir,
  tracesDir,
  verificationsDir,
  verificationCachePath,
  stateDir,
  learnerStatePath,
  quizDir,
  flashcardsDir,
  projectsDir,
  workbooksDir,
  masteryDir
} from "./paths.js";
import { exportFineTuneDataset, type KeatingExportManifest, type KeatingExportOptions } from "./export.js";
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
import { loadLearnerState } from "./learner-state.js";
import {
  generateImprovementArtifact,
  loadImprovementArchive,
  improvementHistoryToMarkdown,
  evaluateImprovement,
  acceptImprovement,
  rejectImprovement,
  type ImprovementArtifact
} from "./self-improve.js";
import {
  generateQuiz, quizToMarkdown, quizAnswerKeyToMarkdown,
  generateWorkbook, workbookToMarkdown
} from "./quiz.js";
import {
  generateFlashCards, flashcardsToMarkdown
} from "./flashcards.js";
import {
  generateProject, generateAssignment,
  projectToMarkdown, assignmentToMarkdown
} from "./projects.js";
import {
  generateDiagnosticQuestions
} from "./mastery.js";

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

async function writeArtifactWithTrace(
  cwd: string,
  outputDir: string,
  slug: string,
  markdownContent: string,
  traceSuffix: string,
  traceData: unknown
): Promise<{ reportPath: string; tracePath: string | null }> {
  const config = await loadKeatingConfig(cwd);
  const reportPath = join(outputDir, `${slug}.md`);
  await writeFile(reportPath, markdownContent, "utf8");
  const tracePath = config.debug.persistTraces
    ? join(tracesDir(cwd), `${slug}-${traceSuffix}.json`)
    : null;
  if (tracePath) {
    await writeFile(tracePath, `${JSON.stringify(traceData, null, 2)}\n`, "utf8");
  }
  return { reportPath, tracePath };
}

async function syncPolicyArchive(
  cwd: string,
  archive: {
    currentPolicy: unknown;
    bestScore: number;
    candidates: unknown[];
  }
): Promise<void> {
  let previousCandidates: unknown[] = [];
  try {
    const previous = JSON.parse(await readFile(policyArchivePath(cwd), "utf8")) as { candidates?: unknown[] };
    previousCandidates = Array.isArray(previous.candidates) ? previous.candidates : [];
  } catch {
    previousCandidates = [];
  }

  await writeFile(
    policyArchivePath(cwd),
    `${JSON.stringify({ ...archive, candidates: [...previousCandidates, ...archive.candidates] }, null, 2)}\n`,
    "utf8"
  );
}

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function snapshotFile(sourcePath: string | null, targetPath: string): Promise<string | null> {
  if (!sourcePath) return null;
  try {
    await copyFile(sourcePath, targetPath);
    return targetPath;
  } catch {
    return null;
  }
}

async function restoreOptionalSnapshot(filePath: string, snapshot: string | null): Promise<void> {
  if (snapshot === null) {
    await rm(filePath, { force: true });
    return;
  }
  await writeFile(filePath, snapshot, "utf8");
}

export async function benchPolicyArtifact(
  cwd: string,
  focusTopic?: string
): Promise<{ reportPath: string; tracePath: string | null; overallScore: number }> {
  await ensureProjectScaffold(cwd);
  const policy = await loadPolicy(currentPolicyPath(cwd));
  const learnerState = await loadLearnerState(learnerStatePath(cwd));
  const feedback = summarizeFeedback(learnerState.feedback);
  const weights = applyFeedbackBias(feedback);
  const result = await runBenchmarkSuite(cwd, policy, focusTopic, 20260401, 3, weights, learnerState);
  const slug = focusTopic ? slugify(focusTopic) : "core-suite";
  const { reportPath, tracePath } = await writeArtifactWithTrace(
    cwd, benchmarksDir(cwd), slug, benchmarkToMarkdown(result), "benchmark", result
  );
  return { reportPath, tracePath, overallScore: result.overallScore };
}

function summarizeFeedback(feedback: Array<{ signal: "thumbs-up" | "thumbs-down" | "confused" }>): FeedbackSummary {
  const sampleSize = feedback.length;
  if (sampleSize === 0) {
    return { confusionRate: 0, satisfactionRate: 0, sampleSize };
  }
  const confused = feedback.filter((entry) => entry.signal === "confused").length;
  const satisfied = feedback.filter((entry) => entry.signal === "thumbs-up").length;
  return {
    confusionRate: confused / sampleSize,
    satisfactionRate: satisfied / sampleSize,
    sampleSize
  };
}

export async function evolvePolicyArtifact(
  cwd: string,
  focusTopic?: string
): Promise<{ reportPath: string; tracePath: string | null; bestScore: number; policyPath: string }> {
  await ensureProjectScaffold(cwd);
  const policyPath = currentPolicyPath(cwd);
  const basePolicy = await loadPolicy(policyPath);
  const learnerState = await loadLearnerState(learnerStatePath(cwd));
  const realOutcomes = await extractHarnessOutcomes(cwd, learnerState);
  if (!hasEnoughRealData(realOutcomes)) {
    throw new Error(`Not ready to evolve: need at least ${MIN_REAL_OUTCOMES} learner feedback signals; found ${realOutcomes.length}.`);
  }
  const meRun = await mapElitesEvolve(cwd, basePolicy, { focusTopic, learnerState });
  const run = mapElitesToEvolutionRun(meRun);
  await savePolicy(policyPath, run.best.policy);
  await syncPolicyArchive(cwd, run.archive);
  const slug = focusTopic ? slugify(focusTopic) : "latest";
  const { reportPath, tracePath } = await writeArtifactWithTrace(
    cwd, evolutionDir(cwd), slug, mapElitesToMarkdown(meRun), "evolution", run
  );
  return { reportPath, tracePath, bestScore: run.best.overallScore, policyPath };
}

export async function evolvePromptArtifact(
  cwd: string,
  promptName = "learn"
): Promise<{ reportPath: string; evolvedPromptPath: string; bestScore: number; promptPath: string; accepted: boolean }> {
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
  const archive = await loadImprovementArchive(cwd);
  const attempt = archive.attempts.find((entry) => entry.proposal.id === proposalId);
  const evaluation = await evaluateImprovement(cwd, attempt?.baselineScore ?? 0);
  await acceptImprovement(cwd, proposalId, evaluation.afterScore);
  return { afterScore: evaluation.afterScore, delta: evaluation.delta };
}

export async function improveReject(cwd: string, proposalId: string, snapshots?: any[]): Promise<void> {
  await ensureProjectScaffold(cwd);
  if (snapshots) {
    await rejectImprovement(cwd, proposalId, snapshots);
    return;
  }
  const archive = await loadImprovementArchive(cwd);
  const attempt = archive.attempts.find((entry) => entry.proposal.id === proposalId);
  await rejectImprovement(cwd, proposalId, attempt?.snapshots ?? []);
}

export async function improveHistory(cwd: string): Promise<string> {
  await ensureProjectScaffold(cwd);
  const archive = await loadImprovementArchive(cwd);
  return improvementHistoryToMarkdown(archive);
}

interface AutoImproveState {
  lastRunAt?: string;
}

function autoImproveStatePath(cwd: string): string {
  return join(stateDir(cwd), "auto-improve.json");
}

async function loadAutoImproveState(cwd: string): Promise<AutoImproveState> {
  try {
    return JSON.parse(await readFile(autoImproveStatePath(cwd), "utf8")) as AutoImproveState;
  } catch {
    return {};
  }
}

async function saveAutoImproveState(cwd: string, state: AutoImproveState): Promise<void> {
  await writeFile(autoImproveStatePath(cwd), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function assertAutoImproveAllowed(state: AutoImproveState, force: boolean): void {
  if (force || !state.lastRunAt) return;
  const lastRunMs = Date.parse(state.lastRunAt);
  if (!Number.isFinite(lastRunMs)) return;
  const cooldownMs = 30 * 60 * 1000;
  const elapsedMs = Date.now() - lastRunMs;
  if (elapsedMs >= 0 && elapsedMs < cooldownMs) {
    const remainingMinutes = Math.ceil((cooldownMs - elapsedMs) / 60000);
    throw new Error(`auto-improve ran recently. Re-run with --force or wait ${remainingMinutes} minute(s).`);
  }
}

export async function autoImproveArtifact(
  cwd: string,
  focusTopic?: string,
  options: { force?: boolean } = {}
): Promise<{
  baselineScore: number;
  afterScore: number;
  delta: number;
  reportPath: string;
  observabilityPath: string;
  diagramPath: string;
}> {
  await ensureProjectScaffold(cwd);
  const state = await loadAutoImproveState(cwd);
  assertAutoImproveAllowed(state, options.force === true);
  const policyPath = currentPolicyPath(cwd);
  const previousPolicy = await loadPolicy(policyPath);
  const autoSlug = focusTopic ? `${slugify(focusTopic)}-auto-improve` : "auto-improve";
  const evolvedPromptPath = join(promptEvolutionDir(cwd), "learn.evolved.md");
  const previousPrompt = await readOptionalFile(evolvedPromptPath);

  const baseline = await benchPolicyArtifact(cwd, focusTopic);
  const baselineReportPath = await snapshotFile(
    baseline.reportPath,
    join(benchmarksDir(cwd), `${autoSlug}-baseline.md`)
  ) ?? baseline.reportPath;
  const baselineTracePath = await snapshotFile(
    baseline.tracePath,
    join(tracesDir(cwd), `${autoSlug}-baseline-benchmark.json`)
  );

  const evolved = await evolvePolicyArtifact(cwd, focusTopic);

  const promptEvo = await evolvePromptArtifact(cwd, "learn");

  const after = await benchPolicyArtifact(cwd, focusTopic);
  const afterReportPath = await snapshotFile(
    after.reportPath,
    join(benchmarksDir(cwd), `${autoSlug}-after.md`)
  ) ?? after.reportPath;
  const afterTracePath = await snapshotFile(
    after.tracePath,
    join(tracesDir(cwd), `${autoSlug}-after-benchmark.json`)
  );

  const delta = after.overallScore - baseline.overallScore;
  const rolledBack = delta < -0.5;
  if (rolledBack) {
    await savePolicy(policyPath, previousPolicy);
    await restoreOptionalSnapshot(evolvedPromptPath, previousPrompt);
  }
  await saveAutoImproveState(cwd, { lastRunAt: new Date().toISOString() });

  const reportPath = join(benchmarksDir(cwd), `${autoSlug}.md`);
  const observabilityPath = join(evolutionDir(cwd), `${autoSlug}.json`);
  const diagramPath = join(evolutionDir(cwd), `${autoSlug}.mmd`);
  const rel = (path: string | null) => path ? relative(cwd, path) : null;
  const verdict = delta > 0 ? "IMPROVED" : rolledBack ? "REGRESSED_ROLLED_BACK" : "NO_SIGNIFICANT_CHANGE";
  const observability = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    focusTopic: focusTopic ?? null,
    verdict,
    scores: {
      baseline: baseline.overallScore,
      after: after.overallScore,
      delta
    },
    rollback: {
      triggered: rolledBack,
      threshold: -0.5,
      policy: rolledBack,
      prompt: rolledBack
    },
    policy: {
      before: previousPolicy.name,
      candidate: evolved.bestScore,
      path: rel(policyPath),
      evolutionReport: rel(evolved.reportPath),
      evolutionTrace: rel(evolved.tracePath)
    },
    prompt: {
      name: "learn",
      accepted: promptEvo.accepted,
      report: rel(promptEvo.reportPath),
      evolvedPrompt: rel(promptEvo.evolvedPromptPath),
      hadPriorSnapshot: previousPrompt !== null
    },
    artifacts: {
      report: rel(reportPath),
      diagram: rel(diagramPath),
      baselineBenchmark: rel(baselineReportPath),
      baselineTrace: rel(baselineTracePath),
      afterBenchmark: rel(afterReportPath),
      afterTrace: rel(afterTracePath)
    }
  };

  const diagram = [
    "flowchart TD",
    `  A["Baseline benchmark<br/>${baseline.overallScore.toFixed(2)}/100"]`,
    `  B["MAP-Elites policy evolution<br/>best ${evolved.bestScore.toFixed(2)}/100"]`,
    `  C["Prompt evolution<br/>${promptEvo.accepted ? "accepted" : "unchanged"}"]`,
    `  D["Post-change benchmark<br/>${after.overallScore.toFixed(2)}/100"]`,
    `  E{"Delta ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}"}`,
    `  F["Keep current artifacts"]`,
    `  G["Rollback policy and prompt"]`,
    "  A --> B --> C --> D --> E",
    `  E -->|${rolledBack ? "regressed" : "not regressed"}| ${rolledBack ? "G" : "F"}`
  ].join("\n");

  const report = [
    `# Auto-Improve Report`,
    ``,
    `**Baseline:** ${baseline.overallScore.toFixed(2)}/100`,
    `**After:** ${after.overallScore.toFixed(2)}/100`,
    `**Delta:** ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`,
    `**Verdict:** ${delta > 0 ? "IMPROVED" : rolledBack ? "REGRESSED (policy and prompt rolled back)" : "NO SIGNIFICANT CHANGE"}`,
    ``,
    `## Benchmark`,
    `- Baseline report: ${relative(cwd, baselineReportPath)}`,
    ...(baselineTracePath ? [`- Baseline trace: ${relative(cwd, baselineTracePath)}`] : []),
    `- After report: ${relative(cwd, afterReportPath)}`,
    ...(afterTracePath ? [`- After trace: ${relative(cwd, afterTracePath)}`] : []),
    ``,
    `## Policy Evolution`,
    `- Best: ${evolved.bestScore.toFixed(2)}/100`,
    `- Report: ${relative(cwd, evolved.reportPath)}`,
    `- Rolled back: ${rolledBack ? "yes" : "no"}`,
    ``,
    `## Prompt Evolution`,
    `- Best: ${promptEvo.bestScore.toFixed(2)}/100`,
    `- Accepted: ${promptEvo.accepted ? "yes" : "no"}`,
    `- Report: ${relative(cwd, promptEvo.reportPath)}`,
    `- Rolled back: ${rolledBack ? "yes" : "no"}`,
    ``,
    `## Observability Artifacts`,
    `- JSON transaction: ${relative(cwd, observabilityPath)}`,
    `- Mermaid flow: ${relative(cwd, diagramPath)}`,
    ``,
  ].join("\n");

  await writeFile(reportPath, report, "utf8");
  await writeFile(observabilityPath, `${JSON.stringify(observability, null, 2)}\n`, "utf8");
  await writeFile(diagramPath, `${diagram}\n`, "utf8");

  return { baselineScore: baseline.overallScore, afterScore: after.overallScore, delta, reportPath, observabilityPath, diagramPath };
}

export async function promptEvalArtifact(
  cwd: string,
  promptContent: string
): Promise<{ reportPath: string; score: number; objectives: PromptObjectiveVector; feedback: string[] }> {
  await ensureProjectScaffold(cwd);
  const slug = `eval-${Date.now().toString(36)}`;
  const tmpPath = join(promptEvolutionDir(cwd), `${slug}.md`);
  await writeFile(tmpPath, promptContent, "utf8");

  const result = await evaluatePromptContent(cwd, tmpPath, promptContent);

  const lines = [
    `# Prompt Evaluation`,
    ``,
    `**Score:** ${result.score.toFixed(2)}/100`,
    ``,
    `## Objectives`,
    ...Object.entries(result.objectives).map(([k, v]) => `- ${k}: ${v.toFixed(2)}`),
    ``,
    `## Feedback`,
    ...(result.feedback.length > 0 ? result.feedback.map((f) => `- ${f}`) : ["- No major issues detected."]),
  ];
  const reportPath = join(promptEvolutionDir(cwd), `${slug}-eval.md`);
  await writeFile(reportPath, lines.join("\n"), "utf8");

  return { reportPath, score: result.score, objectives: result.objectives, feedback: result.feedback };
}

async function loadEngagementContext(cwd: string) {
  await ensureProjectScaffold(cwd);
  const state = await loadLearnerState(learnerStatePath(cwd));
  const policy = await loadEngagementPolicy(engagementPolicyPath(cwd));
  return { state: learnerStateWithFeedbackCoverage(state), policy };
}

function learnerStateWithFeedbackCoverage(state: Awaited<ReturnType<typeof loadLearnerState>>) {
  const covered = new Set((state.coveredTopics ?? []).map((topic) => topic.slug));
  const feedbackByTopic = new Map<string, typeof state.feedback>();
  for (const feedback of state.feedback ?? []) {
    const topic = feedback.topic.trim();
    if (!topic || topic === "general") continue;
    const existing = feedbackByTopic.get(topic) ?? [];
    existing.push(feedback);
    feedbackByTopic.set(topic, existing);
  }

  const inferredTopics = [...feedbackByTopic.entries()]
    .filter(([topic]) => !covered.has(resolveTopic(topic).slug))
    .map(([topic, feedback]) => {
      const resolved = resolveTopic(topic);
      const latest = feedback
        .map((entry) => entry.timestamp)
        .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? new Date().toISOString();
      const signalScore = feedback.reduce((sum, entry) => {
        if (entry.signal === "thumbs-up") return sum + 0.75;
        if (entry.signal === "confused") return sum + 0.35;
        return sum + 0.2;
      }, 0) / Math.max(1, feedback.length);

      return {
        slug: resolved.slug,
        domain: resolved.domain,
        lastSeen: latest,
        masteryEstimate: signalScore,
        sessionCount: feedback.length
      };
    });

  if (inferredTopics.length === 0) return state;
  return {
    ...state,
    coveredTopics: [...state.coveredTopics, ...inferredTopics]
  };
}

export async function timelineArtifact(
  cwd: string
): Promise<{ reportPath: string; markdown: string }> {
  const { state, policy } = await loadEngagementContext(cwd);
  const timeline = buildEngagementTimeline(state, policy);
  const markdown = engagementTimelineToMarkdown(timeline);
  const reportPath = join(timelineDir(cwd), "latest.md");
  await writeFile(reportPath, markdown, "utf8");
  return { reportPath, markdown };
}

export async function dueTopicsArtifact(
  cwd: string
): Promise<{ reportPath: string; markdown: string; count: number }> {
  const { state, policy } = await loadEngagementContext(cwd);
  const due = dueTopics(state, policy);
  const markdown = dueTopicsToMarkdown(due);
  const reportPath = join(timelineDir(cwd), "due.md");
  await writeFile(reportPath, markdown, "utf8");
  return { reportPath, markdown, count: due.length };
}

export async function exportKeatingData(
  cwd: string,
  options: KeatingExportOptions
): Promise<{ manifestPath: string; outDir: string; manifest: KeatingExportManifest }> {
  await ensureProjectScaffold(cwd);
  return exportFineTuneDataset(cwd, options);
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

export async function quizTopicArtifact(cwd: string, topicName: string) {
  await ensureProjectScaffold(cwd);
  const quiz = generateQuiz(topicName);
  const slug = quiz.slug;
  const base = join(quizDir(cwd), slug);
  await writeFile(`${base}.md`, quizToMarkdown(quiz), "utf8");
  await writeFile(`${base}-answers.md`, quizAnswerKeyToMarkdown(quiz), "utf8");
  return { quizPath: `${base}.md`, answersPath: `${base}-answers.md` };
}

export async function workbookTopicArtifact(cwd: string, topicName: string) {
  await ensureProjectScaffold(cwd);
  const wb = generateWorkbook(topicName);
  const wbPath = join(workbooksDir(cwd), `${wb.slug}.md`);
  await writeFile(wbPath, workbookToMarkdown(wb), "utf8");
  return { workbookPath: wbPath };
}

export async function flashcardsTopicArtifact(cwd: string, topicName: string) {
  await ensureProjectScaffold(cwd);
  const deck = generateFlashCards(topicName);
  const deckPath = join(flashcardsDir(cwd), `${deck.slug}.md`);
  await writeFile(deckPath, flashcardsToMarkdown(deck), "utf8");
  return { flashcardsPath: deckPath };
}

export async function projectTopicArtifact(cwd: string, topicName: string) {
  await ensureProjectScaffold(cwd);
  const project = generateProject(topicName);
  const projectPath = join(projectsDir(cwd), `${project.slug}.md`);
  await writeFile(projectPath, projectToMarkdown(project), "utf8");
  return { projectPath };
}

export async function assignmentTopicArtifact(cwd: string, topicName: string) {
  await ensureProjectScaffold(cwd);
  const assignment = generateAssignment(topicName);
  const assignmentPath = join(projectsDir(cwd), `${assignment.slug}-assignment.md`);
  await writeFile(assignmentPath, assignmentToMarkdown(assignment), "utf8");
  return { assignmentPath };
}

export async function masteryTopicArtifact(cwd: string, topicName: string) {
  await ensureProjectScaffold(cwd);
  const topic = resolveTopic(topicName);
  const questions = generateDiagnosticQuestions(topic);
  const slug = topic.slug;
  const diagPath = join(masteryDir(cwd), `${slug}-diagnostic.md`);

  const lines = [
    `# Diagnostic Questions: ${topic.title}`,
    "",
    `> Answer each question in your own words. Self-score using the rubric, or run \`keating assess ${topicName}\` after answering.`,
    "",
  ];
  for (const q of questions) {
    lines.push(`## ${q.id} [${q.level}]`);
    lines.push(q.question);
    lines.push("");
    lines.push(`**Rubric:** ${q.rubric}`);
    lines.push("");
    lines.push(`**Your answer:**`);
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  await writeFile(diagPath, lines.join("\n"), "utf8");
  return { diagPath };
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
    verificationsDir(cwd),
    improvementsDir(cwd),
    timelineDir(cwd),
    quizDir(cwd),
    flashcardsDir(cwd),
    projectsDir(cwd),
    workbooksDir(cwd),
    masteryDir(cwd),
    exportsDir(cwd)
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

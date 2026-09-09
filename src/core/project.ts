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
import { ensureNamedLearnerState, loadLearnerState } from "./learner-state.js";
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
import { importFineTuneDataset, type KeatingImportOptions, type KeatingImportResult } from "./import.js";
import { classifyObservationError, exportEvaluationObservation } from "../observability/arize.js";
import { EVALUATION_OBSERVATION_VERSION, type EvaluationEngine, type EvaluationObservationV1, type EvaluationOperation } from "../observability/types.js";
import { KEATING_VERSION } from "./version.js";

const OBSERVABILITY_APP_VERSION = process.env.npm_package_version ?? KEATING_VERSION;

async function observeEvaluation(
  operation: EvaluationOperation,
  engine: EvaluationEngine,
  suite: string,
  startedAt: number,
  surface: EvaluationObservationV1["surface"],
  fields: Record<string, number | string | undefined> = {},
): Promise<void> {
  await exportEvaluationObservation({
    schemaVersion: EVALUATION_OBSERVATION_VERSION,
    operation,
    engine,
    status: fields.status === "rolled_back" ? "rolled_back" : fields.status === "rejected" ? "rejected" : fields.status === "error" ? "error" : "success",
    suite,
    duration_ms: Math.max(0, Date.now() - startedAt),
    ...(typeof fields.score === "number" ? { score: fields.score } : {}),
    ...(typeof fields.before_score === "number" ? { before_score: fields.before_score } : {}),
    ...(typeof fields.after_score === "number" ? { after_score: fields.after_score } : {}),
    ...(typeof fields.outcome_count === "number" ? { outcome_count: fields.outcome_count } : {}),
    ...(typeof fields.candidate_count === "number" ? { candidate_count: fields.candidate_count } : {}),
    ...(typeof fields.error_category === "string" ? { error_category: fields.error_category } : {}),
    app_version: OBSERVABILITY_APP_VERSION,
    surface,
  });
}

export async function ensureProjectScaffold(cwd: string): Promise<void> {
  await ensureKeatingDirs(cwd);
  await ensureNamedLearnerState(learnerStatePath(cwd));
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
): Promise<{ mmdPath: string }> {
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
  focusTopic?: string,
  surface: EvaluationObservationV1["surface"] = "cli",
): Promise<{ reportPath: string; tracePath: string | null; overallScore: number }> {
  const startedAt = Date.now();
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
  await observeEvaluation("benchmark", "deterministic", focusTopic ? "focused" : "core", startedAt, surface, {
    score: result.overallScore,
    outcome_count: result.trace.realOutcomeCount,
  });
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
  focusTopic?: string,
  surface: EvaluationObservationV1["surface"] = "cli",
): Promise<{ reportPath: string; tracePath: string | null; bestScore: number; policyPath: string }> {
  const startedAt = Date.now();
  await ensureProjectScaffold(cwd);
  const policyPath = currentPolicyPath(cwd);
  const basePolicy = await loadPolicy(policyPath);
  const learnerState = await loadLearnerState(learnerStatePath(cwd));
  const gathered = await extractHarnessOutcomes(cwd, learnerState);
  const realOutcomes = focusTopic ? gathered.filter((outcome) => outcome.topic === resolveTopic(focusTopic).slug) : gathered;
  if (!hasEnoughRealData(realOutcomes)) {
    await observeEvaluation("policy_evolution", "learner-feedback", focusTopic ? "focused" : "core", startedAt, surface, {
      status: "rejected",
      outcome_count: realOutcomes.length,
      error_category: "insufficient_feedback",
    });
    throw new Error(`Not ready to evolve: need at least ${MIN_REAL_OUTCOMES} learner signals to ground a proposal; found ${realOutcomes.length}. This corpus-size threshold does not validate improvements.`);
  }
  const baseline = await runBenchmarkSuite(cwd, basePolicy, focusTopic, 20260401, 3, undefined, learnerState);
  const { mutatePolicy } = await import("./mutation.js");
  const { Prng } = await import("./random.js");
  const prng = new Prng(20260401);
  const proposals = Array.from({ length: 12 }, (_, index) => ({
    policy: mutatePolicy(basePolicy, prng, index + 1),
    iteration: index + 1,
    decision: { accepted: false, reasons: ["Unvalidated proposal: no fresh teaching execution or independent comparison."] },
  }));
  const proposal = { schemaVersion: 1, status: "unvalidated-proposal", activePolicy: basePolicy, baselineEvidence: baseline, proposals };
  const slug = focusTopic ? slugify(focusTopic) : "latest";
  const proposalPath = join(evolutionDir(cwd), `${slug}.proposals.json`);
  await writeFile(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`, { mode: 0o600 });
  const report = [
    "# Unvalidated policy proposals", "",
    "These parameter mutations are proposals only. The active policy is unchanged.",
    "Historical feedback does not rank these candidates or demonstrate that any mutation teaches better.",
    "Use auto-improve for fresh teaching executions and an independent activation gate.", "",
    `- Proposals: ${proposals.length}`,
    `- Proposal artifact: ${relative(cwd, proposalPath)}`,
    `- Active policy: ${basePolicy.name}`,
    "", benchmarkToMarkdown(baseline),
  ].join("\n");
  const { reportPath, tracePath } = await writeArtifactWithTrace(
    cwd, evolutionDir(cwd), slug, report, "evolution", proposal
  );
  await observeEvaluation("policy_evolution", "learner-feedback", focusTopic ? "focused" : "core", startedAt, surface, {
    status: "rejected",
    outcome_count: realOutcomes.length,
    candidate_count: proposals.length,
    error_category: "unvalidated_proposals",
  });
  return { reportPath, tracePath, bestScore: baseline.overallScore, policyPath };
}

export async function evolvePromptArtifact(
  cwd: string,
  promptName = "learn",
  surface: EvaluationObservationV1["surface"] = "cli",
): Promise<{ reportPath: string; evolvedPromptPath: string; bestScore: number; promptPath: string; accepted: boolean }> {
  const startedAt = Date.now();
  await ensureProjectScaffold(cwd);
  try {
    const result = await writePromptEvolutionArtifacts(cwd, promptName);
    await observeEvaluation("prompt_evolution", "heuristic", "prompt-template", startedAt, surface, {
      score: result.bestScore,
      candidate_count: 1,
    });
    return result;
  } catch (error) {
    await observeEvaluation("prompt_evolution", "heuristic", "prompt-template", startedAt, surface, {
      status: "error",
      error_category: classifyObservationError(error),
    });
    throw error;
  }
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

/** Auto-improve now executes teaching episodes; retrospective feedback cannot activate revisions. */
export async function autoImproveArtifact(
  cwd: string,
  _focusTopic?: string,
  options: import("./teaching-evolution.js").TeachingEvolutionOptions & { surface?: EvaluationObservationV1["surface"] } = {}
) {
  await ensureProjectScaffold(cwd);
  const { teachingEvolutionArtifact } = await import("./teaching-evolution.js");
  return teachingEvolutionArtifact(cwd, options);
}

export async function promptEvalArtifact(
  cwd: string,
  promptContent: string,
  surface: EvaluationObservationV1["surface"] = "cli",
): Promise<{ reportPath: string; score: number; objectives: PromptObjectiveVector; feedback: string[] }> {
  const startedAt = Date.now();
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

  await observeEvaluation("prompt_eval", "heuristic", "prompt-template", startedAt, surface, {
    score: result.score,
    outcome_count: result.feedback.length,
  });

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

export async function importKeatingData(
  cwd: string,
  options: KeatingImportOptions
): Promise<KeatingImportResult> {
  await ensureProjectScaffold(cwd);
  return importFineTuneDataset(cwd, options);
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

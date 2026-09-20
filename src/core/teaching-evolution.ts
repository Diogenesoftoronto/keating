import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TEACHING_CASES } from "../../shared/evolution/cases.js";
import { composeTeachingPrompt, createTeachingRevision, runEpisodeBenchmark, verifyTeachingRevision } from "../../shared/evolution/benchmark.js";
import { createEpisodeJudge, createSkillProposer, createWikiMaintainer } from "../../shared/evolution/model-adapters.js";
import type { WikiMaintainer } from "../../shared/evolution/wiki.js";
import { loadActiveTeachingRevision, loadEvaluatedTeachingRevision, readEvolutionState, revisionKey, runTeachingEvolution, teachingExperimentMarkdown } from "../../shared/evolution/loop.js";
import type { EpisodeJudge, EpisodeRunner, SkillProposer, TeachingCase, TeachingRevision } from "../../shared/evolution/contracts.js";
import { createPiCompletionRunner, createPiEpisodeRunner } from "./teaching-episode-runner.js";
import { FileEvolutionStore } from "./teaching-evolution-store.js";
import { createCliEvolutionSpendReviewer, createCliEvolutionJudgement, type CliEvolutionJudgementOptions, type CliEvolutionJudgementReceipt } from "../judgement/cli-evolution.js";
import { exportEvaluationObservation } from "../observability/arize.js";
import { readArizeConfig } from "../observability/config.js";
import { EVALUATION_OBSERVATION_VERSION, type EvaluationObservationV1 } from "../observability/types.js";
import { KEATING_VERSION } from "./version.js";
import { benchmarksDir } from "./paths.js";

export async function teachingBasePrompt(): Promise<string> {
  let current = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth += 1) {
    try { return await readFile(join(current, "SYSTEM.md"), "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    current = dirname(current);
  }
  throw new Error("teaching_system_prompt_missing");
}

export async function activeTeachingPrompt(cwd: string, pinned?: { revisionId: string; experimentId?: string }): Promise<{ prompt: string; revisionId: string; basePrompt: string; experimentId?: string }> {
  const basePrompt = await teachingBasePrompt();
  const store = new FileEvolutionStore(cwd);
  const state = await readEvolutionState(store);
  let reference = pinned ?? state.active;
  let active = reference?.experimentId
    ? await loadEvaluatedTeachingRevision(store, { revisionId: reference.revisionId, experimentId: reference.experimentId })
    : reference ? await store.read<TeachingRevision>(revisionKey(reference.revisionId)) : null;
  if (reference && !active) throw new Error("pinned_teaching_revision_missing");
  if (active) await verifyTeachingRevision(active);
  if (active && !reference?.experimentId && (active.skills.length || active.parentId !== null)) throw new Error("pinned_teaching_evidence_missing");
  if (!pinned && active && active.basePrompt !== basePrompt) { active = null; reference = null; }
  const revision = active ?? await createTeachingRevision(basePrompt);
  await store.put(revisionKey(revision.id), revision);
  return { prompt: composeTeachingPrompt(revision), revisionId: revision.id, basePrompt: revision.basePrompt,
    ...(reference?.experimentId ? { experimentId: reference.experimentId } : {}) };
}

export interface TeachingEvolutionOptions {
  force?: boolean;
  cases?: readonly TeachingCase[];
  runner?: EpisodeRunner;
  judge?: EpisodeJudge;
  /** Independent account-backed judge preference; never the tutor model selection. */
  judgement?: CliEvolutionJudgementOptions;
  spendReviewer?: import("../../shared/evolution/spend-review.js").EvolutionSpendReviewer;
  proposer?: SkillProposer;
  maintainer?: WikiMaintainer;
  signal?: AbortSignal;
  onProgress?: (stage: string) => void;
  surface?: EvaluationObservationV1["surface"];
}

/** Export only aggregate synthetic evaluation metadata, after durable artifacts exist. */
async function observeTypedTeachingEvaluation(
  receipt: CliEvolutionJudgementReceipt | undefined,
  startedAt: number,
  surface: EvaluationObservationV1["surface"],
  fields: Pick<EvaluationObservationV1, "operation" | "status" | "suite" | "outcome_count" | "candidate_count" | "score" | "before_score" | "after_score">,
): Promise<void> {
  try {
    if (!receipt || !readArizeConfig().enabled) return;
    await exportEvaluationObservation({
      schemaVersion: EVALUATION_OBSERVATION_VERSION,
      ...fields,
      engine: "typed-judgement",
      duration_ms: Math.max(0, Date.now() - startedAt),
      backend: receipt.backend.backend,
      model: receipt.backend.model,
      ...(receipt.backend.calibrationSha256 ? { calibration_sha256: receipt.backend.calibrationSha256 } : {}),
      app_version: KEATING_VERSION,
      surface,
    });
  } catch {
    // Observability cannot change the saved result or disclose exporter errors.
  }
}

export async function teachingEvolutionArtifact(cwd: string, options: TeachingEvolutionOptions = {}) {
  const startedAt = Date.now();
  const cases = options.cases ?? TEACHING_CASES;
  const runner = options.runner ?? await createPiEpisodeRunner(cwd);
  const typed = options.judge ? null : await createCliEvolutionJudgement({ cwd, runner, cases, options: options.judgement });
  const complete = (options.judge || typed) && options.proposer ? null : await createPiCompletionRunner(cwd);
  if (typed) options.onProgress?.(`judge:${typed.receipt.backend.model}:${typed.receipt.calibration}`);
  const report = await runTeachingEvolution({
    store: new FileEvolutionStore(cwd), cases,
    basePrompt: await teachingBasePrompt(), runner: typed?.runner ?? runner,
    judge: options.judge ?? typed?.judge ?? createEpisodeJudge(complete!), proposer: options.proposer ?? createSkillProposer(complete!),
    maintainer: options.maintainer ?? (complete ? createWikiMaintainer(complete) : undefined),
    frontierReviewer: typed ? { call: typed.frontierCall } : undefined,
    spendReviewer: options.spendReviewer ?? await createCliEvolutionSpendReviewer(cwd, options.judgement),
    force: options.force, signal: options.signal, onProgress: options.onProgress,
  });
  const dir = join(benchmarksDir(cwd), "teaching-experiments");
  await mkdir(dir, { recursive: true });
  const reportPath = join(dir, `${report.id}.md`);
  const observabilityPath = join(dir, `${report.id}.json`);
  const diagramPath = join(dir, `${report.id}.mmd`);
  await writeFile(reportPath, teachingExperimentMarkdown(report) + (typed
    ? `\nJudge: ${typed.receipt.backend.model}; ${typed.receipt.calibration} proxy estimates. Human learning remains unmeasured.\n` : ""), { mode: 0o600 });
  await writeFile(observabilityPath, `${JSON.stringify({ ...report, ...(typed ? { judgement: typed.receipt } : {}) }, null, 2)}\n`, { mode: 0o600 });
  await writeFile(diagramPath, "flowchart TD\n  A[Fresh training episodes] --> B[Durable candidate frontier]\n  B --> C[Rank or explore one candidate]\n  C --> T[Candidate training and saved outcome]\n  T --> V[Paired validation]\n  V --> H[Sealed holdout]\n  H --> E[Independent activation gate]\n  T --> B\n", { mode: 0o600 });
  const comparison = report.holdout ?? report.validation;
  const baselineScore = comparison?.baseline.meanScore == null ? null : comparison.baseline.meanScore * 100;
  const afterScore = comparison?.candidate.meanScore == null ? null : comparison.candidate.meanScore * 100;
  const benchmarks = [report.training, report.candidateTraining, report.validation?.baseline, report.validation?.candidate, report.holdout?.baseline, report.holdout?.candidate];
  await observeTypedTeachingEvaluation(typed?.receipt, startedAt, options.surface ?? "cli", {
    operation: "auto_improve", suite: "synthetic-teaching-evolution",
    status: report.status === "accepted" ? "success" : report.status === "failed" ? "error" : "rejected",
    outcome_count: benchmarks.reduce((count, benchmark) => count + (benchmark?.results.length ?? 0), 0),
    candidate_count: report.candidateRevisionId ? 1 : 0,
    ...(baselineScore === null ? {} : { before_score: baselineScore }),
    ...(afterScore === null ? {} : { after_score: afterScore }),
  });
  return {
    baselineScore, afterScore, delta: baselineScore === null || afterScore === null ? null : afterScore - baselineScore,
    status: report.status, reportPath, observabilityPath, diagramPath, experiment: report,
    ...(typed ? { judgement: typed.receipt } : {}),
  };
}

export async function teachingBenchmarkArtifact(cwd: string, options: Pick<TeachingEvolutionOptions, "runner" | "judge" | "judgement" | "cases" | "signal" | "surface"> = {}) {
  const startedAt = Date.now();
  const store = new FileEvolutionStore(cwd);
  const active = await activeTeachingPrompt(cwd);
  const revision = await store.read<TeachingRevision>(revisionKey(active.revisionId));
  if (!revision) throw new Error("teaching_benchmark_revision_missing");
  const cases = options.cases ?? TEACHING_CASES;
  const runner = options.runner ?? await createPiEpisodeRunner(cwd);
  const typed = options.judge ? null : await createCliEvolutionJudgement({ cwd, runner, cases, options: options.judgement });
  const judge = options.judge ?? typed?.judge ?? createEpisodeJudge(await createPiCompletionRunner(cwd));
  const report = await runEpisodeBenchmark({
    cases, split: "train", revision,
    runner: typed?.runner ?? runner, judge, signal: options.signal,
  });
  const dir = join(benchmarksDir(cwd), "teaching-episodes");
  await mkdir(dir, { recursive: true });
  const reportPath = join(dir, `${globalThis.crypto.randomUUID()}.json`);
  await writeFile(reportPath, `${JSON.stringify({ ...report, ...(typed ? { judgement: typed.receipt } : {}) }, null, 2)}\n`, { mode: 0o600 });
  await observeTypedTeachingEvaluation(typed?.receipt, startedAt, options.surface ?? "cli", {
    operation: "benchmark", suite: "synthetic-teaching-episodes",
    status: report.errorCount > 0 || report.meanScore === null ? "error" : "success",
    outcome_count: report.results.length,
    ...(report.meanScore === null ? {} : { score: report.meanScore * 100 }),
  });
  return { report, reportPath, ...(typed ? { judgement: typed.receipt } : {}) };
}

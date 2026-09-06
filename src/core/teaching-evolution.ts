import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TEACHING_CASES } from "../../shared/evolution/cases.js";
import { composeTeachingPrompt, createTeachingRevision, runEpisodeBenchmark, verifyTeachingRevision } from "../../shared/evolution/benchmark.js";
import { createEpisodeJudge, createSkillProposer } from "../../shared/evolution/model-adapters.js";
import { loadActiveTeachingRevision, loadEvaluatedTeachingRevision, readEvolutionState, revisionKey, runTeachingEvolution, teachingExperimentMarkdown } from "../../shared/evolution/loop.js";
import type { EpisodeJudge, EpisodeRunner, SkillProposer, TeachingCase, TeachingRevision } from "../../shared/evolution/contracts.js";
import { createPiCompletionRunner, createPiEpisodeRunner } from "./teaching-episode-runner.js";
import { FileEvolutionStore } from "./teaching-evolution-store.js";
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
  proposer?: SkillProposer;
  signal?: AbortSignal;
  onProgress?: (stage: string) => void;
}

export async function teachingEvolutionArtifact(cwd: string, options: TeachingEvolutionOptions = {}) {
  const complete = options.judge && options.proposer ? null : await createPiCompletionRunner(cwd);
  const report = await runTeachingEvolution({
    store: new FileEvolutionStore(cwd), cases: options.cases ?? TEACHING_CASES,
    basePrompt: await teachingBasePrompt(), runner: options.runner ?? await createPiEpisodeRunner(cwd),
    judge: options.judge ?? createEpisodeJudge(complete!), proposer: options.proposer ?? createSkillProposer(complete!),
    force: options.force, signal: options.signal, onProgress: options.onProgress,
  });
  const dir = join(benchmarksDir(cwd), "teaching-experiments");
  await mkdir(dir, { recursive: true });
  const reportPath = join(dir, `${report.id}.md`);
  const observabilityPath = join(dir, `${report.id}.json`);
  const diagramPath = join(dir, `${report.id}.mmd`);
  await writeFile(reportPath, teachingExperimentMarkdown(report), { mode: 0o600 });
  await writeFile(observabilityPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await writeFile(diagramPath, "flowchart TD\n  A[Fresh training episodes] --> B[Skill proposal]\n  B --> C[Paired validation]\n  C --> D[Sealed holdout]\n  D --> E[Independent activation gate]\n", { mode: 0o600 });
  const comparison = report.holdout ?? report.validation;
  const baselineScore = comparison?.baseline.meanScore == null ? null : comparison.baseline.meanScore * 100;
  const afterScore = comparison?.candidate.meanScore == null ? null : comparison.candidate.meanScore * 100;
  return {
    baselineScore, afterScore, delta: baselineScore === null || afterScore === null ? null : afterScore - baselineScore,
    status: report.status, reportPath, observabilityPath, diagramPath, experiment: report,
  };
}

export async function teachingBenchmarkArtifact(cwd: string, options: Pick<TeachingEvolutionOptions, "runner" | "judge" | "cases" | "signal"> = {}) {
  const store = new FileEvolutionStore(cwd);
  const active = await activeTeachingPrompt(cwd);
  const revision = await store.read<TeachingRevision>(revisionKey(active.revisionId));
  if (!revision) throw new Error("teaching_benchmark_revision_missing");
  const judge = options.judge ?? createEpisodeJudge(await createPiCompletionRunner(cwd));
  const report = await runEpisodeBenchmark({
    cases: options.cases ?? TEACHING_CASES, split: "train", revision,
    runner: options.runner ?? await createPiEpisodeRunner(cwd), judge, signal: options.signal,
  });
  const dir = join(benchmarksDir(cwd), "teaching-episodes");
  await mkdir(dir, { recursive: true });
  const reportPath = join(dir, `${globalThis.crypto.randomUUID()}.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return { report, reportPath };
}

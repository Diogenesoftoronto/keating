import {
  compareEpisodeBenchmarks, contentDigest, createTeachingRevision,
  runEpisodeBenchmark, validateEpisodeBenchmark, validateSkills, validateTeachingCases, verifyTeachingRevision, withDeadline,
} from "./benchmark.js";
import type {
  EpisodeBenchmark, EpisodeJudge, EpisodeRunner, PromotionDecision, SkillProposer,
  TeachingCase, TeachingHypothesis, TeachingRevision,
} from "./contracts.js";

export interface EvolutionState {
  schemaVersion: 1;
  active: { revisionId: string; experimentId: string; generation: number; activatedAt: string } | null;
  lastRunAt: string | null;
  consumedHoldouts: string[];
  consumedHoldoutFamilies: string[];
  hypotheses: TeachingHypothesis[];
}
export interface EvolutionStore {
  read<T>(key: string): Promise<T | null>;
  /** Existing immutable objects must never be overwritten with different contents. */
  put(key: string, value: unknown): Promise<void>;
  writeState(state: EvolutionState): Promise<void>;
  /** Exclusive across processes/tabs, including the activation compare-and-swap. */
  exclusive<T>(operation: () => Promise<T>): Promise<T>;
}
export interface TeachingExperiment {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  suiteDigest: string;
  holdoutDigest: string;
  baselineRevisionId: string;
  candidateRevisionId: string | null;
  evidenceKind: "synthetic";
  scope: "experimental-teaching-behavior";
  humanLearning: "unmeasured";
  status: "accepted" | "rejected" | "failed";
  training: EpisodeBenchmark | null;
  validation: { baseline: EpisodeBenchmark; candidate: EpisodeBenchmark; decision: PromotionDecision } | null;
  holdout: { baseline: EpisodeBenchmark; candidate: EpisodeBenchmark; decision: PromotionDecision } | null;
  reasons: string[];
}

interface TeachingSuiteManifest {
  schemaVersion: 1;
  id: string;
  cases: readonly TeachingCase[];
}

async function releaseHoldoutDigest(cases: readonly TeachingCase[]): Promise<string> {
  return contentDigest((await Promise.all(cases.filter((item) => item.split === "holdout")
    .map((item) => contentDigest({ messages: item.messages, rubric: item.rubric })))).sort());
}

function suiteKey(id: string): string {
  if (!/^sha256:[a-f0-9]{64}$/.test(id)) throw new Error("invalid_suite_digest");
  return `suites/${id.slice(7)}`;
}

export function emptyEvolutionState(): EvolutionState {
  return { schemaVersion: 1, active: null, lastRunAt: null, consumedHoldouts: [], consumedHoldoutFamilies: [], hypotheses: [] };
}

export async function readEvolutionState(store: EvolutionStore): Promise<EvolutionState> {
  const state = await store.read<EvolutionState>("state");
  if (!state) return emptyEvolutionState();
  if (state.schemaVersion !== 1 || !Array.isArray(state.hypotheses) || !Array.isArray(state.consumedHoldouts)
    || !Array.isArray(state.consumedHoldoutFamilies)
    || state.consumedHoldouts.some((id) => typeof id !== "string" || !/^sha256:[a-f0-9]{64}$/.test(id))
    || state.consumedHoldoutFamilies.some((family) => typeof family !== "string" || !family.trim())
    || state.hypotheses.some((hypothesis) => !hypothesis || typeof hypothesis.id !== "string"
      || typeof hypothesis.statement !== "string" || !hypothesis.statement.trim() || hypothesis.statement.length > 1200
      || !["proposed", "supported-offline", "rejected"].includes(hypothesis.status)
      || !Array.isArray(hypothesis.evidenceIds) || !hypothesis.evidenceIds.length
      || hypothesis.evidenceIds.some((id) => typeof id !== "string" || !id || id.length > 180))
    || (state.lastRunAt !== null && !Number.isFinite(Date.parse(state.lastRunAt)))
    || (state.active !== null && (!state.active || !/^sha256:[a-f0-9]{64}$/.test(state.active.revisionId)
      || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(state.active.experimentId)
      || !Number.isFinite(Date.parse(state.active.activatedAt))
      || !Number.isInteger(state.active.generation) || state.active.generation < 1))) throw new Error("invalid_evolution_state");
  return state;
}

export function revisionKey(id: string): string {
  if (!/^sha256:[a-f0-9]{64}$/.test(id)) throw new Error("invalid_revision_id");
  return `revisions/${id.slice(7)}`;
}

export async function loadActiveTeachingRevision(store: EvolutionStore): Promise<TeachingRevision | null> {
  const state = await readEvolutionState(store);
  if (!state.active) return null;
  return loadEvaluatedTeachingRevision(store, state.active);
}

/** Historical accepted revisions remain usable by the sessions pinned to them. */
export async function loadEvaluatedTeachingRevision(
  store: EvolutionStore, reference: { revisionId: string; experimentId: string },
): Promise<TeachingRevision> {
  const state = await readEvolutionState(store);
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(reference.experimentId)) throw new Error("invalid_experiment_id");
  const revision = await store.read<TeachingRevision>(revisionKey(reference.revisionId));
  if (!revision) throw new Error("active_revision_missing");
  await verifyTeachingRevision(revision);
  if (revision.id !== reference.revisionId) throw new Error("active_revision_mismatch");
  const experiment = await store.read<TeachingExperiment>(`experiments/${reference.experimentId}`);
  if (!experiment || experiment.schemaVersion !== 1 || experiment.id !== reference.experimentId
    || experiment.evidenceKind !== "synthetic" || experiment.scope !== "experimental-teaching-behavior"
    || experiment.status !== "accepted" || experiment.candidateRevisionId !== revision.id
    || experiment.baselineRevisionId !== revision.parentId || experiment.humanLearning !== "unmeasured"
    || !experiment.training || !experiment.validation || !experiment.holdout
    || !compareEpisodeBenchmarks(experiment.validation.baseline, experiment.validation.candidate).accepted
    || !compareEpisodeBenchmarks(experiment.holdout.baseline, experiment.holdout.candidate).accepted) throw new Error("active_revision_evidence_invalid");
  const suite = await store.read<TeachingSuiteManifest>(suiteKey(experiment.suiteDigest));
  if (!suite || suite.schemaVersion !== 1 || suite.id !== experiment.suiteDigest
    || await contentDigest(suite.cases) !== experiment.suiteDigest) throw new Error("active_revision_suite_invalid");
  validateTeachingCases(suite.cases);
  if (await releaseHoldoutDigest(suite.cases) !== experiment.holdoutDigest
    || !state.consumedHoldouts.includes(experiment.holdoutDigest)
    || suite.cases.some((item) => item.split === "holdout" && !state.consumedHoldoutFamilies.includes(item.family))) throw new Error("active_revision_holdout_invalid");
  const runIds = new Set<string>();
  for (const split of ["train", "validation", "holdout"] as const) {
    const variants = split === "train" ? ["baseline"] as const : ["baseline", "candidate"] as const;
    for (const variant of variants) {
      const benchmark = split === "train" ? experiment.training : experiment[split]![variant];
      try { validateEpisodeBenchmark(benchmark); } catch { throw new Error("active_revision_evidence_invalid"); }
      const expectedRevision = variant === "baseline" ? revision.parentId : revision.id;
      const raw = await store.read<EpisodeBenchmark>(`raw/${experiment.id}-${split}-${variant === "baseline" ? "incumbent" : "candidate"}`);
      if (benchmark.split !== split || benchmark.suiteDigest !== experiment.suiteDigest || benchmark.revisionId !== expectedRevision
        || benchmark.errorCount || runIds.has(benchmark.runId)
        || JSON.stringify(benchmark.caseManifest) !== JSON.stringify(suite.cases.filter((item) => item.split === split))
        || !raw || await contentDigest(raw) !== await contentDigest(benchmark)) throw new Error("active_revision_evidence_mismatch");
      runIds.add(benchmark.runId);
    }
  }
  return revision;
}

export async function runTeachingEvolution(input: {
  store: EvolutionStore;
  cases: readonly TeachingCase[];
  basePrompt: string;
  runner: EpisodeRunner;
  judge: EpisodeJudge;
  proposer: SkillProposer;
  repeats?: number;
  timeoutMs?: number;
  force?: boolean;
  signal?: AbortSignal;
  onProgress?: (stage: string) => void;
}): Promise<TeachingExperiment> {
  input = { ...input, cases: structuredClone(input.cases) };
  validateTeachingCases(input.cases);
  // One candidate per invocation; force overrides cooldown only, never evidence gates.
  if (["train", "validation", "holdout"].some((split) => !input.cases.some((item) => item.split === split))) throw new Error("missing_experiment_split");
  const repeats = input.repeats ?? 1;
  const plannedEpisodes = input.cases.reduce((total, item) => total + (item.split === "train" ? 1 : 2), 0) * repeats;
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 2 || plannedEpisodes > 60) throw new Error("experiment_budget_exceeded");
  const suiteDigest = await contentDigest(input.cases);
  const holdoutCases = input.cases.filter((item) => item.split === "holdout");
  const holdoutDigest = await releaseHoldoutDigest(input.cases);
  return input.store.exclusive(async () => {
    const state = await readEvolutionState(input.store);
    if (!input.force && state.lastRunAt && Date.now() - Date.parse(state.lastRunAt) < 30 * 60 * 1000) throw new Error("evolution_cooldown_active");
    // A release holdout is consumed before access, including crashes and rejected attempts.
    // A new independent case pack is required after that; force cannot reopen a seen test.
    if (state.consumedHoldouts.includes(holdoutDigest)
      || holdoutCases.some((item) => state.consumedHoldoutFamilies.includes(item.family))) throw new Error("holdout_consumed_new_suite_required");
    const active = await loadActiveTeachingRevision(input.store);
    // A changed host/persona starts from its own baseline. The prior active
    // revision remains archived until a candidate for the new base passes.
    const incumbent = active?.basePrompt === input.basePrompt ? active : await createTeachingRevision(input.basePrompt);
    await input.store.put(suiteKey(suiteDigest), { schemaVersion: 1, id: suiteDigest, cases: input.cases } satisfies TeachingSuiteManifest);
    await input.store.put(revisionKey(incumbent.id), incumbent);
    const report: TeachingExperiment = {
      schemaVersion: 1, id: globalThis.crypto.randomUUID(), createdAt: new Date().toISOString(), suiteDigest, holdoutDigest,
      baselineRevisionId: incumbent.id, candidateRevisionId: null, evidenceKind: "synthetic",
      scope: "experimental-teaching-behavior", humanLearning: "unmeasured", status: "failed",
      training: null, validation: null, holdout: null, reasons: [],
    };
    state.lastRunAt = report.createdAt;
    await input.store.writeState(state);
    const benchmark = async (revision: TeachingRevision, split: "train" | "validation" | "holdout") => {
      input.onProgress?.(`${split}:${revision.id === incumbent.id ? "incumbent" : "candidate"}`);
      const result = await runEpisodeBenchmark({
        cases: input.cases, split, revision, runner: input.runner, judge: input.judge,
        repeats, timeoutMs: input.timeoutMs, signal: input.signal,
      });
      await input.store.put(`raw/${report.id}-${split}-${revision.id === incumbent.id ? "incumbent" : "candidate"}`, result);
      return result;
    };
    let hypothesis: TeachingHypothesis | undefined;
    try {
      report.training = await benchmark(incumbent, "train");
      if (report.training.errorCount) throw new Error("training_execution_incomplete");
      input.onProgress?.("propose-skill");
      const proposal = structuredClone(await withDeadline((signal) => input.proposer({
        incumbent: structuredClone(incumbent), training: structuredClone(report.training!),
        hypotheses: structuredClone(state.hypotheses.slice(-40)), signal,
      }), input.timeoutMs ?? 90_000, input.signal));
      validateSkills([proposal.skill]);
      const evidence = new Set(report.training.results.map((row) => row.id));
      if (!proposal.skill.evidenceIds.every((id) => evidence.has(id))
        || typeof proposal.hypothesis?.statement !== "string" || !proposal.hypothesis.statement.trim()
        || proposal.hypothesis.statement.length > 1200) throw new Error("proposal_evidence_invalid");
      hypothesis = {
        id: report.id, statement: proposal.hypothesis.statement,
        evidenceIds: [...proposal.skill.evidenceIds], status: "proposed",
      };
      state.hypotheses.push(hypothesis);
      await input.store.writeState(state);
      const skills = incumbent.skills.filter((skill) => skill.id !== proposal.skill.id).concat(proposal.skill);
      if (JSON.stringify(skills) === JSON.stringify(incumbent.skills)) throw new Error("proposal_unchanged");
      const candidate = await createTeachingRevision(input.basePrompt, skills, incumbent.id);
      report.candidateRevisionId = candidate.id;
      await input.store.put(revisionKey(candidate.id), candidate);
      const baselineValidation = await benchmark(incumbent, "validation");
      const candidateValidation = await benchmark(candidate, "validation");
      report.validation = {
        baseline: baselineValidation, candidate: candidateValidation,
        decision: compareEpisodeBenchmarks(baselineValidation, candidateValidation),
      };
      if (baselineValidation.errorCount || candidateValidation.errorCount) throw new Error("validation_execution_incomplete");
      report.status = "rejected";
      report.reasons = report.validation.decision.reasons;
      if (report.validation.decision.accepted) {
        state.consumedHoldouts.push(holdoutDigest);
        state.consumedHoldoutFamilies.push(...holdoutCases.map((item) => item.family));
        await input.store.writeState(state);
        const baselineHoldout = await benchmark(incumbent, "holdout");
        const candidateHoldout = await benchmark(candidate, "holdout");
        report.holdout = {
          baseline: baselineHoldout, candidate: candidateHoldout,
          decision: compareEpisodeBenchmarks(baselineHoldout, candidateHoldout),
        };
        if (baselineHoldout.errorCount || candidateHoldout.errorCount) throw new Error("holdout_execution_incomplete");
        report.reasons = report.holdout.decision.reasons;
        if (report.holdout.decision.accepted) report.status = "accepted";
      }
    } catch (error) {
      const safeCodes = ["training_execution_incomplete", "validation_execution_incomplete", "holdout_execution_incomplete", "proposal_evidence_invalid", "proposal_unchanged", "skill_budget_exceeded"];
      report.status = "failed";
      report.reasons = [error instanceof Error && safeCodes.includes(error.message) ? error.message : "experiment_execution_failed"];
    }
    if (hypothesis) hypothesis.status = report.status === "accepted" ? "supported-offline" : report.status === "rejected" ? "rejected" : "proposed";
    // Evidence is durable before its revision becomes active. Failed/rejected knowledge persists.
    await input.store.put(`experiments/${report.id}`, report);
    if (report.status === "accepted") {
      const latest = await readEvolutionState(input.store);
      if (latest.active?.revisionId !== state.active?.revisionId || latest.active?.generation !== state.active?.generation) throw new Error("activation_conflict");
      state.active = {
        revisionId: report.candidateRevisionId!, experimentId: report.id,
        generation: (state.active?.generation ?? 0) + 1, activatedAt: new Date().toISOString(),
      };
    }
    await input.store.writeState(state);
    return report;
  });
}

export function teachingExperimentMarkdown(report: TeachingExperiment): string {
  const comparison = report.holdout ?? report.validation;
  const score = (value: number | null | undefined) => value == null ? "unavailable" : `${(value * 100).toFixed(1)}%`;
  return [
    "# Teaching experiment", "", `- Status: ${report.status}`,
    `- Evidence: synthetic learner prefixes, executed tutor behavior, fixed rubric judgments`,
    `- Human learning, retention, and transfer: unmeasured`,
    `- Baseline revision: ${report.baselineRevisionId}`,
    `- Candidate revision: ${report.candidateRevisionId ?? "none"}`,
    `- Baseline behavior score: ${score(comparison?.baseline.meanScore)}`,
    `- Candidate behavior score: ${score(comparison?.candidate.meanScore)}`,
    `- Validation: ${report.validation?.decision.accepted ? "passed" : "not passed"}`,
    `- Holdout: ${report.holdout?.decision.accepted ? "passed" : report.holdout ? "not passed" : "not accessed"}`,
    `- Decision: ${report.reasons.join(", ") || "eligible for experimental teaching use"}`,
    "", "Activation applies to subsequent sessions. A higher behavior score does not establish human learning gains.", "",
  ].join("\n");
}

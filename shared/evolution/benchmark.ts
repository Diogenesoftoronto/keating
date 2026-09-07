import type {
  CriterionJudgment, EpisodeBenchmark, EpisodeExecution, EpisodeJudge, EpisodeMessage,
  EpisodeResult, EpisodeRunner, EpisodeSplit, PromotionDecision, TeachingCase,
  TeachingCriterion, TeachingRevision, TeachingSkill,
} from "./contracts.js";

export async function contentDigest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function validateSkills(skills: readonly TeachingSkill[]): void {
  if (skills.length > 12) throw new Error("skill_budget_exceeded");
  const ids = new Set<string>();
  for (const skill of skills) {
    if (!skill || !/^[a-z][a-z0-9-]{0,63}$/.test(skill.id) || ids.has(skill.id)) throw new Error("invalid_skill_id");
    ids.add(skill.id);
    if (skill.patternIds !== undefined && (!Array.isArray(skill.patternIds) || skill.patternIds.length > 16
      || new Set(skill.patternIds).size !== skill.patternIds.length || skill.patternIds.some(id => !/^[a-z][a-z0-9-]{0,63}$/.test(id)))) throw new Error("invalid_skill_pattern_links");
    for (const [value, maximum] of [[skill.title, 120], [skill.instructions, 8000], [skill.hypothesis, 1200]] as const) {
      if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new Error("invalid_skill_content");
    }
    if (!Array.isArray(skill.evidenceIds) || skill.evidenceIds.length === 0 || skill.evidenceIds.length > 32
      || skill.evidenceIds.some((id) => typeof id !== "string" || !id || id.length > 180)) throw new Error("invalid_skill_evidence");
  }
  if (JSON.stringify(skills).length > 32_000) throw new Error("skill_budget_exceeded");
}

export async function createTeachingRevision(
  basePrompt: string, skills: TeachingSkill[] = [], parentId: string | null = null,
): Promise<TeachingRevision> {
  if (!basePrompt.trim() || basePrompt.length > 120_000) throw new Error("invalid_base_prompt");
  validateSkills(skills);
  const content = { schemaVersion: 1 as const, parentId, basePrompt, skills: structuredClone(skills) };
  return { ...content, id: await contentDigest(content), createdAt: new Date().toISOString() };
}

export async function verifyTeachingRevision(revision: TeachingRevision): Promise<void> {
  if (revision.schemaVersion !== 1 || !Number.isFinite(Date.parse(revision.createdAt))) throw new Error("invalid_revision");
  const expected = await createTeachingRevision(revision.basePrompt, revision.skills, revision.parentId);
  if (expected.id !== revision.id) throw new Error("revision_digest_mismatch");
}

export function composeTeachingPrompt(revision: TeachingRevision): string {
  if (revision.skills.length === 0) return revision.basePrompt;
  return `${revision.basePrompt}\n\n## Evaluated teaching procedures\nThese procedures supplement the teaching protocol. Apply their stated conditions.\n${revision.skills.map((skill) => `\n### ${skill.title}\n${skill.instructions}`).join("\n")}`;
}

export function validateTeachingCases(cases: readonly TeachingCase[]): void {
  if (!Array.isArray(cases) || cases.length === 0 || cases.length > 200) throw new Error("invalid_suite_size");
  const ids = new Set<string>();
  const families = new Map<string, EpisodeSplit>();
  for (const item of cases) {
    if (!item || typeof item.id !== "string" || !item.id.trim() || item.id.length > 64 || ids.has(item.id)
      || typeof item.family !== "string" || !item.family.trim() || item.family.length > 120
      || !["mathematics", "programming"].includes(item.domain)
      || !["train", "validation", "holdout"].includes(item.split)) throw new Error("invalid_case_identity");
    ids.add(item.id);
    if (families.has(item.family) && families.get(item.family) !== item.split) throw new Error("case_family_leakage");
    families.set(item.family, item.split);
    if (!Array.isArray(item.messages) || !item.messages.length || item.messages.at(-1)?.role !== "user"
      || item.messages.some((message: EpisodeMessage) => !message || !["user", "assistant"].includes(message.role)
        || typeof message.content !== "string" || !message.content.trim())) throw new Error("invalid_case_conversation");
    if (!Array.isArray(item.rubric) || !item.rubric.length
      || item.rubric.some((criterion: TeachingCriterion) => !criterion || typeof criterion.id !== "string" || !criterion.id.trim()
        || typeof criterion.description !== "string" || !criterion.description.trim() || typeof criterion.critical !== "boolean")
      || !item.rubric.some((criterion: TeachingCriterion) => criterion.critical)
      || new Set(item.rubric.map((criterion: TeachingCriterion) => criterion.id)).size !== item.rubric.length
    ) throw new Error("invalid_case_rubric");
  }
}

function validJudgments(testCase: TeachingCase, judgments: CriterionJudgment[]): boolean {
  return Array.isArray(judgments) && judgments.length === testCase.rubric.length
    && judgments.every((entry) => !!entry)
    && new Set(judgments.map((entry) => entry.criterionId)).size === judgments.length
    && judgments.every((entry) => testCase.rubric.some((criterion) => criterion.id === entry.criterionId)
      && typeof entry.passed === "boolean" && typeof entry.rationale === "string"
      && entry.rationale.trim().length > 0 && entry.rationale.length <= 4000);
}

function validExecution(execution: EpisodeExecution): boolean {
  return !!execution && typeof execution.model === "string" && !!execution.model
    && typeof execution.runtime === "string" && !!execution.runtime
    && Array.isArray(execution.toolCalls) && Array.isArray(execution.messages)
    && execution.messages.at(-1)?.role === "assistant" && !!execution.messages.at(-1)?.content.trim()
    && execution.messages.every((message) => ["user", "assistant"].includes(message.role) && typeof message.content === "string")
    && JSON.stringify(execution).length <= 256_000;
}

/** Timeout also reaches the adapter, which must stop its underlying execution. */
export async function withDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>, milliseconds: number, outer?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  if (outer?.aborted) controller.abort();
  outer?.addEventListener("abort", abort, { once: true });
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error("episode_cancelled_or_timed_out"));
        controller.signal.addEventListener("abort", onAbort, { once: true });
        if (controller.signal.aborted) onAbort();
        timer = setTimeout(abort, milliseconds);
      }),
      controller.signal.aborted ? Promise.reject(new Error("episode_cancelled_or_timed_out")) : operation(controller.signal),
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbort) controller.signal.removeEventListener("abort", onAbort);
    outer?.removeEventListener("abort", abort);
    controller.abort();
  }
}

export async function runEpisodeBenchmark(input: {
  cases: readonly TeachingCase[];
  split: EpisodeSplit;
  revision: TeachingRevision;
  runner: EpisodeRunner;
  judge: EpisodeJudge;
  repeats?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<EpisodeBenchmark> {
  // Callers/adapters can mutate their own objects while async work is pending.
  input = { ...input, cases: structuredClone(input.cases), revision: structuredClone(input.revision) };
  validateTeachingCases(input.cases);
  await verifyTeachingRevision(input.revision);
  const systemPrompt = composeTeachingPrompt(input.revision);
  const repeats = input.repeats ?? 1;
  const timeout = input.timeoutMs ?? 90_000;
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 5 || !Number.isFinite(timeout) || timeout < 1 || timeout > 300_000) throw new Error("invalid_episode_budget");
  const selected = input.cases.filter((item) => item.split === input.split);
  if (selected.length === 0) throw new Error("empty_benchmark_split");
  const results: EpisodeResult[] = [];
  const runId = globalThis.crypto.randomUUID();
  const suiteDigest = await contentDigest(input.cases);
  for (const testCase of selected) {
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      const result: EpisodeResult = {
        id: `${runId}:${input.revision.id}:${testCase.id}:${repeat}`,
        caseId: testCase.id, family: testCase.family, split: input.split, repeat,
        revisionId: input.revision.id, status: "runner-error", score: null,
        criticalPassed: false, judgments: [],
      };
      try {
        result.execution = structuredClone(await withDeadline((signal) => input.runner({
          caseId: testCase.id, systemPrompt,
          messages: structuredClone(testCase.messages), signal,
        }), timeout, input.signal));
        if (!validExecution(result.execution)) throw new Error("invalid_episode_execution");
        result.status = "judge-error";
        const judgments = structuredClone(await withDeadline((signal) => input.judge({
          testCase: structuredClone(testCase), execution: structuredClone(result.execution!), signal,
        }), timeout, input.signal));
        if (!validJudgments(testCase, judgments)) throw new Error("invalid_judge_result");
        result.judgments = judgments;
        result.score = judgments.filter((entry) => entry.passed).length / judgments.length;
        result.criticalPassed = testCase.rubric.filter((criterion) => criterion.critical)
          .every((criterion) => judgments.find((entry) => entry.criterionId === criterion.id)?.passed === true);
        result.status = "ok";
      } catch {
        if (result.status === "runner-error") delete result.execution;
        result.errorCode = result.status === "runner-error" ? "episode_execution_failed" : "episode_judging_failed";
      }
      results.push(result);
    }
  }
  const errorCount = results.filter((result) => result.status !== "ok").length;
  return {
    schemaVersion: 1, runId, suiteDigest, revisionId: input.revision.id, split: input.split,
    evidenceKind: "synthetic", metric: "fixed-rubric-behavior-v1", repeats,
    caseManifest: structuredClone(selected), results, errorCount,
    // Incomplete experiments have no aggregate score, never a mean of just survivors.
    meanScore: errorCount ? null : results.reduce((sum, result) => sum + result.score!, 0) / results.length,
  };
}

/** Re-derive scores from the fixed manifest; cached summaries are never authority. */
export function validateEpisodeBenchmark(benchmark: EpisodeBenchmark): void {
  const invalid = () => { throw new Error("invalid_episode_evidence"); };
  if (!benchmark || benchmark.schemaVersion !== 1
    || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(benchmark.runId)
    || !/^sha256:[a-f0-9]{64}$/.test(benchmark.suiteDigest)
    || !/^sha256:[a-f0-9]{64}$/.test(benchmark.revisionId)
    || !["train", "validation", "holdout"].includes(benchmark.split)
    || benchmark.evidenceKind !== "synthetic" || benchmark.metric !== "fixed-rubric-behavior-v1"
    || !Number.isInteger(benchmark.repeats) || benchmark.repeats < 1 || benchmark.repeats > 5
    || !Array.isArray(benchmark.results)) invalid();
  try { validateTeachingCases(benchmark.caseManifest); } catch { invalid(); }
  if (benchmark.caseManifest.some((item) => item.split !== benchmark.split)) invalid();
  if (benchmark.results.length !== benchmark.caseManifest.length * benchmark.repeats) throw new Error("incomplete_evidence");
  const cases = new Map(benchmark.caseManifest.map((item) => [item.id, item]));
  const seen = new Set<string>();
  let errors = 0;
  let total = 0;
  for (const row of benchmark.results) {
    if (!row) invalid();
    const testCase = cases.get(row.caseId);
    const key = `${row.caseId}:${row.repeat}`;
    if (!testCase || seen.has(key) || !Number.isInteger(row.repeat) || row.repeat < 0 || row.repeat >= benchmark.repeats
      || row.family !== testCase.family || row.split !== benchmark.split || row.revisionId !== benchmark.revisionId
      || row.id !== `${benchmark.runId}:${benchmark.revisionId}:${key}`
      || !["ok", "runner-error", "judge-error"].includes(row.status)) invalid();
    seen.add(key);
    if (row.status !== "ok") {
      errors += 1;
      if (row.score !== null || row.criticalPassed !== false || !Array.isArray(row.judgments) || row.judgments.length !== 0
        || row.errorCode !== (row.status === "runner-error" ? "episode_execution_failed" : "episode_judging_failed")
        || (row.status === "judge-error" && !validExecution(row.execution!))
        || (row.status === "runner-error" && row.execution !== undefined)) invalid();
      continue;
    }
    if (!validExecution(row.execution!) || !validJudgments(testCase!, row.judgments) || row.errorCode !== undefined) invalid();
    const expectedScore = row.judgments.filter((entry) => entry.passed).length / row.judgments.length;
    const expectedCritical = testCase!.rubric.filter((criterion) => criterion.critical)
      .every((criterion) => row.judgments.find((entry) => entry.criterionId === criterion.id)?.passed === true);
    if (typeof row.score !== "number" || !Number.isFinite(row.score) || Math.abs(row.score - expectedScore) > 1e-12
      || row.criticalPassed !== expectedCritical) invalid();
    total += expectedScore;
  }
  const expectedMean = errors ? null : total / benchmark.results.length;
  if (benchmark.errorCount !== errors
    || (expectedMean === null ? benchmark.meanScore !== null
      : typeof benchmark.meanScore !== "number" || !Number.isFinite(benchmark.meanScore)
        || Math.abs(benchmark.meanScore - expectedMean) > 1e-12)) invalid();
}

function signTest(wins: number, losses: number): number {
  const n = wins + losses;
  if (!n) return 1;
  let term = 2 ** -n;
  let tail = 0;
  for (let k = 0; k <= n; k += 1) {
    if (k >= wins) tail += term;
    term *= (n - k) / (k + 1);
  }
  return Math.min(1, tail);
}

/** Fixed gate: candidates cannot tune thresholds, metrics, weights, or missingness. */
export function compareEpisodeBenchmarks(baseline: EpisodeBenchmark, candidate: EpisodeBenchmark): PromotionDecision {
  const decision: PromotionDecision = {
    accepted: false, scope: "experimental-teaching-behavior", reasons: [],
    pairedCases: 0, wins: 0, losses: 0, ties: 0, meanDelta: null, pValue: null,
  };
  try {
    validateEpisodeBenchmark(baseline);
    validateEpisodeBenchmark(candidate);
  } catch (error) {
    decision.reasons.push(error instanceof Error && error.message === "incomplete_evidence" ? "incomplete_evidence" : "invalid_episode_evidence");
    return decision;
  }
  if (baseline.split === "train" || baseline.split !== candidate.split || baseline.suiteDigest !== candidate.suiteDigest
    || baseline.repeats !== candidate.repeats || baseline.metric !== candidate.metric
    || baseline.revisionId === candidate.revisionId || baseline.runId === candidate.runId
    || JSON.stringify(baseline.caseManifest) !== JSON.stringify(candidate.caseManifest)) decision.reasons.push("incompatible_experiments");
  if (baseline.errorCount || candidate.errorCount || baseline.meanScore === null || candidate.meanScore === null) decision.reasons.push("incomplete_evidence");
  const key = (row: EpisodeResult) => `${row.caseId}:${row.repeat}`;
  const before = new Map(baseline.results.map((row) => [key(row), row]));
  const after = new Map(candidate.results.map((row) => [key(row), row]));
  if (!before.size || before.size !== baseline.results.length || after.size !== candidate.results.length
    || before.size !== after.size || [...before.keys()].some((id) => !after.has(id))) decision.reasons.push("unpaired_evidence");
  if (decision.reasons.length) return decision;
  const families = new Map<string, number[]>();
  for (const [id, left] of before) {
    const right = after.get(id)!;
    if (left.status !== "ok" || right.status !== "ok" || left.score === null || right.score === null
      || !Number.isFinite(left.score) || !Number.isFinite(right.score)
      || left.score < 0 || right.score < 0 || left.score > 1 || right.score > 1
      || left.family !== right.family || left.revisionId !== baseline.revisionId || right.revisionId !== candidate.revisionId) {
      decision.reasons.push("invalid_episode_evidence"); break;
    }
    if (!right.criticalPassed) decision.reasons.push("critical_criterion_failed");
    if (left.execution?.model !== right.execution?.model || left.execution?.runtime !== right.execution?.runtime
      || !left.execution?.model || !left.execution.runtime) decision.reasons.push("runtime_or_model_changed");
    const deltas = families.get(left.family) ?? [];
    deltas.push(right.score - left.score);
    families.set(left.family, deltas);
  }
  const deltas = [...families.values()].map((values) => values.reduce((sum, value) => sum + value, 0) / values.length);
  decision.pairedCases = deltas.length;
  decision.wins = deltas.filter((delta) => delta > 1e-9).length;
  decision.losses = deltas.filter((delta) => delta < -1e-9).length;
  decision.ties = deltas.length - decision.wins - decision.losses;
  decision.meanDelta = deltas.length ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length : null;
  decision.pValue = signTest(decision.wins, decision.losses);
  if (decision.pairedCases < 6) decision.reasons.push("insufficient_independent_cases");
  if (decision.meanDelta === null || decision.meanDelta < 0.05) decision.reasons.push("improvement_too_small");
  if (decision.losses > 0) decision.reasons.push("case_family_regression");
  if (decision.pValue > 0.05) decision.reasons.push("improvement_uncertain");
  decision.reasons = [...new Set(decision.reasons)];
  decision.accepted = decision.reasons.length === 0;
  return decision;
}

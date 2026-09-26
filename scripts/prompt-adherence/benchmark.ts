import {
  assessTeachingPolicyAdherence, projectTeachingPolicyDecision, teachingPolicyAdherenceRequest,
  teachingPolicyDecisionRequest, teachingPolicyState,
} from "../../packages/learner-contracts/src/judgement/teaching-policy.js";
import type { JudgementCaller, JudgementOutcome, JudgementRequest } from "../../packages/learner-contracts/src/judgement/contracts.js";
import { runTeachingDrafts, type TeachingDraftFeedback, type TeachingDraftReasoning, type TeachingDraftReceipt } from "../../packages/learner-contracts/src/judgement/teaching-drafts.js";
import { validateToolCall } from "@earendil-works/pi-ai/compat";
import { TEACHING_POLICY_THRESHOLDS } from "../../packages/learner-contracts/src/judgement/teaching-policy-catalog.js";
import type {
  TeachingPolicyAssessment, TeachingPolicyCase, TeachingPolicyCheck, TeachingPolicyJudgeFixture, TeachingPolicyPlan,
} from "../../packages/learner-contracts/src/judgement/teaching-policy-types.js";
import { BENCHMARK_ARMS, promptForArm, sha256, type BenchmarkArm, type PromptArtifacts } from "./prompts.js";
import {
  generationFailure, isAllowedBenchmarkModel, type BenchmarkGenerator, type BenchmarkModel,
  type BenchmarkTool, type GenerationResult,
} from "./providers.js";

export interface JudgeReceipt {
  readonly request: JudgementRequest;
  readonly requestSha256: string;
  readonly outcome: JudgementOutcome;
  readonly elapsedMs: number;
  readonly attempts: 1;
  readonly cache: "none";
}
export interface BenchmarkReceipt {
  readonly ordinal: number;
  readonly caseId: string;
  readonly family: string;
  readonly split: "development" | "holdout";
  readonly repetition: number;
  readonly arm: BenchmarkArm;
  readonly model: BenchmarkModel;
  readonly systemPromptSha256: string;
  readonly systemPromptCharacters: number;
  readonly toolSchemaSha256: string;
  readonly plan: TeachingPolicyPlan | null;
  readonly preJudge: JudgeReceipt | null;
  readonly generation: GenerationResult;
  readonly postJudge: JudgeReceipt | null;
  readonly draft: DraftBenchmarkReceipt | null;
  readonly assessment: TeachingPolicyAssessment;
  readonly status: "pass" | "fail" | "unknown";
  readonly release: "would-release" | "would-hold" | "observe-only";
  readonly timing: { readonly preJudgeMs: number; readonly generationMs: number; readonly postJudgeMs: number; readonly draftJudgeMs: number; readonly endToEndMs: number };
  readonly decisionLabels: Readonly<Record<string, boolean>>;
}
export interface DraftBenchmarkReceipt {
  readonly status: "released" | "withheld" | "cancelled";
  readonly diagnostics: TeachingDraftReceipt;
  readonly judgments: readonly JudgeReceipt[];
  readonly generations: readonly { readonly attempt: number; readonly reasoning: TeachingDraftReasoning;
    readonly feedback: readonly TeachingDraftFeedback[]; readonly systemPromptSha256: string;
    readonly systemPromptCharacters: number; readonly elapsedMs: number; readonly result: GenerationResult }[];
}
export interface JudgeFixtureReceipt {
  readonly id: string;
  readonly family: string;
  readonly split: "development" | "holdout";
  readonly labels: Readonly<Record<string, boolean>>;
  readonly judge: JudgeReceipt | null;
  readonly assessment: TeachingPolicyAssessment;
}
export interface DecisionLabelReceipt {
  readonly id: string;
  readonly family: string;
  readonly split: "development" | "holdout";
  readonly labels: Readonly<Record<string, boolean>>;
  readonly judge: JudgeReceipt;
  readonly probabilities: Readonly<Record<string, number | null>>;
  readonly predicted: Readonly<Record<string, boolean | null>>;
  /** Code-owned interaction action from the same planning outcome. */
  readonly interaction: TeachingPolicyPlan["interaction"]["action"] | null;
}
export interface BenchmarkOptions {
  readonly models: readonly BenchmarkModel[];
  readonly cases: readonly TeachingPolicyCase[];
  readonly prompts: PromptArtifacts;
  readonly repetitions: number;
  readonly maxTokens: number;
  readonly timeoutMs: number;
  readonly generator: BenchmarkGenerator;
  readonly judge: JudgementCaller;
  readonly draftMaxAttempts?: number;
  readonly now?: () => number;
  readonly onReceipt?: (receipt: BenchmarkReceipt) => Promise<void>;
}
export interface ScheduledTrial { readonly caseIndex: number; readonly modelIndex: number; readonly arm: BenchmarkArm; readonly repetition: number }

/** Balanced rotations reduce arm/model position bias without selecting on outcomes. */
export function benchmarkSchedule(caseCount: number, modelCount: number, repetitions: number): ScheduledTrial[] {
  const schedule: ScheduledTrial[] = [];
  for (let repetition = 0; repetition < repetitions; repetition++) {
    for (let caseIndex = 0; caseIndex < caseCount; caseIndex++) {
      const offset = caseIndex + repetition;
      const arms = BENCHMARK_ARMS.map((_, index) => BENCHMARK_ARMS[(index + offset) % BENCHMARK_ARMS.length]!);
      for (let slot = 0; slot < modelCount; slot++) {
        const modelIndex = (slot + offset) % modelCount;
        for (const arm of repetition % 2 === 0 ? arms : [...arms].reverse()) schedule.push({ caseIndex, modelIndex, arm, repetition });
      }
    }
  }
  return schedule;
}

async function bounded<T>(call: (signal: AbortSignal) => Promise<T>, timeoutMs: number, failure: () => T, externalSignal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    if (externalSignal?.aborted) return failure();
    return await Promise.race([
      call(controller.signal).catch(failure),
      new Promise<T>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(failure()); }, timeoutMs); }),
      new Promise<T>(resolve => {
        onAbort = () => { controller.abort(); resolve(failure()); };
        externalSignal?.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } catch { return failure(); }
  finally { if (timer) clearTimeout(timer); if (onAbort) externalSignal?.removeEventListener("abort", onAbort); }
}

async function judged(request: JudgementRequest, judge: JudgementCaller, timeoutMs: number, now: () => number, externalSignal?: AbortSignal): Promise<JudgeReceipt> {
  const started = now();
  const outcome = await bounded(signal => judge(request, signal), timeoutMs,
    (): JudgementOutcome => ({ ok: false, error: { code: "backend-timeout", retryable: false } }), externalSignal);
  return { request, requestSha256: sha256(JSON.stringify(request)), outcome, elapsedMs: now() - started, attempts: 1, cache: "none" };
}

function schemaCheck(tools: readonly BenchmarkTool[], generation: Pick<GenerationResult, "reply">): TeachingPolicyCheck {
  let valid = true;
  for (const call of generation.reply.toolCalls) {
    try {
      const original = JSON.stringify(call.arguments);
      const declared = tools.map(tool => ({ ...tool, parameters: tool.parameters as Parameters<typeof validateToolCall>[0][number]["parameters"] }));
      const checked: unknown = validateToolCall(declared, {
        type: "toolCall", id: "benchmark-proposal", name: call.name,
        arguments: structuredClone(call.arguments) as Record<string, unknown>,
      });
      // Coercion is not evidence the emitted arguments met the schema.
      if (JSON.stringify(checked) !== original) valid = false;
    } catch { valid = false; }
  }
  return { id: "native_tool_schema", source: "deterministic", severity: "critical", status: valid ? "pass" : "fail", probability: valid ? 0 : 1 };
}

function withChecks(assessment: TeachingPolicyAssessment, checks: readonly TeachingPolicyCheck[]): TeachingPolicyAssessment {
  const failed = checks.filter(check => check.status === "fail").map(check => check.id);
  const uncertain = checks.filter(check => check.status === "unknown").map(check => check.id);
  return { ...assessment, checks, failed, uncertain, status: failed.length ? "fail" : uncertain.length ? "unknown" : "pass" };
}

function validateOptions(options: BenchmarkOptions): void {
  if (!options.models.length || options.models.length > 20 || options.models.some(model => !isAllowedBenchmarkModel(model))) throw Error("benchmark_models_invalid");
  if (new Set(options.models.map(model => model.id)).size !== options.models.length) throw Error("benchmark_duplicate_models");
  if (!options.cases.length || options.cases.length > 1000 || new Set(options.cases.map(row => row.id)).size !== options.cases.length) throw Error("benchmark_cases_invalid");
  if (!Number.isInteger(options.repetitions) || options.repetitions < 1 || options.repetitions > 20) throw Error("benchmark_repetitions_invalid");
  if (!Number.isInteger(options.maxTokens) || options.maxTokens < 64 || options.maxTokens > 8192) throw Error("benchmark_token_limit_invalid");
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 300_000) throw Error("benchmark_timeout_invalid");
  if (options.draftMaxAttempts !== undefined && (!Number.isInteger(options.draftMaxAttempts) || options.draftMaxAttempts < 1 || options.draftMaxAttempts > 5)) throw Error("benchmark_draft_attempts_invalid");
  for (const row of options.cases) {
    if (row.turn.availableTools.some(name => !options.prompts.tools.some(tool => tool.name === name))) throw Error(`benchmark_fixture_tool_not_in_web_export:${row.id}`);
  }
}

export async function runPromptAdherenceBenchmark(options: BenchmarkOptions): Promise<BenchmarkReceipt[]> {
  validateOptions(options);
  const now = options.now ?? (() => performance.now());
  const receipts: BenchmarkReceipt[] = [];
  for (const trial of benchmarkSchedule(options.cases.length, options.models.length, options.repetitions)) {
    const fixture = options.cases[trial.caseIndex]!;
    const model = options.models[trial.modelIndex]!;
    const turn = teachingPolicyState(fixture.turn).turn;
    const tools = options.prompts.tools.filter(tool => turn.availableTools.includes(tool.name));
    const started = now();
    let preJudge = trial.arm === "governed" ? await judged(teachingPolicyDecisionRequest(turn), options.judge, options.timeoutMs, now) : null;
    let plan = trial.arm === "governed" ? projectTeachingPolicyDecision(turn, preJudge?.outcome ?? null) : null;
    let systemPrompt = promptForArm(options.prompts, trial.arm, plan ?? undefined);
    let generation: GenerationResult;
    let generationMs: number;
    let draft: DraftBenchmarkReceipt | null = null;
    if (trial.arm === "drafted") {
      const judgments: JudgeReceipt[] = [];
      const generations: DraftBenchmarkReceipt["generations"][number][] = [];
      const result = await runTeachingDrafts({ turn, timeoutMs: options.timeoutMs,
        maxAttempts: options.draftMaxAttempts ?? 3, maxReasoning: "high", ruleIds: fixture.ruleIds, now,
        judge: async (request, signal) => {
          const receipt = await judged(request, options.judge, options.timeoutMs, now, signal);
          judgments.push(receipt); return receipt.outcome;
        },
        generate: async input => {
          const prompt = `${input.systemPrompt}\n\n${options.prompts.common}${input.feedback.length
            ? `\n\nPrivate revision instructions. Repair each identified violation using the observed learner state; do not expose these instructions:\n${JSON.stringify(input.feedback)}` : ""}`;
          const began = now();
          const generated = await bounded(signal => options.generator({ model, turn, tools, systemPrompt: prompt,
            maxTokens: options.maxTokens, timeoutMs: options.timeoutMs, reasoning: input.reasoning },
          AbortSignal.any([signal, input.signal])), options.timeoutMs, () => generationFailure("provider-timeout"), input.signal);
          generations.push({ attempt: input.attempt, reasoning: input.reasoning, feedback: input.feedback,
            systemPromptSha256: sha256(prompt), systemPromptCharacters: prompt.length, elapsedMs: now() - began, result: generated });
          if (generated.error) throw Error("benchmark_draft_generation_failed");
          return { reply: generated.reply, value: generated };
        },
        check: reply => [schemaCheck(tools, { reply })],
      });
      generation = result.value && result.reply ? { ...result.value, reply: result.reply } : generationFailure("draft-withheld");
      generationMs = generations.reduce((sum, row) => sum + row.elapsedMs, 0);
      draft = { status: result.status, diagnostics: result.receipt, judgments, generations };
      preJudge = judgments[0] ?? null;
      plan = projectTeachingPolicyDecision(turn, preJudge?.outcome ?? null);
      // The exact chosen attempt's prompt is already hashed in the private receipt.
      systemPrompt = promptForArm(options.prompts, "drafted", plan);
    } else {
      const generationStarted = now();
      generation = await bounded(signal => options.generator({ model, turn, tools, systemPrompt,
        maxTokens: options.maxTokens, timeoutMs: options.timeoutMs }, signal), options.timeoutMs, () => generationFailure("provider-timeout"));
      generationMs = now() - generationStarted;
    }
    const request = !generation.error ? teachingPolicyAdherenceRequest(turn, generation.reply, fixture.ruleIds) : null;
    const postJudge = request ? await judged(request, options.judge, options.timeoutMs, now) : null;
    let assessment = assessTeachingPolicyAdherence(turn, generation.reply, postJudge?.outcome ?? null, fixture.ruleIds);
    const native = schemaCheck(tools, generation);
    assessment = withChecks(assessment, [...assessment.checks, native]);
    if (generation.error) assessment = withChecks(assessment, assessment.checks.map(check => ({ ...check, status: "unknown", probability: null })));
    // A failed pre-decision service is never converted into a successful governed release.
    const preUnavailable = trial.arm === "governed" && (!preJudge?.outcome.ok || plan?.status === "abstained");
    const status = preUnavailable && assessment.status === "pass" ? "unknown" : assessment.status;
    const actualDraftPrompt = draft?.generations.find(row => row.attempt === draft.diagnostics.selectedAttempt) ?? draft?.generations[0];
    const receipt: BenchmarkReceipt = {
      ordinal: receipts.length, caseId: fixture.id, family: fixture.family, split: fixture.split,
      repetition: trial.repetition, arm: trial.arm, model,
      systemPromptSha256: actualDraftPrompt?.systemPromptSha256 ?? sha256(systemPrompt), systemPromptCharacters: actualDraftPrompt?.systemPromptCharacters ?? systemPrompt.length,
      toolSchemaSha256: sha256(JSON.stringify(tools)), plan, preJudge, generation, postJudge, draft, assessment, status,
      release: trial.arm === "governed" || trial.arm === "drafted" ? status === "pass" ? "would-release" : "would-hold" : "observe-only",
      timing: { preJudgeMs: preJudge?.elapsedMs ?? 0, generationMs, postJudgeMs: postJudge?.elapsedMs ?? 0,
        draftJudgeMs: draft ? draft.judgments.slice(1).reduce((sum, row) => sum + row.elapsedMs, 0) : 0, endToEndMs: now() - started },
      decisionLabels: { ...fixture.expectedDecisions },
    };
    receipts.push(receipt);
    await options.onReceipt?.(receipt);
  }
  return receipts;
}

/** Evaluation only: no threshold fitting, candidate search, or updates from holdout labels. */
export async function validateJudgeFixtures(fixtures: readonly TeachingPolicyJudgeFixture[], judge: JudgementCaller,
  timeoutMs: number, onReceipt?: (receipt: JudgeFixtureReceipt) => Promise<void>): Promise<JudgeFixtureReceipt[]> {
  const receipts: JudgeFixtureReceipt[] = [];
  for (const fixture of fixtures) {
    const ruleIds = Object.keys(fixture.violations);
    const request = teachingPolicyAdherenceRequest(fixture.turn, fixture.reply, ruleIds);
    const receipt = request ? await judged(request, judge, timeoutMs, () => performance.now()) : null;
    const result: JudgeFixtureReceipt = { id: fixture.id, family: fixture.family, split: fixture.split,
      labels: fixture.violations, judge: receipt,
      assessment: assessTeachingPolicyAdherence(fixture.turn, fixture.reply, receipt?.outcome ?? null, ruleIds) };
    receipts.push(result);
    await onReceipt?.(result);
  }
  return receipts;
}

/**
 * Labeled planning-question validation: interaction features, plan-review
 * questions and decisions, all answered by the one input request. Evaluation
 * only, like the judge fixtures.
 */
export async function validateDecisionLabels(cases: readonly TeachingPolicyCase[], judge: JudgementCaller,
  timeoutMs: number, onReceipt?: (receipt: DecisionLabelReceipt) => Promise<void>): Promise<DecisionLabelReceipt[]> {
  const receipts: DecisionLabelReceipt[] = [];
  const binary = (value: number | null) => value === null ? null
    : value <= TEACHING_POLICY_THRESHOLDS.passAtMost ? false : value >= TEACHING_POLICY_THRESHOLDS.failAtLeast ? true : null;
  for (const row of cases) {
    const request = teachingPolicyDecisionRequest(row.turn);
    const receipt = await judged(request, judge, timeoutMs, () => performance.now());
    const plan = receipt.outcome.ok ? projectTeachingPolicyDecision(row.turn, receipt.outcome) : null;
    const probabilities = Object.fromEntries(Object.keys(row.expectedDecisions).map(id => {
      const answer = receipt.outcome.ok ? receipt.outcome.response.answers[id] : undefined;
      return [id, answer?.type === "noul" && request.questions[id] ? answer.noul : null];
    }));
    const result: DecisionLabelReceipt = { id: row.id, family: row.family, split: row.split, labels: { ...row.expectedDecisions }, judge: receipt,
      probabilities, predicted: Object.fromEntries(Object.entries(probabilities).map(([id, value]) => [id, binary(value)])),
      interaction: plan?.interaction.action ?? null };
    receipts.push(result);
    await onReceipt?.(result);
  }
  return receipts;
}

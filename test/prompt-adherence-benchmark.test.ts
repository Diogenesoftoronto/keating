import { describe, expect, test } from "bun:test";
import type { JudgementCaller, JudgementRequest } from "../packages/learner-contracts/src/judgement/contracts.js";
import type { TeachingPolicyCase, TeachingPolicyJudgeFixture } from "../packages/learner-contracts/src/judgement/teaching-policy-types.js";
import { benchmarkSchedule, runPromptAdherenceBenchmark, validateDecisionLabels, validateJudgeFixtures } from "../scripts/prompt-adherence/benchmark.js";
import { createBenchmarkRegistry, isAllowedBenchmarkModel, preflightBenchmarkModels, selectBenchmarkModels, UNAVAILABLE_USAGE, type BenchmarkGenerator, type BenchmarkModel, type GenerationResult } from "../scripts/prompt-adherence/providers.js";
import { labelMetrics, summarizeBenchmark, summarizeDecisionLabels, summarizeJudgeFixtures } from "../scripts/prompt-adherence/report.js";
import { promptForArm, type PromptArtifacts } from "../scripts/prompt-adherence/prompts.js";
import { parseBenchmarkArgs } from "../scripts/prompt-adherence/cli.js";

const model: BenchmarkModel = { id: "google/gemini-test", provider: "google", model: "gemini-test", endpointHost: "generativelanguage.googleapis.com", configured: true };
const base: TeachingPolicyCase = { id: "CANARY_CASE", family: "CANARY_FAMILY", split: "holdout", ruleIds: ["direct_help_withheld"],
  expectedDecisions: { direct_answer_requested: true }, turn: {
    learnerMessage: "What is two plus two?", conversation: [], learnerEvidence: [], availableTools: [], toolResults: [],
    sources: [], assessment: "none", improvementRuns: 0, domain: "general",
  } };
const prompts: PromptArtifacts = { full: "full\nGRAMMAR", common: "GRAMMAR\nSHARED_DOMAIN", tools: [], provenance: { domainSupplement: "SHARED_DOMAIN" } };
const completion: GenerationResult = { reply: { text: "Two plus two is four.", toolCalls: [] }, usage: UNAVAILABLE_USAGE, resolvedModel: "gemini-test", firstOutputMs: null, finishReason: "stop", error: null };
const judgePass: JudgementCaller = async request => ({ ok: true, response: {
  answers: Object.fromEntries(Object.entries(request.questions).map(([id, question]) => [id, question.type === "choice"
    ? { type: "choice", choice: Object.keys(question.criteria)[0]!, confidence: 1,
      probabilities: Object.fromEntries(Object.keys(question.criteria).map((key, index) => [key, index === 0 ? 1 : 0])) }
    : question.type === "score"
      ? { type: "score", score: 0, confidence: 1,
        legend: Object.fromEntries(question.criteria.map((criterion, index) => [String(index), criterion])),
        probabilities: Object.fromEntries(question.criteria.map((_, index) => [String(index), index === 0 ? 1 : 0])) }
    : { type: "noul", noul: id.startsWith("quality_") ? .95 : .05 }])),
  backend: { backend: "fixture", model: "fixture", calibrationSha256: null },
} });
const run = (overrides: Partial<Parameters<typeof runPromptAdherenceBenchmark>[0]> = {}) => runPromptAdherenceBenchmark({
  models: [model], cases: [base], prompts, repetitions: 1, maxTokens: 128, timeoutMs: 1000,
  generator: async () => completion, judge: judgePass, ...overrides,
});

describe("prompt adherence experiment", () => {
  test("excludes forbidden creators through resellers, unknown aliases, and endpoint overrides", () => {
    const candidate = (provider: string, id: string, host: string) => isAllowedBenchmarkModel({ provider, model: id, endpointHost: host });
    expect(candidate("google", "gemini-3-flash", "generativelanguage.googleapis.com")).toBe(true);
    expect(candidate("neuralwatt", "Qwen/Qwen3.6-35B-A3B", "api.neuralwatt.com")).toBe(true);
    expect(candidate("openrouter", "moonshotai/kimi-k2.6", "openrouter.ai")).toBe(true);
    for (const [provider, id, host] of [
      ["openrouter", "openai/gpt-oss-20b", "openrouter.ai"], ["openrouter", "anthropic/claude-opus", "openrouter.ai"],
      ["neuralwatt", "neuralwatt/claude-opus-cached", "api.neuralwatt.com"], ["neuralwatt", "glm-5-fast", "api.neuralwatt.com"],
      ["openrouter", "openrouter/auto", "openrouter.ai"], ["google", "gemini-3-flash", "api.openai.com"],
      ["mystery", "Qwen/Qwen3", "api.neuralwatt.com"], ["openrouter", "qwen/gpt-oss", "openrouter.ai"],
    ]) expect(candidate(provider!, id!, host!)).toBe(false);
    expect(() => selectBenchmarkModels([model], ["openrouter/openai/gpt-4"])).toThrow("disallowed_or_unknown");
  });

  test("native environment credentials pass preflight without provider calls or persistence", async () => {
    const previousGoogle = process.env.GEMINI_API_KEY;
    const previousMinimax = process.env.MINIMAX_API_KEY;
    try {
      process.env.GEMINI_API_KEY = "fixture-google-key-do-not-send";
      process.env.MINIMAX_API_KEY = "fixture-minimax-key-do-not-send";
      const registry = await createBenchmarkRegistry("/tmp/keating-benchmark-no-account-config");
      await preflightBenchmarkModels(registry, [
        { ...model, model: "gemini-3.5-flash", id: "google/gemini-3.5-flash" },
        { provider: "minimax", model: "MiniMax-M2.7-highspeed", id: "minimax/MiniMax-M2.7-highspeed", endpointHost: "api.minimax.io", configured: true },
      ]);
      delete process.env.GEMINI_API_KEY;
      await expect(preflightBenchmarkModels(registry, [{ ...model, model: "gemini-3.5-flash", id: "google/gemini-3.5-flash" }])).rejects.toThrow("credential_unavailable");
    } finally {
      if (previousGoogle === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousGoogle;
      if (previousMinimax === undefined) delete process.env.MINIMAX_API_KEY; else process.env.MINIMAX_API_KEY = previousMinimax;
    }
  });

  test("schedules every cell once per repetition and rotates first arm and model", () => {
    const schedule = benchmarkSchedule(3, 2, 2);
    expect(schedule.length).toBe(48);
    expect(new Set(schedule.map(row => JSON.stringify(row))).size).toBe(48);
    expect(schedule.filter(row => row.repetition === 0 && row.modelIndex === 0).filter((_, index) => index % 4 === 0).map(row => row.arm)).toEqual(["full", "compact", "governed"]);
    expect(schedule[0]!.modelIndex).toBe(0);
    expect(schedule[8]!.modelIndex).toBe(1);
  });

  test("labels and arbitrary turn keys never cross generation or judgment boundaries", async () => {
    const calls: JudgementRequest[] = [];
    const actorInputs: string[] = [];
    const tainted = { ...base, turn: { ...base.turn, hiddenExpectedAnswer: "CANARY_TARGET" } };
    const rows = await run({ cases: [tainted], generator: async request => { actorInputs.push(JSON.stringify(request.turn)); return completion; },
      judge: async request => { calls.push(request); return judgePass(request); } });
    expect(rows.length).toBe(4);
    expect(calls.length).toBe(8);
    for (const encoded of [...actorInputs, ...calls.map(request => JSON.stringify(request))]) {
      expect(encoded).not.toContain("CANARY_");
      expect(encoded).not.toContain("expectedDecisions");
      expect(encoded).not.toContain("hiddenExpectedAnswer");
      expect(encoded).not.toContain('"holdout"');
    }
    const post = calls.filter(request => "reply" in (request.state as object) && !("quality_progress" in request.questions));
    expect(new Set(post.map(request => JSON.stringify(request))).size).toBe(1);
    expect(rows.every(row => row.systemPromptCharacters > 0)).toBe(true);
  });

  test("end-to-end includes pre-decisions, generation, and blind post-judgment", async () => {
    let clock = 0;
    const rows = await run({ now: () => clock, generator: async () => { clock += 11; return completion; },
      judge: async request => { clock += 5; return judgePass(request); } });
    expect(rows.find(row => row.arm === "full")!.timing).toEqual({ preJudgeMs: 0, generationMs: 11, postJudgeMs: 5, draftJudgeMs: 0, endToEndMs: 16 });
    expect(rows.find(row => row.arm === "governed")!.timing).toEqual({ preJudgeMs: 5, generationMs: 11, postJudgeMs: 5, draftJudgeMs: 0, endToEndMs: 21 });
    expect(rows.find(row => row.arm === "drafted")!.timing).toEqual({ preJudgeMs: 5, generationMs: 11, postJudgeMs: 5, draftJudgeMs: 10, endToEndMs: 31 });
    const pairs = summarizeBenchmark(rows).pairs;
    expect(pairs.find(row => row.arm === "governed")!.endToEndMsDeltaMedianComplete).toBe(5);
  });

  test("generation errors remain unknown in every rule and report denominator", async () => {
    const rows = await run({ generator: async () => ({ ...completion, error: "provider-failed" }) });
    expect(rows.every(row => row.status === "unknown")).toBe(true);
    expect(rows.every(row => row.postJudge === null)).toBe(true);
    expect(rows.flatMap(row => row.assessment.checks).every(check => check.status === "unknown")).toBe(true);
    const summary = summarizeBenchmark(rows);
    expect(summary.groups.every(row => row.total === 1 && row.unknown === 1 && row.generationErrors >= 1)).toBe(true);
    expect(summary.pairs.every(row => row.paired === 1 && row.serviceCompletePairs === 0 && row.endToEndMsDeltaMedianComplete === null)).toBe(true);
  });

  test("a missing pre-judge cannot become a governed release", async () => {
    const rows = await run({ judge: async request => Object.keys(request.questions).includes("learning_task")
      ? { ok: false, error: { code: "backend-unavailable", retryable: false } } : judgePass(request) });
    const governed = rows.find(row => row.arm === "governed")!;
    expect(governed.status).toBe("unknown");
    expect(governed.release).toBe("would-hold");
    expect(rows.find(row => row.arm === "full")!.status).toBe("pass");
  });

  test("native tool schema errors fail before release without executing or coercing arguments", async () => {
    const argumentsValue = { count: "invalid" };
    const rows = await run({ cases: [{ ...base, turn: { ...base.turn, availableTools: ["save"] } }],
      prompts: { ...prompts, tools: [{ name: "save", description: "fixture", parameters: { type: "object", properties: { count: { type: "number" } }, required: ["count"] } }] },
      generator: async () => ({ ...completion, reply: { text: "", toolCalls: [{ name: "save", arguments: argumentsValue }] } }) });
    expect(rows.filter(row => row.arm !== "drafted").every(row => row.status === "fail")).toBe(true);
    expect(rows.filter(row => row.arm !== "drafted").every(row => row.assessment.failed.includes("native_tool_schema"))).toBe(true);
    expect(rows.find(row => row.arm === "drafted")!.release).toBe("would-hold");
    expect(argumentsValue).toEqual({ count: "invalid" });
  });

  test("timeouts are bounded, do not retry, and retain scheduled records", async () => {
    let calls = 0;
    const generator: BenchmarkGenerator = async () => { calls++; return new Promise(() => {}); };
    const rows = await run({ generator, timeoutMs: 5 });
    expect(calls).toBeGreaterThanOrEqual(4);
    expect(rows.length).toBe(4);
    expect(rows.filter(row => row.arm !== "drafted").every(row => row.generation.error === "provider-timeout")).toBe(true);
    expect(rows.find(row => row.arm === "drafted")!.release).toBe("would-hold");
  });

  test("fixture validation hides labels and reports holdout confusion and missing coverage", async () => {
    const fixture: TeachingPolicyJudgeFixture = { id: "CANARY_FIXTURE", family: "CANARY_FAMILY", split: "holdout", turn: base.turn,
      reply: completion.reply, violations: { direct_help_withheld: true } };
    let seen = "";
    const receipts = await validateJudgeFixtures([fixture], async request => { seen = JSON.stringify(request); return judgePass(request); }, 1000);
    expect(seen).not.toContain("CANARY_");
    expect(seen).not.toContain('"violations"');
    const summary = summarizeJudgeFixtures(receipts);
    expect(summary.splits.find(row => row.split === "holdout")!.fn).toBe(1);
    expect(summary.splits.find(row => row.split === "development")!.labels).toBe(0);
    expect(summary.uncoveredRules.length).toBeGreaterThan(0);
    expect(summary.thresholdFit).toBe("none");
  });

  test("planning labels report per-label precision and recall and the overuse-trap none rate, without showing labels to the judge", async () => {
    const turn = { ...base.turn, learnerMessage: "Why does a longer pendulum swing more slowly?" };
    const rows: TeachingPolicyCase[] = [
      { ...base, id: "feature-hit", family: "f1", split: "development", ruleIds: [], turn, expectedDecisions: { variable_relationship: true } },
      { ...base, id: "feature-miss", family: "f2", split: "development", ruleIds: [], turn, expectedDecisions: { variable_relationship: false } },
      { ...base, id: "trap", family: "f3", split: "development", ruleIds: [], turn, expectedDecisions: { variable_relationship: false } },
    ];
    const seen: string[] = [];
    const judge: JudgementCaller = async request => { seen.push(JSON.stringify(request)); return { ok: true, response: {
      backend: { backend: "fixture", model: "fixture", calibrationSha256: null },
      answers: Object.fromEntries(Object.keys(request.questions).map(id => [id, { type: "noul", noul: id === "learning_task" ? 0.95 : id === "variable_relationship" ? 0.95 : 0.01 }])),
    } }; };
    const receipts = await validateDecisionLabels(rows, judge, 1000);
    expect(seen.join("")).not.toContain("expectedDecisions");
    expect(seen.join("")).not.toContain("feature-hit");
    const summary = summarizeDecisionLabels(receipts, ["trap"]);
    expect(summary.labels.find(row => row.labelId === "variable_relationship" && row.split === "development")).toMatchObject({ tp: 1, fp: 2, precision: 1 / 3, recall: 1 });
    expect(summary.overuseTraps).toEqual({ total: 1, none: 0, noneRate: 0 });
    expect(summary.interactionActions.create).toBe(3);
  });

  test("Brier sample denominator excludes missing probabilities while total retains abstentions", () => {
    const metrics = labelMetrics([
      { expected: false, probability: .1, predicted: false }, { expected: true, probability: .9, predicted: true },
      { expected: true, probability: .5, predicted: null }, { expected: false, probability: null, predicted: null },
    ]);
    expect(metrics).toMatchObject({ labels: 4, tp: 1, tn: 1, fp: 0, fn: 0, unknown: 2, brierSamples: 3, correctRateAll: .5 });
    expect(metrics.brier).toBeCloseTo(.09);
  });

  test("shared grammar and domain requirements survive every prompt arm", () => {
    for (const arm of ["full", "compact", "governed", "drafted"] as const) {
      expect(promptForArm(prompts, arm)).toContain("GRAMMAR");
      expect(promptForArm(prompts, arm)).toContain("SHARED_DOMAIN");
    }
  });

  test("private drafts repair failures and retain every attempt's usage and reasoning choice", async () => {
    let draftAttempts = 0;
    const rows = await run({ generator: async request => {
      if (request.reasoning === undefined) return completion;
      draftAttempts++;
      if (draftAttempts === 2) expect(request.systemPrompt).toContain("direct_help_withheld");
      return { ...completion, reply: { text: draftAttempts === 1 ? "bad draft" : "approved draft", toolCalls: [] },
        usage: { ...UNAVAILABLE_USAGE, inputTokens: 10, outputTokens: 5, source: "fixture" } };
    }, judge: async request => {
      const result = await judgePass(request);
      const state = request.state as { reply?: { text: string } };
      return result.ok && state.reply?.text === "bad draft" ? { ...result, response: { ...result.response,
        answers: { ...result.response.answers, direct_help_withheld: { type: "noul", noul: .95 } } } } : result;
    } });
    const drafted = rows.find(row => row.arm === "drafted")!;
    expect(draftAttempts).toBe(2);
    expect(drafted.generation.reply.text).toBe("approved draft");
    expect(drafted.status).toBe("pass");
    expect(drafted.draft!.diagnostics.selectedAttempt).toBe(2);
    expect(drafted.draft!.generations.map(row => row.reasoning)).toEqual(["off", "low"]);
    expect(drafted.draft!.generations[0]!.result.reply.text).toBe("bad draft");
    expect(summarizeBenchmark(rows).groups.find(row => row.arm === "drafted")!.usage.knownInputTokens).toBe(20);
  });

  test("CLI defaults to no network and rejects unbounded or unknown work", () => {
    expect(parseBenchmarkArgs([], "/tmp").mode).toBe("dry-run");
    expect(parseBenchmarkArgs([], "/tmp").fixtureOffset).toBe(0);
    expect(parseBenchmarkArgs([], "/tmp").limitPlanningCases).toBe(0);
    expect(parseBenchmarkArgs(["--limit-planning-cases", "60"], "/tmp").limitPlanningCases).toBe(60);
    expect(parseBenchmarkArgs(["--execute", "--judge-only", "--limit-fixtures", "2"], "/tmp")).toMatchObject({ mode: "execute", judgeOnly: true, limitFixtures: 2 });
    expect(parseBenchmarkArgs(["--fixture-offset", "48", "--limit-fixtures", "60"], "/tmp")).toMatchObject({ fixtureOffset: 48, limitFixtures: 60 });
    for (const offset of ["-1", "1.5", "Infinity", "9007199254740992"]) {
      expect(() => parseBenchmarkArgs(["--fixture-offset", offset], "/tmp")).toThrow("out_of_bounds");
    }
    expect(() => parseBenchmarkArgs(["--repetitions", "1000"], "/tmp")).toThrow("out_of_bounds");
    expect(() => parseBenchmarkArgs(["--models"], "/tmp")).toThrow("missing_option_value");
    expect(() => parseBenchmarkArgs(["--unknown"], "/tmp")).toThrow("unknown_option");
  });
});

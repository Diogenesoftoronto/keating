#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { TEACHING_INTERACTION_FEATURES, TEACHING_PLAN_REVIEW_QUESTIONS, TEACHING_POLICY_DECISIONS, TEACHING_POLICY_RULES, TEACHING_POLICY_THRESHOLDS, TEACHING_POLICY_VERSION } from "../../packages/learner-contracts/src/judgement/teaching-policy-catalog.js";
import type { JudgementCaller } from "../../packages/learner-contracts/src/judgement/contracts.js";
import { POLICY_CASES, JUDGE_FIXTURES } from "./cases.js";
import { runPromptAdherenceBenchmark, validateDecisionLabels, validateJudgeFixtures, type BenchmarkReceipt, type DecisionLabelReceipt, type JudgeFixtureReceipt } from "./benchmark.js";
import { INTERACTION_FEATURE_CASES, INTERACTION_OVERUSE_TRAPS } from "../../packages/learner-contracts/test/fixtures/interaction-features/cases.js";
import { PLAN_REVIEW_CASES } from "../../packages/learner-contracts/test/fixtures/plan-review/cases.js";
import { BENCHMARK_ARMS, exportPromptArtifacts, sha256 } from "./prompts.js";
import {
  benchmarkModelInventory, createBenchmarkJudge, createBenchmarkRegistry, createRegistryGenerator,
  JUDGE_MODEL, preflightBenchmarkModels, selectBenchmarkModels, type BenchmarkGenerator, type BenchmarkModel,
} from "./providers.js";
import { renderBenchmarkReport, summarizeBenchmark, summarizeDecisionLabels, summarizeDecisions, summarizeJudgeFixtures } from "./report.js";

export interface CliOptions {
  mode: "dry-run" | "smoke" | "execute";
  judgeOnly: boolean;
  listModels: boolean;
  configDir: string;
  models?: string[];
  cases?: string[];
  split: "all" | "development" | "holdout";
  limitCases: number;
  limitFixtures: number;
  limitPlanningCases: number;
  fixtureOffset: number;
  repetitions: number;
  maxTokens: number;
  timeoutMs: number;
  draftAttempts: number;
  out?: string;
}

export function parseBenchmarkArgs(args: readonly string[], root: string): CliOptions {
  const options: CliOptions = { mode: "dry-run", judgeOnly: false, listModels: false,
    configDir: resolve(root, ".keating/pi-config"), split: "all", limitCases: 6,
    limitFixtures: 12, limitPlanningCases: 0, fixtureOffset: 0, repetitions: 1, maxTokens: 1536, timeoutMs: 60_000, draftAttempts: 3 };
  const value = (index: number): string => {
    const result = args[index + 1];
    if (!result || result.startsWith("--")) throw Error(`benchmark_missing_option_value:${args[index]}`);
    return result;
  };
  for (let index = 0; index < args.length; index++) {
    const option = args[index]!;
    if (option === "--execute" || option === "--smoke" || option === "--dry-run") options.mode = option.slice(2) as CliOptions["mode"];
    else if (option === "--judge-only") options.judgeOnly = true;
    else if (option === "--list-models") options.listModels = true;
    else if (option === "--config-dir") options.configDir = resolve(value(index++));
    else if (option === "--models") options.models = value(index++).split(",");
    else if (option === "--cases") options.cases = value(index++).split(",");
    else if (option === "--out") options.out = resolve(value(index++));
    else if (option === "--split") {
      const split = value(index++);
      if (split !== "all" && split !== "development" && split !== "holdout") throw Error("benchmark_split_invalid");
      options.split = split;
    } else {
      const numeric = { "--limit-cases": ["limitCases", 1, 1000], "--limit-fixtures": ["limitFixtures", 0, 1000], "--limit-planning-cases": ["limitPlanningCases", 0, 1000],
        "--fixture-offset": ["fixtureOffset", 0, Number.MAX_SAFE_INTEGER],
        "--repetitions": ["repetitions", 1, 20], "--max-tokens": ["maxTokens", 64, 8192], "--timeout-ms": ["timeoutMs", 1, 300_000], "--draft-attempts": ["draftAttempts", 1, 5] } as const;
      const entry = numeric[option as keyof typeof numeric];
      if (!entry) throw Error(`benchmark_unknown_option:${option}`);
      const count = Number(value(index++));
      if (!Number.isInteger(count) || count < entry[1] || count > entry[2]) throw Error(`benchmark_option_out_of_bounds:${option}`);
      options[entry[0]] = count;
    }
  }
  return options;
}

async function judgeKey(): Promise<string> {
  const fromEnv = process.env.TYPESAFE_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const result = Bun.spawnSync(["rtk", "proxy", "skate", "get", "typesafe_api_key@secrets"], { stdout: "pipe", stderr: "pipe" });
  const key = new TextDecoder().decode(result.stdout).trim();
  if (result.exitCode === 0 && key) return key;
  const diagnostic = new TextDecoder().decode(result.stderr);
  throw Error(/permission|not permitted|sandbox/i.test(diagnostic) ? "benchmark_judge_credential_read_blocked" : "benchmark_judge_credential_unavailable");
}

const smokeJudge: JudgementCaller = async request => ({ ok: true, response: {
  answers: Object.fromEntries(Object.entries(request.questions).map(([id, question]) => [id, question.type === "choice"
    ? { type: "choice", choice: Object.keys(question.criteria)[0]!, confidence: 1,
      probabilities: Object.fromEntries(Object.keys(question.criteria).map((key, index) => [key, index === 0 ? 1 : 0])) }
    : { type: "noul", noul: id.startsWith("quality_") ? .95 : .05 }])),
  backend: { backend: "fixture", model: "offline-smoke-fixture", calibrationSha256: null },
} });
const smokeGenerator: BenchmarkGenerator = async () => ({
  reply: { text: "This is an offline plumbing fixture, not a sampled teaching response.", toolCalls: [] },
  usage: { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null,
    actualCostUsd: null, estimatedCostUsd: null, source: "fixture" },
  resolvedModel: "offline-smoke-fixture", firstOutputMs: null, finishReason: "stop", error: null,
});

async function main(): Promise<void> {
  const root = resolve(import.meta.dir, "../..");
  if (process.argv.includes("--help")) {
    console.log("Keating prompt adherence benchmark (experimental, no production activation)\n"
      + "bun scripts/prompt-adherence/cli.ts [--dry-run|--smoke|--execute] [--judge-only] [--list-models]\n"
      + "  --config-dir PATH --models provider/model,provider/model --cases id,id --split all|development|holdout\n"
      + "  --limit-cases 6 --limit-fixtures 12 --limit-planning-cases 0 --fixture-offset 0 --repetitions 1 --max-tokens 1536 --timeout-ms 60000 --draft-attempts 3 --out PATH\n"
      + "Dry-run is the default. Smoke uses injected offline fixtures. --execute enables paid model and Jev calls.\n"
      + "OpenAI, Anthropic, reseller entries for their models, unknown creators, and opaque routing aliases are excluded.");
    return;
  }
  const options = parseBenchmarkArgs(process.argv.slice(2), root);
  const registry = await createBenchmarkRegistry(options.configDir);
  const inventory = benchmarkModelInventory(registry);
  if (options.listModels) { console.log(JSON.stringify({ mode: "local-inventory-no-network", configDir: options.configDir, models: inventory }, null, 2)); return; }
  let models = selectBenchmarkModels(inventory, options.models);
  if (options.mode === "smoke" && !models.length) models = [{ id: "google/gemini-offline-fixture", provider: "google", model: "gemini-offline-fixture", endpointHost: "generativelanguage.googleapis.com", configured: false } satisfies BenchmarkModel];
  if (options.mode === "execute" && !options.judgeOnly && !models.length) throw Error("benchmark_no_eligible_configured_models");
  if (options.mode === "execute" && !options.judgeOnly) await preflightBenchmarkModels(registry, models);
  if (options.cases?.some(id => !POLICY_CASES.some(row => row.id === id))) throw Error("benchmark_case_unknown");
  const cases = POLICY_CASES.filter(row => (options.split === "all" || row.split === options.split) && (!options.cases || options.cases.includes(row.id))).slice(0, options.limitCases);
  const fixtures = JUDGE_FIXTURES.filter(row => options.split === "all" || row.split === options.split)
    .slice(options.fixtureOffset, options.fixtureOffset + options.limitFixtures);
  const planningCases = [...INTERACTION_FEATURE_CASES, ...PLAN_REVIEW_CASES]
    .filter(row => options.split === "all" || row.split === options.split).slice(0, options.limitPlanningCases);
  if (!cases.length && !options.judgeOnly) throw Error("benchmark_no_cases");
  const directory = options.out ?? resolve(root, ".keating/benchmarks/prompt-adherence", `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`);
  await mkdir(dirname(directory), { recursive: true, mode: 0o700 });
  try { await mkdir(directory, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw Error("benchmark_output_exists"); throw error; }
  const write = (name: string, value: unknown) => writeFile(resolve(directory, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  const prompts = await exportPromptArtifacts(root, resolve(directory, "prompts"));
  const implementationFiles = ["benchmark", "providers", "report", "cli", "prompts"].map(name => `scripts/prompt-adherence/${name}.ts`)
    .concat(["packages/learner-contracts/src/judgement/teaching-policy.ts", "packages/learner-contracts/src/judgement/teaching-policy-catalog.ts", "packages/learner-contracts/src/judgement/teaching-drafts.ts", "packages/learner-contracts/src/judgement/interaction-affordances.ts", "packages/learner-contracts/src/judgement/plan-review.ts"]);
  const implementationSha256 = Object.fromEntries(await Promise.all(implementationFiles.map(async path => [path, sha256(await readFile(resolve(root, path), "utf8"))])));
  const manifest = {
    schemaVersion: 1, policyVersion: TEACHING_POLICY_VERSION, createdAt: new Date().toISOString(), mode: options.mode,
    judgeOnly: options.judgeOnly, judgeModel: options.mode === "smoke" ? "offline-smoke-fixture" : JUDGE_MODEL,
    options, models, arms: BENCHMARK_ARMS, caseIds: cases.map(row => row.id), fixtureIds: fixtures.map(row => row.id), planningCaseIds: planningCases.map(row => row.id),
    scheduledTrials: options.judgeOnly ? 0 : models.length * cases.length * options.repetitions * BENCHMARK_ARMS.length,
    corpusSha256: sha256(JSON.stringify(POLICY_CASES)), judgeFixturesSha256: sha256(JSON.stringify(JUDGE_FIXTURES)),
    selectedCorpusSha256: sha256(JSON.stringify(cases)), selectedFixturesSha256: sha256(JSON.stringify(fixtures)), planningCasesSha256: sha256(JSON.stringify(planningCases)),
    decisionQuestionsSha256: sha256(JSON.stringify(TEACHING_POLICY_DECISIONS)), interactionFeatureQuestionsSha256: sha256(JSON.stringify(TEACHING_INTERACTION_FEATURES)), planReviewQuestionsSha256: sha256(JSON.stringify(TEACHING_PLAN_REVIEW_QUESTIONS)), adherenceQuestionsSha256: sha256(JSON.stringify(TEACHING_POLICY_RULES)),
    thresholds: TEACHING_POLICY_THRESHOLDS, calibration: "uncalibrated", thresholdFit: "none",
    provenance: prompts.provenance, implementationSha256, endpointPolicy: "Known explicit non-OpenAI/non-Anthropic creators and known HTTPS endpoints; no opaque aliases or fallbacks",
    toolExecution: false, nativeSchemaValidation: true, productionActivation: false, humanLearning: "unmeasured",
    retries: 0, responseCache: "none", requestedProviderCacheRetention: "none", providerCachingMayStillOccur: true,
    selection: "Identifiers and authored ordering before observing outcomes; counterbalanced arm/model positions by case and repetition",
  };
  await write("manifest.json", manifest);
  let receipts: BenchmarkReceipt[] = [];
  let judgeReceipts: JudgeFixtureReceipt[] = [];
  let planningReceipts: DecisionLabelReceipt[] = [];
  if (options.mode !== "dry-run") {
    const judge = options.mode === "smoke" ? smokeJudge : createBenchmarkJudge(await judgeKey());
    let fixtureOrdinal = 0;
    judgeReceipts = await validateJudgeFixtures(fixtures, judge, options.timeoutMs, async receipt => {
      await write(`judge-${String(fixtureOrdinal++).padStart(4, "0")}.json`, receipt);
      console.log(JSON.stringify({ event: "judge-fixture", completed: fixtureOrdinal, total: fixtures.length, id: receipt.id, status: receipt.assessment.status }));
    });
    let planningOrdinal = 0;
    planningReceipts = await validateDecisionLabels(planningCases, judge, options.timeoutMs, async receipt => {
      await write(`planning-${String(planningOrdinal++).padStart(4, "0")}.json`, receipt);
      console.log(JSON.stringify({ event: "planning-labels", completed: planningOrdinal, total: planningCases.length, id: receipt.id, interaction: receipt.interaction }));
    });
    if (!options.judgeOnly) receipts = await runPromptAdherenceBenchmark({ models, cases, prompts,
      repetitions: options.repetitions, maxTokens: options.maxTokens, timeoutMs: options.timeoutMs, draftMaxAttempts: options.draftAttempts,
      generator: options.mode === "smoke" ? smokeGenerator : createRegistryGenerator(registry), judge,
      onReceipt: async receipt => {
        await write(`trial-${String(receipt.ordinal).padStart(4, "0")}.json`, receipt);
        console.log(JSON.stringify({ event: "trial", completed: receipt.ordinal + 1, total: manifest.scheduledTrials,
          caseId: receipt.caseId, model: receipt.model.id, arm: receipt.arm, status: receipt.status,
          error: receipt.generation.error, endToEndMs: receipt.timing.endToEndMs }));
      },
    });
  }
  await write("summary.json", { mode: options.mode, benchmark: summarizeBenchmark(receipts), judge: summarizeJudgeFixtures(judgeReceipts), decisions: summarizeDecisions(receipts),
    planning: summarizeDecisionLabels(planningReceipts, INTERACTION_OVERUSE_TRAPS) });
  await writeFile(resolve(directory, "report.md"), renderBenchmarkReport({ mode: options.mode, manifest, receipts, fixtures: judgeReceipts, decisionLabels: planningReceipts, overuseTraps: INTERACTION_OVERUSE_TRAPS }), { mode: 0o600, flag: "wx" });
  console.log(JSON.stringify({ event: "complete", directory, mode: options.mode, trials: receipts.length, judgeFixtures: judgeReceipts.length, planningCases: planningReceipts.length,
    ...(options.mode === "dry-run" ? { eligibleConfiguredModels: models.length, plannedTrials: manifest.scheduledTrials } : {}) }));
}

if (import.meta.main) main().catch((error: unknown) => {
  const message = error instanceof Error && error.message.startsWith("benchmark_") ? error.message : "benchmark_failed";
  console.error(message); process.exitCode = 1;
});

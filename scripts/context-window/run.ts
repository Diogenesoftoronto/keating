#!/usr/bin/env bun
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildTrials, contextCases, rolloutCases, makeTrial, trialFromRolloutCase, digest, SUITE_VERSION, FILLS, type Trial } from "./cases.js";
import { hardContextCases, HARD_CASES_VERSION } from "./hard-cases.js";
import { buildKeatingTrials, KEATING_SUITE_VERSION } from "./keating-suite.js";
import { importRolloutCases } from "./rollouts.js";
import { eligibleRolloutCases } from "./eligible-rollouts.js";
import { createSystemOneProvider, createReferenceProvider, loadCredential, type BenchmarkProvider } from "./providers.js";
import { runSuite, replayProvider, completeSchedule, type Receipt } from "./benchmark.js";
import { writeReports } from "./report.js";

interface ProviderSpec { id: string; kind: "system-one" | "reference"; endpoint: string; model: string; expectedModel: string; keyEnv?: string; keyFile?: string; headRevision?: string; encoderRevision?: string; maxOutputTokens?: number }
interface Plan { version: string; createdAt: string; profile: string; selection: string; trials: Trial[]; providers: ProviderSpec[]; maxCalls: number; maxEstimatedInputTokens: number; repetitions: number; excluded: { file: string; reason: string }[]; sha256: string }
const args = parseArgs({ options: { mode: { type: "string", default: "plan" }, out: { type: "string" }, plan: { type: "string" }, config: { type: "string" }, profile: { type: "string", default: "keating" }, rollouts: { type: "string" }, "max-calls": { type: "string", default: "200" }, "max-input-tokens": { type: "string", default: "2000000" }, repetitions: { type: "string", default: "1" }, tape: { type: "string" }, execute: { type: "boolean", default: false } }, strict: true }).values;
function positive(value: string | undefined, name: string) { const n = Number(value); if (!Number.isSafeInteger(n) || n < 1) throw Error(`invalid-${name}`); return n; }
async function loadPlan(path: string): Promise<Plan> {
  const plan = JSON.parse(await readFile(path, "utf8")) as Plan;
  const { sha256, ...body } = plan;
  if (plan.version !== SUITE_VERSION || sha256 !== digest(body) || !Array.isArray(plan.trials) || plan.trials.some(row => row.requestSha256 !== digest(row.request))) throw Error("plan-integrity-failed");
  return plan;
}
function safeSpecs(value: unknown): ProviderSpec[] {
  if (!Array.isArray(value) || !value.length) throw Error("provider-config-required");
  const allowed = new Set(["id", "kind", "endpoint", "model", "expectedModel", "keyEnv", "keyFile", "headRevision", "encoderRevision", "maxOutputTokens"]);
  for (const spec of value) {
    if (!spec || typeof spec !== "object" || Object.keys(spec).some(key => !allowed.has(key)) || !["system-one", "reference"].includes(spec.kind)) throw Error("invalid-provider-config-use-credential-source-not-key");
    const url = new URL(spec.endpoint);
    if (url.username || url.password || url.search || url.hash) throw Error("unsafe-provider-url");
  }
  return value;
}
async function recordReportingProvenance(directory: string) {
  const root = dirname(fileURLToPath(import.meta.url));
  const hashes: Record<string, string> = {};
  for (const name of ["benchmark.ts", "cases.ts", "hard-cases.ts", "trick-cases.ts", "providers.ts", "rollouts.ts", "report.ts", "run.ts", "eligible-rollouts.ts", "compact-plan.ts", "keating-types.ts", "keating-capture.ts", "keating-suite.ts", "keating-planning-cases.ts", "keating-adherence-cases.ts", "keating-grading-cases.ts"]) hashes[name] = digest(await readFile(join(root, name), "utf8"));
  await writeFile(resolve(directory, "report-provenance.json"), JSON.stringify({ reportedAt: new Date().toISOString(), hashMethod: "sha256(JSON.stringify(UTF8 source text))", sourceHashes: hashes }, null, 2), { mode: 0o600 });
}
async function main() {
  if (args.mode === "plan") {
    if (!args.out || !args.config || !["keating", "pilot", "full"].includes(args.profile!)) throw Error("plan-requires-out-config-and-profile-keating-pilot-or-full");
    const providers = safeSpecs(JSON.parse(await readFile(args.config, "utf8")));
    const saved = args.profile !== "keating" && args.rollouts ? await importRolloutCases(args.rollouts) : { cases: [], excluded: [] };
    const eligible = eligibleRolloutCases(saved.cases);
    let trials: Trial[];
    if (args.profile === "keating") {
      trials = await buildKeatingTrials();
    } else if (args.profile === "full") {
      trials = buildTrials();
      for (const fill of FILLS) for (const placement of ["head", "recent", "pinned"] as const) for (const path of ["full", "windowed"] as const) for (const fixture of hardContextCases()) trials.push(makeTrial(fixture, fill, placement, path));
      trials.push(...eligible.cases.map(row => trialFromRolloutCase(row)));
    } else {
      // Predeclared pilot: all 50 reasoning questions at 25%; one easy control
      // over the actual window boundary; three selection controls; all mixed-class
      // saved gate groups. The last selection is stratified, NOT corpus prevalence.
      trials = hardContextCases().map(row => makeTrial(row, 0.25, "pinned", "full"));
      const control = contextCases()[0]!;
      for (const placement of ["head", "recent", "pinned"] as const) for (const path of ["full", "windowed"] as const) trials.push(makeTrial(control, 0.9, placement, path));
      trials.push(...rolloutCases().filter(row => row.split === "holdout").map(row => makeTrial(row, 0.25, "pinned", "full")));
      trials.push(...eligible.cases.filter(row => Object.values(row.expected).some(value => value === true) && Object.values(row.expected).some(value => value === false)).map(row => trialFromRolloutCase(row)));
    }
    const body = { version: SUITE_VERSION, questionSetVersion: args.profile === "keating" ? KEATING_SUITE_VERSION : HARD_CASES_VERSION, createdAt: new Date().toISOString(), profile: args.profile!, selection: args.profile === "keating" ? "50 authored production-shaped episode cases in 25 contrastive families:20 planning,20 draft-review,10 grading. Exact production question batches and state layouts; native conversation length; labelled assertions and rationales outside model inputs. Unlabelled outputs have no accuracy claim. No human-learning or production-traffic prevalence claim. Generic reasoning probes are a separate legacy profile." : args.profile === "pilot" ? "Feasibility only: all 50 reasoning questions at25% pinned (32 independent families; sibling claims correlated); completed-test-a at90% across3 placements×2 paths;3 authored holdout candidate sets; every mixed-class saved gate group. Saved subset is enriched for violations, not corpus prevalence. No claim of population accuracy or scaling laws." : "Complete frozen context grid and saved completed rollout gates. Correlated family variants must not be treated as independent trials.", trials, providers, maxCalls: positive(args["max-calls"], "call-limit"), maxEstimatedInputTokens: positive(args["max-input-tokens"], "input-limit"), repetitions: positive(args.repetitions, "repetitions"), excluded: saved.excluded, gateProtocol: eligible.protocol, diagnostics: eligible.diagnostics.map(row => ({ caseId: row.case.id, reason: row.reason })) };
    const plan: Plan = { ...body, sha256: digest(body) };
    await mkdir(resolve(args.out), { recursive: true, mode: 0o700 });
    await writeFile(resolve(args.out, "plan.json"), JSON.stringify(plan, null, 2), { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ plan: resolve(args.out, "plan.json"), sha256: plan.sha256, trials: trials.length, scheduledCalls: trials.length * providers.length * plan.repetitions, inputTokenReservation: trials.reduce((n, row) => n + row.after.estimatedRequestTokens, 0) * providers.length * plan.repetitions, maxCalls: plan.maxCalls, maxEstimatedInputTokens: plan.maxEstimatedInputTokens, families: new Set(trials.map(row => row.family)).size, questions: trials.reduce((n, row) => n + Object.keys(row.request.questions).length, 0), labelledQuestions: trials.reduce((n, row) => n + Object.keys(row.expected).length, 0) }));
    return;
  }
  if (!args.plan || !args.out) throw Error("run-requires-plan-and-out");
  const plan = await loadPlan(args.plan), directory = resolve(args.out);
  if (args.mode === "report") {
    const receipts = (await readFile(resolve(directory, "receipts.jsonl"), "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as Receipt);
    await writeReports(directory, plan.trials, completeSchedule(plan.trials, plan.providers, plan.repetitions, receipts)); await recordReportingProvenance(directory); console.log(`Reports written to ${directory}`); return;
  }
  if (!["live", "replay"].includes(args.mode!)) throw Error("mode-must-be-plan-live-replay-report");
  if (args.mode === "live" && !args.execute) throw Error("live-requires-execute");
  const tape: Receipt[] = args.mode === "replay" && args.tape ? (await readFile(args.tape, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  if (args.mode === "replay" && !args.tape) throw Error("replay-requires-tape");
  const providers: BenchmarkProvider[] = [];
  for (const spec of plan.providers) {
    if (args.mode === "replay") { providers.push(replayProvider(spec.id, spec.model, tape.filter(row => row.status !== "not-dispatched"), spec.kind)); continue; }
    const key = await loadCredential({ env: spec.keyEnv, file: spec.keyFile });
    if ((spec.keyEnv || spec.keyFile) && !key) throw Error(`missing-credential-for-${spec.id}`);
    providers.push(spec.kind === "reference" ? createReferenceProvider({ ...spec, key: key ?? "", timeoutMs: 180_000 }) : createSystemOneProvider({ ...spec, key, timeoutMs: 120_000, ...(spec.headRevision && spec.encoderRevision ? { revisionManifest: { headRevision: spec.headRevision, encoderRevision: spec.encoderRevision } } : {}) }));
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const receiptPath = resolve(directory, "receipts.jsonl");
  await writeFile(receiptPath, "", { flag: "wx", mode: 0o600 });
  await writeFile(resolve(directory, "run.json"), JSON.stringify({ planSha256: plan.sha256, mode: args.mode, startedAt: new Date().toISOString() }, null, 2), { flag: "wx", mode: 0o600 });
  const receipts = await runSuite({ ...plan, providers, timeoutMs: 180_000, onReceipt: async row => { await appendFile(receiptPath, JSON.stringify(row) + "\n"); console.log(JSON.stringify({ trial: row.trialId, provider: row.providerId, status: row.status, ...(row.outcome.status === "error" ? { error: row.outcome.error } : { latencyMs: Math.round(row.outcome.latencyMs) }) })); } });
  await writeReports(directory, plan.trials, receipts);
  await recordReportingProvenance(directory); console.log(`Completed; reports in ${directory}`);
}
if (import.meta.main) main().catch(error => { console.error(error instanceof Error ? error.message : "benchmark-failed"); process.exitCode = 1; });

#!/usr/bin/env bun
/** Frozen-plan hosted execution only. No translation, scoring, retries, or provider fallback. */
import { constants } from "node:fs";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { hostname } from "node:os";
import { parseArgs } from "node:util";
import { digest, SUITE_VERSION, type Trial } from "./cases.js";
import type { Receipt } from "./benchmark.js";
import { createReferenceProvider, createSystemOneProvider, loadCredential, type BenchmarkProvider, type ProviderResult } from "./providers.js";

interface ProviderSpec {
  id: string; kind: "system-one" | "reference"; endpoint: string; model: string; expectedModel: string;
  keyFile?: string; keyEnv?: string; maxOutputTokens?: number; headRevision?: string; encoderRevision?: string;
}
export interface HostedPlan {
  version: string; sha256: string; trials: Trial[]; providers: ProviderSpec[];
  repetitions: number; maxCalls: number; maxEstimatedInputTokens: number;
}
interface Dispatch { trialId: string; repetition: number; requestSha256: string; startedAt: string }
const key = (row: { trialId: string; repetition: number }) => JSON.stringify([row.trialId, row.repetition]);
function fail(code: string): never { throw new Error(code); }

export function validateHostedPlan(plan: HostedPlan, providerId: string): ProviderSpec {
  const { sha256, ...body } = plan;
  if (plan.version !== SUITE_VERSION || sha256 !== digest(body)) fail("plan-integrity-failed");
  if (!Array.isArray(plan.trials) || !plan.trials.length || plan.trials.length > 300
    || new Set(plan.trials.map(t => t.id)).size !== plan.trials.length
    || plan.trials.some(t => t.requestSha256 !== digest(t.request) || !Number.isFinite(t.after.estimatedRequestTokens) || t.after.estimatedRequestTokens < 0)) fail("invalid-trials");
  if (!Number.isSafeInteger(plan.repetitions) || plan.repetitions < 1 || plan.repetitions > 10
    || !Number.isSafeInteger(plan.maxCalls) || plan.maxCalls < plan.trials.length * plan.providers.length * plan.repetitions
    || !Number.isFinite(plan.maxEstimatedInputTokens)
    || plan.maxEstimatedInputTokens < plan.trials.reduce((n,t) => n + t.after.estimatedRequestTokens, 0) * plan.providers.length * plan.repetitions) fail("plan-budget-insufficient");
  if (new Set(plan.providers.map(p => p.id)).size !== plan.providers.length) fail("duplicate-provider");
  const spec = plan.providers.find(p => p.id === providerId);
  if (!spec || !["system-one", "reference"].includes(spec.kind)) fail("hosted-provider-required");
  const url = new URL(spec.endpoint);
  if (url.username || url.password || url.search || url.hash || url.protocol !== "https:") fail("unsafe-hosted-endpoint");
  if (spec.kind === "reference" && (spec.maxOutputTokens ?? 4096) !== 4096) fail("reference-output-cap-must-be-4096");
  return spec;
}

async function privateFile(path: string, flags: number) {
  const file = await open(path, flags | constants.O_NOFOLLOW, 0o600);
  const stat = await file.stat();
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) { await file.close(); fail("output-file-must-be-private-regular-file"); }
  return file;
}
async function lines<T>(path: string): Promise<T[]> {
  const file = await privateFile(path, constants.O_RDONLY);
  try {
    const text = await file.readFile("utf8");
    if (text && !text.endsWith("\n")) fail("incomplete-journal-requires-manual-review");
    return text.split("\n").filter(Boolean).map(line => JSON.parse(line) as T);
  } finally { await file.close(); }
}

/** Provider injection is solely for offline doubles. CLI always constructs the frozen configured provider. */
export async function runHostedPlan(options: {
  plan: HostedPlan; provider: BenchmarkProvider; out: string; concurrency: number; resume?: boolean;
  onReceipt?: (receipt: Receipt) => void;
}): Promise<Receipt[]> {
  const { plan, provider, concurrency } = options;
  const spec = validateHostedPlan(plan, provider.id);
  if (provider.model !== spec.model || provider.kind !== spec.kind) fail("provider-identity-mismatch");
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) fail("concurrency-must-be-1-to-3");
  const directory = resolve(options.out);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = join(directory, "hosted.lock");
  if (options.resume) {
    try {
      const old = JSON.parse(await readFile(lockPath, "utf8"));
      if (old.host !== hostname() || !Number.isSafeInteger(old.pid) || old.pid < 1) fail("unverifiable-existing-lock");
      try { process.kill(old.pid, 0); fail("runner-already-active"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
      await unlink(lockPath);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const lock = await privateFile(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL);
  let receiptFile: Awaited<ReturnType<typeof privateFile>> | undefined;
  let dispatchFile: Awaited<ReturnType<typeof privateFile>> | undefined;
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, host: hostname() })); await lock.sync();
    const receiptPath = join(directory, "receipts.jsonl"), dispatchPath = join(directory, "dispatches.jsonl"), metaPath = join(directory, "hosted-run.json");
    let saved: Receipt[] = [], dispatched: Dispatch[] = [];
    if (options.resume) {
      const meta = JSON.parse(await readFile(metaPath, "utf8"));
      if (meta.planSha256 !== plan.sha256 || meta.providerId !== provider.id || meta.concurrency !== concurrency) fail("resume-run-mismatch");
      saved = await lines<Receipt>(receiptPath); dispatched = await lines<Dispatch>(dispatchPath);
    } else {
      const meta = await privateFile(metaPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL);
      try {
        await meta.writeFile(JSON.stringify({ planSha256: plan.sha256, providerId: provider.id, concurrency,
          startedAt: new Date().toISOString(), timeoutMs: spec.kind === "reference" ? 180_000 : 120_000,
          maxOutputTokens: spec.kind === "reference" ? 4096 : null, responseRetries: 0,
          note: "Concurrent hosted sweep. Latencies are request durations; their sum is not elapsed sweep throughput. Interrupted dispatched requests are not repeated; unknown elapsed time is recorded as zero and must not be treated as measured latency." }, null, 2)); await meta.sync();
      } finally { await meta.close(); }
    }
    const schedule = new Map<string, { trial: Trial; repetition: number }>();
    for (let repetition = 0; repetition < plan.repetitions; repetition++) for (const trial of plan.trials) schedule.set(key({ trialId: trial.id, repetition }), { trial, repetition });
    const seen = new Set<string>(), starts = new Set<string>();
    for (const row of dispatched) {
      const job = schedule.get(key(row));
      if (!job || row.requestSha256 !== job.trial.requestSha256 || starts.has(key(row)) || !Number.isFinite(Date.parse(row.startedAt))) fail("invalid-dispatch-journal");
      starts.add(key(row));
    }
    for (const row of saved) {
      const job = schedule.get(key(row));
      if (!job || !starts.has(key(row)) || seen.has(key(row)) || row.version !== 1
        || row.providerId !== provider.id || row.providerKind !== provider.kind || row.requestedModel !== provider.model
        || row.requestSha256 !== job.trial.requestSha256 || !Number.isFinite(row.outcome.latencyMs) || row.outcome.latencyMs < 0
        || !((row.status === "completed" && row.outcome.status === "ok") || (row.status === "provider-error" && row.outcome.status === "error"))) fail("invalid-resume-receipt");
      if (row.outcome.status === "ok" && (row.outcome.returnedModel !== spec.expectedModel
        || Object.keys(row.outcome.answers).length !== Object.keys(job.trial.request.questions).length
        || Object.keys(job.trial.request.questions).some(q => !Object.hasOwn(row.outcome.status === "ok" ? row.outcome.answers : {}, q)))) fail("invalid-resume-answers");
      seen.add(key(row));
    }
    const flags = constants.O_WRONLY | constants.O_APPEND | (options.resume ? 0 : constants.O_CREAT | constants.O_EXCL);
    receiptFile = await privateFile(receiptPath, flags); dispatchFile = await privateFile(dispatchPath, flags);
    let writes = Promise.resolve();
    const append = (file: NonNullable<typeof receiptFile>, row: unknown) => {
      const task = writes.then(async () => { await file.writeFile(JSON.stringify(row) + "\n"); await file.sync(); });
      writes = task; return task;
    };
    const record = async (trial: Trial, repetition: number, outcome: ProviderResult) => {
      const row: Receipt = { version: 1, trialId: trial.id, providerId: provider.id, providerKind: provider.kind,
        requestedModel: provider.model, requestSha256: trial.requestSha256, repetition, outcome,
        status: outcome.status === "ok" ? "completed" : "provider-error" };
      await append(receiptFile!, row); saved.push(row); options.onReceipt?.(row);
    };
    for (const [id, job] of schedule) if (starts.has(id) && !seen.has(id)) {
      await record(job.trial, job.repetition, { status: "error", error: "interrupted-dispatch-outcome-unknown", latencyMs: 0 });
    }
    const pending = [...schedule].filter(([id]) => !starts.has(id)).map(([, job]) => job);
    let next = 0;
    const workers = Array.from({ length: concurrency }, async () => {
      while (next < pending.length) {
        const job = pending[next++]!;
        await append(dispatchFile!, { trialId: job.trial.id, repetition: job.repetition, requestSha256: job.trial.requestSha256, startedAt: new Date().toISOString() } satisfies Dispatch);
        const start = performance.now();
        let outcome: ProviderResult;
        try { outcome = await provider.evaluate(job.trial.request); }
        catch { outcome = { status: "error", error: "provider-threw", latencyMs: performance.now() - start }; }
        await record(job.trial, job.repetition, outcome);
      }
    });
    const results = await Promise.allSettled(workers);
    if (results.some(result => result.status === "rejected")) fail("receipt-persistence-failed");
    return saved;
  } finally {
    await receiptFile?.close(); await dispatchFile?.close(); await lock.close(); await unlink(lockPath);
  }
}

async function main() {
  const { values: args } = parseArgs({ options: { plan: { type: "string" }, out: { type: "string" }, provider: { type: "string" }, concurrency: { type: "string", default: "1" }, execute: { type: "boolean", default: false }, resume: { type: "boolean", default: false } }, strict: true });
  if (!args.execute || !args.plan || !args.out || !args.provider) fail("requires-plan-out-provider-and-execute");
  const plan = JSON.parse(await readFile(args.plan, "utf8")) as HostedPlan;
  const spec = validateHostedPlan(plan, args.provider);
  const credential = await loadCredential({ env: spec.keyEnv, file: spec.keyFile });
  if ((spec.keyEnv || spec.keyFile || spec.kind === "reference") && !credential) fail("missing-provider-credential");
  const provider = spec.kind === "reference"
    ? createReferenceProvider({ ...spec, key: credential ?? "", maxOutputTokens: 4096, timeoutMs: 180_000 })
    : createSystemOneProvider({ ...spec, key: credential, timeoutMs: 120_000,
      ...(spec.headRevision && spec.encoderRevision ? { revisionManifest: { headRevision: spec.headRevision, encoderRevision: spec.encoderRevision } } : {}) });
  const receipts = await runHostedPlan({ plan, provider, out: args.out, concurrency: Number(args.concurrency), resume: args.resume,
    onReceipt: row => console.log(JSON.stringify({ trialId: row.trialId, providerId: row.providerId, status: row.status, latencyMs: row.outcome.latencyMs })) });
  console.log(JSON.stringify({ providerId: provider.id, receipts: receipts.length, completed: receipts.filter(r => r.status === "completed").length }));
}
if (import.meta.main) main().catch(() => { console.error("hosted-run-failed; inspect private local journals before resuming"); process.exitCode = 1; });

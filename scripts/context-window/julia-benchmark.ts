#!/usr/bin/env bun
/** One CPU sweep of the shipped Julia runtime, with every frozen question retained. */
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { cpus, totalmem } from "node:os";
import { digest, type Trial } from "./cases.js";
import type { Receipt } from "./benchmark.js";
import type { BenchmarkAnswer } from "./providers.js";
import { juliaModelId, JULIA_ARTIFACTS, JULIA_REVISION } from "../../shared/julia/manifest.js";
import { juliaQuestionOptions } from "../../shared/julia/scorer.js";
import { JULIA_ENCODER_VERSION, type JuliaDecisionRequest } from "../../shared/julia/encoder.js";

const [planArg, outputArg, modelArg] = process.argv.slice(2);
if (!planArg || !outputArg || !modelArg) throw Error("Usage: bun scripts/context-window/julia-benchmark.ts frozen-plan output-directory verified-model-directory");
const original = JSON.parse(await readFile(planArg, "utf8"));
const { sha256: parentPlanSha256, ...body } = original;
if (digest(body) !== parentPlanSha256) throw Error("frozen-plan-integrity-failed");
const trials: Trial[] = original.trials;
const questionCount = trials.reduce((n, trial) => n + Object.keys(trial.request.questions).length, 0);
const labelledCount = trials.reduce((n, trial) => n + Object.keys(trial.expected).length, 0);
if (trials.length !== 300 || questionCount !== 9132 || labelledCount !== 972 || original.repetitions !== 1) throw Error("unexpected-frozen-schedule");
for (const trial of trials) if (trial.requestSha256 !== digest(trial.request)) throw Error("frozen-request-integrity-failed");
const benchmarkModelId = juliaModelId("native", 8192, 512, 4);
const provider = { id: "julia-1-onnx-cpu", kind: "system-one", model: benchmarkModelId, expectedModel: benchmarkModelId,
  nativeProvenance: { revision: JULIA_REVISION, encoderVersion: JULIA_ENCODER_VERSION, dtype: "FP32", backend: "onnxruntime-node CPU", threads: 4, inferenceMicrobatch: 8, maxLength: 8192, headLength: 512, artifacts: JULIA_ARTIFACTS } };
const planBody = { ...body, parentPlanSha256, providers: [...original.providers, provider] };
const plan = { ...planBody, sha256: digest(planBody) };
const output = resolve(outputArg);
await mkdir(output, { recursive: true });
const planPath = join(output, "plan.json"), tapePath = join(output, "receipts.jsonl");
try { if ((JSON.parse(await readFile(planPath, "utf8"))).sha256 !== plan.sha256) throw Error("resume-plan-mismatch"); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; await writeFile(planPath, JSON.stringify(plan, null, 2), { flag: "wx", mode: 0o600 }); }
const goldFree = { parentPlanSha256, trials: trials.map(({ id, requestSha256, request }) => ({ id, requestSha256, request })) };
try { await writeFile(join(output, "gold-free-input.json"), JSON.stringify(goldFree), { flag: "wx", mode: 0o600 }); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
const run = { parentPlanSha256, comparisonPlanSha256: plan.sha256, provider, startedAt: new Date().toISOString(),
  runnerSha256: createHash("sha256").update(await readFile(import.meta.filename)).digest("hex"),
  cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalMemoryBytes: totalmem(), runtime: process.versions.bun ? `Bun ${process.versions.bun}` : `Node ${process.version}`,
  boundaries: ["Full FP32 ONNX weights; no quantization, hosted inference, or paid GPU.",
    "Shipped strict Rust-compatible encoder uses compact sorted evidence JSON; original Python serializer differs. No original-Python prediction parity is claimed.",
    "Nullable Choice criterion defaults to the existing candidate key, matching Keating's null-description contract. No candidate descriptions are invented.",
    "8192 total tokens and 512 head tokens are predeclared benchmark-only budgets; the packaged runtime has a conservative 2048-token default.",
    "Raw normalized probabilities retain full JavaScript numeric precision. No display rounding or threshold fitting."] };
await writeFile(join(output, "run.json"), JSON.stringify(run, null, 2), { mode: 0o600 });
let saved: Receipt[] = [];
try { saved = (await readFile(tapePath, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line)); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
const completed = new Set<string>();
for (const receipt of saved) {
  const trial = trials.find(trial => trial.id === receipt.trialId);
  if (!trial || receipt.providerId !== provider.id || receipt.requestedModel !== benchmarkModelId || receipt.repetition !== 0
    || receipt.requestSha256 !== trial.requestSha256 || completed.has(trial.id)) throw Error("unexpected-resume-receipt");
  completed.add(trial.id);
}
const { JuliaNativeRuntime } = await import("../../shared/julia/native.js");
const runtime = new JuliaNativeRuntime({ directory: resolve(modelArg), maxLength: 8192, headLength: 512, threads: 4 });
try {
  await runtime.download();
  for (const trial of trials) {
    if (completed.has(trial.id)) continue;
    const start = performance.now();
    let outcome: Receipt["outcome"];
    try {
      const entries = Object.entries(trial.request.questions);
      const labels = entries.map(([, question]) => question.type === "noul" ? ["false", "true"]
        : question.type === "choice" ? Object.keys(question.criteria) : question.criteria.map((_, index) => String(index)));
      const rows: JuliaDecisionRequest[] = entries.map(([, question], index) => ({ state: trial.request.state,
        question: question.instructions, type: question.type, options: juliaQuestionOptions(question, labels[index]!) }));
      const encoded = [];
      for (let offset = 0; offset < rows.length; offset += 32) encoded.push(...await runtime.encode(rows.slice(offset, offset + 32)));
      if (encoded.length !== entries.length) throw Error("context-proof-row-count-mismatch");
      const contextProof = { fullContext: true, encoderVersion: JULIA_ENCODER_VERSION, maxLength: 8192, headLength: 512,
        questions: encoded.map((row, index) => ({ question: entries[index]![0], encodedTokens: row.ids.length,
          optionCount: row.markers.length, encodedSha256: digest(row), strictEncoding: true })) };
      const weights: number[][] = [];
      for (let offset = 0; offset < rows.length; offset += 8) weights.push(...await runtime.weights(rows.slice(offset, offset + 8)));
      if (weights.length !== entries.length) throw Error("inference-row-count-mismatch");
      const answers: Record<string, BenchmarkAnswer> = {};
      const raw: Record<string, unknown> = {};
      for (const [index, [key, question]] of entries.entries()) {
        const values = weights[index]!, keys = labels[index]!;
        if (values.length !== keys.length || values.some(value => !Number.isFinite(value) || value < 0 || value > 1)
          || Math.abs(values.reduce((n, value) => n + value, 0) - 1) > 1e-6) throw Error("invalid-probability-distribution");
        const modal = values.reduce((best, value, current) => value > values[best]! ? current : best, 0);
        const probabilities = Object.fromEntries(keys.map((label, i) => [label, values[i]!]));
        const value = question.type === "noul" ? values[1]! <= 0.2 ? false : values[1]! >= 0.8 ? true : null
          : question.type === "score" ? modal : keys[modal]!;
        answers[key] = { value, probabilities, confidence: null };
        raw[key] = { type: question.type, probabilities,
          ...(question.type === "noul" ? { noul: values[1] } : question.type === "score"
            ? { score: values.reduce((n, probability, level) => n + probability * level, 0) } : { choice: keys[modal] }),
          maxProbability: Math.max(...values) };
      }
      outcome = { status: "ok", returnedModel: benchmarkModelId, answers, usage: null,
        latencyMs: performance.now() - start, raw: { model: benchmarkModelId, answers: raw, contextProof, provenance: provider.nativeProvenance } };
    } catch (error) {
      outcome = { status: "error", error: error instanceof Error ? error.message : String(error), latencyMs: performance.now() - start };
    }
    const receipt: Receipt = { version: 1, trialId: trial.id, providerId: provider.id, providerKind: "system-one",
      requestedModel: benchmarkModelId, requestSha256: trial.requestSha256, repetition: 0,
      status: outcome.status === "ok" ? "completed" : "provider-error", outcome };
    await appendFile(tapePath, JSON.stringify(receipt) + "\n", { mode: 0o600 });
    completed.add(trial.id);
    console.log(JSON.stringify({ completed: completed.size, planned: trials.length, trial: trial.id, status: outcome.status, latencyMs: outcome.latencyMs,
      ...(outcome.status === "error" ? { error: outcome.error } : {}) }));
  }
} finally { await runtime.unload(); }
await writeFile(join(output, "completion.json"), JSON.stringify({ completedAt: new Date().toISOString(), parentPlanSha256,
  comparisonPlanSha256: plan.sha256, plannedTrials: trials.length, plannedQuestions: questionCount, plannedLabels: labelledCount, savedReceipts: completed.size }, null, 2), { mode: 0o600 });

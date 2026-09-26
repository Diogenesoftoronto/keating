#!/usr/bin/env bun
/** Descriptive timings from saved receipts; no inference, no saturation or cold-start claim. */
import { readFile, writeFile } from "node:fs/promises";
import { digest } from "./cases.js";
import { completeSchedule, type Receipt } from "./benchmark.js";

const [planPath, tapePath, output] = process.argv.slice(2);
if (!planPath || !tapePath || !output) throw Error("requires plan tape output");
const plan = JSON.parse(await readFile(planPath, "utf8"));
const { sha256, ...body } = plan;
if (sha256 !== digest(body)) throw Error("plan-integrity-failed");
const tape: Receipt[] = (await readFile(tapePath, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
const rows = completeSchedule(plan.trials, plan.providers, plan.repetitions, tape);
const quantile = (values: number[], q: number) => values.length ? [...values].sort((a,b) => a-b)[Math.max(0,Math.ceil(q * values.length)-1)]! : null;
function metrics(selected: Receipt[]) {
  const successful = selected.filter(r => r.outcome.status === "ok");
  const times = successful.map(r => r.outcome.latencyMs);
  const totalMs = selected.filter(r => r.status !== "not-dispatched").reduce((n,r) => n + r.outcome.latencyMs, 0);
  const questions = successful.reduce((n,r) => n + (r.outcome.status === "ok" ? Object.keys(r.outcome.answers).length : 0), 0);
  const forwardTimes = successful.flatMap(r => {
    const value = r.outcome.status === "ok" ? (r.outcome.raw as { latency_ms?: number })?.latency_ms : undefined;
    return typeof value === "number" && Number.isFinite(value) ? [value] : [];
  });
  return { plannedRequests: selected.length, completedRequests: successful.length, completedQuestions: questions,
    p50BatchMs: times.length ? (quantile(times,.5)! + quantile(times, times.length % 2 ? .5 : .5 + 1/times.length)!) / 2 : null,
    p95BatchMs: quantile(times,.95), minBatchMs: times.length ? Math.min(...times) : null, maxBatchMs: times.length ? Math.max(...times) : null,
    totalAttemptMs: totalMs, averageQuestionsPerCompletedBatch: successful.length ? questions / successful.length : null,
    serialQuestionsPerSecond: totalMs ? questions / (totalMs / 1000) : null,
    serialBatchesPerSecond: totalMs ? successful.length / (totalMs / 1000) : null,
    nativeForwardP50Ms: forwardTimes.length && forwardTimes.length === successful.length
      ? (quantile(forwardTimes,.5)! + quantile(forwardTimes, forwardTimes.length % 2 ? .5 : .5 + 1/forwardTimes.length)!) / 2 : null,
    nativeForwardP95Ms: forwardTimes.length === successful.length ? quantile(forwardTimes,.95) : null,
    usageReportedRequests: successful.filter(r => r.outcome.status === "ok" && r.outcome.usage !== null).length,
  };
}
const result = { parentPlanSha256: sha256, notes: [
  "Batch timings include each transport/harness boundary: Kev/Laya local CUDA plus context preflight; Jev/Astra/CLM remote HTTP. These are not equal deployment paths.",
  "Median and nearest-rank p95 use successful batch requests. Serial throughput divides all completed questions (including unlabelled ones) by time of all attempted requests, including failures.",
  "Model download/load and idle/setup time are excluded. First inference remains included; there was no excluded warm-up call. This is one serial sweep, not maximum or concurrency throughput.",
  "Question-count and tokenizer differences make native input token totals unsuitable for a cross-model tokens-per-second ranking. Peak memory and cold-start latency were not instrumented.",
], models: Object.fromEntries(plan.providers.map((p: any) => [p.id, {
  executionBoundary: p.id.startsWith("kev-") || p.id.startsWith("laya-") ? "local-cuda-harness" : "remote-http",
  ...metrics(rows.filter(r => r.providerId === p.id)),
  stages: Object.fromEntries(["planning","adherence","grading"].map(stage => [stage, metrics(rows.filter(r => r.providerId === p.id && plan.trials.find((t: any) => t.id === r.trialId)?.stage === stage))])),
}])) };
await writeFile(output, JSON.stringify(result,null,2), { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ output, models: plan.providers.length, modelCalls: 0 }));

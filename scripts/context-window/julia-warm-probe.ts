#!/usr/bin/env bun
/** Independent warm single-decision measurements; never overwrite the sweep. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { cpus } from "node:os";
import { JuliaNativeRuntime } from "../../shared/julia/native.js";
import { juliaQuestionOptions } from "../../shared/julia/scorer.js";
import { digest } from "./cases.js";

const [benchmarkArg, modelArg, outputArg] = process.argv.slice(2);
if (!benchmarkArg || !modelArg || !outputArg || process.versions.bun) throw Error("Run the Node-bundled probe with benchmark-directory verified-weights-directory new-output-directory.");
const directory = resolve(benchmarkArg), output = resolve(outputArg);
await mkdir(output, { recursive: true });
const inputs = JSON.parse(await readFile(join(directory, "gold-free-input.json"), "utf8"));
const tape = (await readFile(join(directory, "receipts.jsonl"), "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line));
const proofs = tape.flatMap(row => row.outcome.raw.contextProof.questions.map((proof: any) => ({ trialId: row.trialId, ...proof })));
proofs.sort((a, b) => a.encodedTokens - b.encodedTokens);
const choices = [{ name: "short", proof: proofs[0]! }, { name: "long", proof: proofs.at(-1)! }].map(({ name, proof }) => {
  const trial = inputs.trials.find((trial: any) => trial.id === proof.trialId), question = trial.request.questions[proof.question];
  const labels: string[] = question.type === "noul" ? ["false", "true"] : question.type === "choice" ? Object.keys(question.criteria) : question.criteria.map((_: unknown, index: number) => String(index));
  return { name, trialId: trial.id, requestSha256: trial.requestSha256, questionId: proof.question, labels, proof,
    row: { state: trial.request.state, question: question.instructions, type: question.type, options: juliaQuestionOptions(question, labels) } };
});
const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b), total = values.reduce((sum, value) => sum + value, 0);
  return { repetitions: values.length, totalMs: total, meanMs: total / values.length, medianMs: (sorted[9]! + sorted[10]!) / 2,
    p90Ms: sorted[17], p95Ms: sorted[18], p99Ms: sorted[19], minMs: sorted[0], maxMs: sorted[19] };
};
const runtime = new JuliaNativeRuntime({ directory: resolve(modelArg), maxLength: 2048, headLength: 512, threads: 4 });
const startedAt = new Date().toISOString(), start = performance.now();
const verificationStart = performance.now(); await runtime.download(); const installVerificationMs = performance.now() - verificationStart;
const coldStart = performance.now(); const coldEncoded = await runtime.encode([choices[0]!.row]); const coldEncodeAndLoadMs = performance.now() - coldStart;
if (digest(coldEncoded[0]) !== choices[0]!.proof.encodedSha256) throw Error("packaged-context-proof-mismatch");
const cases = [];
try {
  for (const choice of choices) {
    const encodingMs: number[] = [], scoringMs: number[] = [], probabilities: number[][] = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now(), encoded = await runtime.encode([choice.row]); encodingMs.push(performance.now() - start);
      if (digest(encoded[0]) !== choice.proof.encodedSha256) throw Error("probe-encoding-drift");
    }
    const warmupStart = performance.now(); await runtime.weights([choice.row]); const firstScoringWarmupMs = performance.now() - warmupStart;
    for (let i = 0; i < 20; i++) {
      const start = performance.now(), values = await runtime.weights([choice.row]); scoringMs.push(performance.now() - start); probabilities.push(values[0]!);
    }
    cases.push({ name: choice.name, trialId: choice.trialId, requestSha256: choice.requestSha256, questionId: choice.questionId,
      row: choice.row, labels: choice.labels, encodedTokens: choice.proof.encodedTokens, encodedSha256: choice.proof.encodedSha256,
      firstScoringWarmupMs, encoding: stats(encodingMs), scoring: stats(scoringMs), encodingMs, scoringMs, probabilities });
  }
} finally { await runtime.unload(); }
const result = { modelId: runtime.modelId, startedAt, completedAt: new Date().toISOString(), totalElapsedMs: performance.now() - start,
  cpu: cpus()[0]?.model, threads: 4, maxLength: 2048, headLength: 512, batchSize: 1, repetitionsPerCase: 20,
  selection: "Shortest and longest encoded questions in the frozen gold-free input; no label or outcome-based selection",
  runnerSha256: createHash("sha256").update(await readFile(import.meta.filename)).digest("hex"),
  installVerificationMs, coldEncodeAndLoadMs, maxRssKiB: process.resourceUsage().maxRSS, cases,
  boundaries: ["Separate warm probe after original Python control; root builds intentionally idle. Not an isolated OS/hardware benchmark.",
    "Cold encode includes graph/tokenizer loading and encoding. Public API does not expose an isolated load timer.",
    "Scoring includes the runtime's mandatory re-encoding and inference; encoding-only is measured separately without subtracting estimates.",
    "Peak RSS is the actual complete Node process, including tokenizer, ONNX session and harness, not model-only memory.",
    "The 300-request sweep also overlapped repository builds, graph indexing, briefly Android compilation and browser work; those timings include contention."] };
await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2), { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ modelId: result.modelId, coldEncodeAndLoadMs, maxRssKiB: result.maxRssKiB,
  cases: cases.map(row => ({ name: row.name, encodedTokens: row.encodedTokens, encoding: row.encoding, scoring: row.scoring })) }));

#!/usr/bin/env bun
/** Validate an already completed frozen CPU tape without calling a model. */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { digest } from "./cases.js";

const [originalPath, directory, output] = process.argv.slice(2);
if (!originalPath || !directory || !output) throw Error("Usage: bun scripts/context-window/julia-audit.ts original-plan julia-directory audit-json");
const read = async (name: string) => JSON.parse(await readFile(join(directory, name), "utf8"));
const original = JSON.parse(await readFile(originalPath, "utf8"));
const { sha256, ...originalBody } = original;
if (sha256 !== "53857b3ea5f8dc97d3a32c7542419a806923db3a689b28a23f4fb2947b479c37" || digest(originalBody) !== sha256) throw Error("frozen-plan-mismatch");
const plan = await read("plan.json"), { sha256: comparisonSha256, ...comparisonBody } = plan;
if (digest(comparisonBody) !== comparisonSha256 || plan.parentPlanSha256 !== sha256 || digest(plan.trials) !== digest(original.trials)) throw Error("comparison-plan-mismatch");
const goldFree = await read("gold-free-input.json");
if (goldFree.parentPlanSha256 !== sha256 || digest(goldFree.trials) !== digest(original.trials.map(({ id, requestSha256, request }: any) => ({ id, requestSha256, request })))) throw Error("gold-free-input-mismatch");
const run = await read("run.json"), completion = await read("completion.json");
const runnerHash = createHash("sha256").update(await readFile(join(directory, "runner.mjs"))).digest("hex");
if (run.runnerSha256 !== runnerHash || run.parentPlanSha256 !== sha256 || run.comparisonPlanSha256 !== comparisonSha256
  || completion.parentPlanSha256 !== sha256 || completion.comparisonPlanSha256 !== comparisonSha256) throw Error("execution-provenance-mismatch");
const tapeText = await readFile(join(directory, "receipts.jsonl"), "utf8");
const rows = tapeText.split("\n").filter(Boolean).map(line => JSON.parse(line));
if (rows.length !== 300 || completion.savedReceipts !== 300) throw Error("incomplete-schedule");
const seen = new Set<string>(), languages: Record<string, number> = {};
let successful = 0, failed = 0, questions = 0, largestEncoded = 0, largestSumError = 0;
for (const row of rows) {
  const trial = original.trials.find((trial: any) => trial.id === row.trialId);
  if (!trial || seen.has(row.trialId) || row.providerId !== "julia-1-onnx-cpu" || row.requestedModel !== run.provider.model
    || row.requestSha256 !== trial.requestSha256 || row.repetition !== 0) throw Error("receipt-identity-mismatch");
  seen.add(row.trialId); languages[trial.language] = (languages[trial.language] ?? 0) + 1;
  if (row.outcome.status === "error") { failed++; continue; }
  if (row.outcome.status !== "ok" || row.outcome.returnedModel !== run.provider.model) throw Error("unexpected-outcome");
  successful++;
  const { answers, raw } = row.outcome;
  const proof = raw.contextProof;
  if (digest(raw.provenance) !== digest(run.provider.nativeProvenance) || proof.fullContext !== true || proof.maxLength !== 8192
    || proof.headLength !== 512 || proof.questions.length !== Object.keys(trial.request.questions).length
    || Object.keys(answers).length !== proof.questions.length) throw Error("context-proof-mismatch");
  for (const [key, question] of Object.entries(trial.request.questions) as [string, any][]) {
    const answer = answers[key], proofRow = proof.questions.find((item: any) => item.question === key);
    const labels: string[] = question.type === "noul" ? ["false", "true"] : question.type === "choice" ? Object.keys(question.criteria) : question.criteria.map((_: unknown, index: number) => String(index));
    if (!answer || !proofRow || !proofRow.strictEncoding || proofRow.encodedTokens < 1 || proofRow.encodedTokens > 8192
      || proofRow.optionCount !== labels.length || !/^[a-f0-9]{64}$/.test(proofRow.encodedSha256)
      || digest(Object.keys(answer.probabilities)) !== digest(labels)) throw Error("question-proof-mismatch");
    const probabilities: number[] = labels.map(label => answer.probabilities[label]);
    if (probabilities.some(value => !Number.isFinite(value) || value < 0 || value > 1)) throw Error("invalid-probability");
    const sumError = Math.abs(probabilities.reduce((sum, value) => sum + value, 0) - 1);
    if (sumError > 1e-6 || digest(answer.probabilities) !== digest(raw.answers[key].probabilities)) throw Error("probability-provenance-mismatch");
    const modal = probabilities.reduce((best, value, index) => value > probabilities[best]! ? index : best, 0);
    const decoded = question.type === "noul" ? probabilities[1]! <= 0.2 ? false : probabilities[1]! >= 0.8 ? true : null : question.type === "score" ? modal : labels[modal];
    if (answer.value !== decoded) throw Error("decision-policy-mismatch");
    largestSumError = Math.max(largestSumError, sumError); largestEncoded = Math.max(largestEncoded, proofRow.encodedTokens); questions++;
  }
}
if (Object.keys(languages).length !== 6 || Object.values(languages).some(count => count !== 50)) throw Error("language-schedule-mismatch");
const audit = { originalPlanSha256: sha256, comparisonPlanSha256: comparisonSha256, runnerSha256: runnerHash,
  receiptsSha256: createHash("sha256").update(tapeText).digest("hex"), plannedTrials: 300, successful, failed, successfulQuestions: questions,
  languages, largestEncodedTokens: largestEncoded, largestProbabilitySumError: largestSumError,
  checks: ["Frozen labels, criteria, states and question hashes retained exactly", "Gold-free inference input retained exactly", "Executed bundle hash retained",
    "No duplicate or missing planned receipts", "Every successful output has strict full-context proof and exact option count",
    "Every raw probability is finite, normalized and retained without display rounding", "Uniform strict Noul and modal Choice/Score decoding"],
  boundary: "Validates saved execution evidence; does not rerun inference or independently reconstruct encoder IDs." };
await writeFile(output, JSON.stringify(audit, null, 2), { flag: "wx", mode: 0o600 });
console.log(JSON.stringify(audit));

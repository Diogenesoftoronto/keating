#!/usr/bin/env bun
/** Reconstruct saved context proofs and check packaged budgets; no inference. */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { digest, type Trial } from "./cases.js";
import { createJuliaEncoder, JULIA_ENCODER_VERSION } from "../../shared/julia/encoder.js";
import { juliaQuestionOptions } from "../../shared/julia/scorer.js";
import { JULIA_ARTIFACTS } from "../../shared/julia/manifest.js";

const [planPath, tapeDirectory, modelDirectory, outputPath] = process.argv.slice(2);
if (!planPath || !tapeDirectory || !modelDirectory || !outputPath) throw Error("Usage: bun scripts/context-window/julia-context-audit.ts original-plan julia-directory verified-weights-directory audit-json");
const plan = JSON.parse(await readFile(planPath, "utf8")), { sha256, ...body } = plan;
if (sha256 !== "53857b3ea5f8dc97d3a32c7542419a806923db3a689b28a23f4fb2947b479c37" || digest(body) !== sha256) throw Error("frozen-plan-mismatch");
const tokenizerData: Record<string, unknown> = {};
for (const file of ["tokenizer.json", "tokenizer_config.json"]) {
  const data = await readFile(join(modelDirectory, file)), artifact = JULIA_ARTIFACTS.find(artifact => artifact.file === file)!;
  if (data.length !== artifact.bytes || createHash("sha256").update(data).digest("hex") !== artifact.sha256) throw Error("tokenizer-integrity-mismatch");
  tokenizerData[file] = JSON.parse(data.toString("utf8"));
}
const encoder = createJuliaEncoder(tokenizerData["tokenizer.json"], tokenizerData["tokenizer_config.json"]);
const rows = (await readFile(join(tapeDirectory, "receipts.jsonl"), "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line));
if (rows.length !== 300 || new Set(rows.map(row => row.trialId)).size !== 300) throw Error("incomplete-or-duplicate-schedule");
const lookup = new Map(rows.map(row => [row.trialId, row]));
const configurations = [{ name: "benchmark", maxLength: 8192, headLength: 512 }, { name: "desktop-browser", maxLength: 2048, headLength: 512 }, { name: "phone", maxLength: 1024, headLength: 256 }];
const results = Object.fromEntries(configurations.map(config => [config.name, { ...config, encoded: 0, rejected: 0, identicalToBenchmark: 0, errors: [] as { trialId: string; question: string; error: string }[] }]));
let reconstructedSavedProofs = 0, largestEncodedTokens = 0;
for (const trial of plan.trials as Trial[]) {
  const receipt = lookup.get(trial.id);
  if (!receipt || receipt.requestSha256 !== trial.requestSha256) throw Error("request-hash-mismatch");
  for (const [key, question] of Object.entries(trial.request.questions)) {
    const labels = question.type === "noul" ? ["false", "true"] : question.type === "choice" ? Object.keys(question.criteria) : question.criteria.map((_, index) => String(index));
    const input = { state: trial.request.state, question: question.instructions, type: question.type, options: juliaQuestionOptions(question, labels) };
    const encoded = encoder.encode(input, configurations[0]!);
    const encodedSha256 = digest(encoded);
    largestEncodedTokens = Math.max(largestEncodedTokens, encoded.ids.length);
    if (receipt.outcome.status === "ok") {
      const proof = receipt.outcome.raw.contextProof.questions.find((proof: any) => proof.question === key);
      if (!proof || proof.encodedSha256 !== encodedSha256 || proof.encodedTokens !== encoded.ids.length || proof.optionCount !== encoded.markers.length) throw Error("saved-context-proof-mismatch");
      reconstructedSavedProofs++;
    }
    for (const config of configurations) {
      const result = results[config.name]!;
      try {
        const actual = config.name === "benchmark" ? encoded : encoder.encode(input, config);
        result.encoded++; result.identicalToBenchmark += Number(digest(actual) === encodedSha256);
      } catch (error) {
        result.rejected++; result.errors.push({ trialId: trial.id, question: key, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
}
const audit = { originalPlanSha256: sha256, encoderVersion: JULIA_ENCODER_VERSION, reconstructedSavedProofs, largestEncodedTokens, configurations: results,
  boundary: "Pure tokenizer/strict-encoding reconstruction. No inference was rerun; does not establish Android/iOS/WebAssembly predictions, latency or memory use." };
await writeFile(outputPath, JSON.stringify(audit, null, 2), { flag: "wx", mode: 0o600 });
console.log(JSON.stringify(audit));

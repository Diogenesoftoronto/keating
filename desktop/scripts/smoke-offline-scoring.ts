/**
 * Build with Bun targeting Node, then execute with Node (the Electron runtime).
 * No model download, network inference or learner activation occurs here.
 * bun build desktop/scripts/smoke-offline-scoring.ts --target=node --outfile=/tmp/keating-scoring-smoke.mjs
 * node /tmp/keating-scoring-smoke.mjs /absolute/model.litertlm /absolute/keating-offline
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { OfflineRuntime } from "../src/offline-runtime.js";
import { OFFLINE_JUDGEMENT_MODEL_ID } from "../src/offline-contract.js";
import { createDesktopLocalLabelScorer } from "../../web/src/keating/judgement/local-scorer";
import { createLocalJudgementCaller } from "../../packages/learner-contracts/src/judgement/local-backend.js";
import type { JudgementRequest } from "../../packages/learner-contracts/src/judgement/contracts.js";

const [modelPath, executablePath] = process.argv.slice(2);
if (!modelPath || !executablePath) throw new Error("Pass model.litertlm and the built keating-offline helper.");
const directory = await mkdtemp(join(tmpdir(), "keating-native-scoring-smoke-"));
const runtime = new OfflineRuntime({ directory, executable: resolve(executablePath), bundledModel: resolve(modelPath) });
try {
  const status = await runtime.status();
  if (!status.available || !status.installed) throw new Error("Verified model/runtime unavailable.");
  const call = createLocalJudgementCaller({
    model: OFFLINE_JUDGEMENT_MODEL_ID,
    scoreLabels: createDesktopLocalLabelScorer({ modelId: OFFLINE_JUDGEMENT_MODEL_ID, bridge: runtime }),
  });
  const request: JudgementRequest = {
    state: { problem: "What is 2 + 2?", learnerAnswer: "4", expectedAnswer: "4" },
    questions: {
      correct: { type: "noul", instructions: "Does learnerAnswer equal expectedAnswer?", criteria: { true: "The answers match.", false: "The answers differ." } },
      selection: { type: "choice", instructions: "Choose the criterion describing the learner answer.", criteria: { opaque_a: "The learner answer is incorrect.", opaque_b: "The learner answer is correct." } },
      level: { type: "score", instructions: "Rate correctness of the learner answer.", criteria: ["The learner answer is incorrect.", "The learner answer is correct."] },
    },
  };
  const started = performance.now();
  const outcome = await call(request);
  if (!outcome.ok) throw new Error(`Native judgement failed: ${outcome.error.code}`);
  const { answers } = outcome.response;
  if (answers.correct?.type !== "noul" || answers.correct.noul <= 0.5
    || answers.selection?.type !== "choice" || answers.selection.choice !== "opaque_b"
    || answers.level?.type !== "score" || answers.level.score <= 0.5) {
    throw new Error(`Native smoke expectation failed: ${JSON.stringify(answers)}`);
  }
  if (outcome.response.backend.calibrationSha256 !== null) throw new Error("Smoke must not claim calibration.");
  console.log(JSON.stringify({ ok: true, elapsedMs: Math.round(performance.now() - started), backend: outcome.response.backend, answers, proof: "actual CPU candidate likelihoods; smoke only, no calibration or efficacy claim" }, null, 2));
} finally {
  await runtime.stop();
  await rm(directory, { recursive: true, force: true });
}

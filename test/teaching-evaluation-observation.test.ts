import { afterEach, expect, test } from "bun:test";
import { createHash, webcrypto } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EpisodeRunner, SkillProposer, TeachingCase } from "../shared/evolution/contracts.js";
import { episodeCriterionQuestion } from "../shared/evolution/model-adapters.js";
import { questionDigest } from "../packages/learner-contracts/src/judgement/contracts.js";
import { teachingBenchmarkArtifact, teachingEvolutionArtifact } from "../src/core/teaching-evolution.js";
import { NOTORGANIC_AUTH_ENV } from "../src/core/notorganic-auth.js";
import type { CliEvolutionJudgementOptions } from "../src/judgement/cli-evolution.js";
import { setEvaluationObservationExporterForTests } from "../src/observability/arize.js";
import { EVALUATION_OBSERVATION_VERSION, type EvaluationObservationV1 } from "../src/observability/types.js";

const directories: string[] = [];
const envKeys = ["ARIZE_ENABLED", "ARIZE_API_KEY", "ARIZE_SPACE_ID", "ARIZE_OTLP_ENDPOINT", "ARIZE_PROJECT_NAME"] as const;
const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
afterEach(async () => {
  setEvaluationObservationExporterForTests();
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key];
  }
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const cases: TeachingCase[] = ["train", "validation", "holdout"].flatMap((split) => Array.from({ length: split === "train" ? 1 : 6 }, (_, index) => ({
  id: `${split}-${index}`, family: `${split}-family-${index}`, domain: "mathematics", split: split as TeachingCase["split"],
  messages: [{ role: "user", content: "PRIVATE_LEARNER_CONTENT" }],
  rubric: [{ id: "accurate", description: "Preserves accuracy.", critical: true }, { id: "check", description: "Checks reasoning.", critical: false }],
})));
const runner: EpisodeRunner = async ({ systemPrompt }) => ({
  messages: [{ role: "assistant", content: systemPrompt.includes("PRIVATE_REPAIR_PROMPT") ? "candidate PRIVATE_TUTOR_CONTENT" : "baseline PRIVATE_TUTOR_CONTENT" }],
  toolCalls: [], model: "unrelated-tutor-model", runtime: "fixture",
});
const proposer: SkillProposer = async ({ training }) => ({
  skill: { id: "repair", title: "Check reasoning", instructions: "PRIVATE_REPAIR_PROMPT: check independent reasoning.", hypothesis: "Independent checks improve teaching.", evidenceIds: [training.results[0]!.id] },
  hypothesis: { id: "hypothesis", statement: "Independent checks improve teaching.", evidenceIds: [training.results[0]!.id], status: "proposed" },
});

async function fixture(options: { calibrated?: boolean; uncertain?: boolean; regression?: boolean } = {}) {
  process.env.ARIZE_ENABLED = "true";
  process.env.ARIZE_API_KEY = "PRIVATE_ARIZE_KEY";
  process.env.ARIZE_SPACE_ID = "fixture";
  process.env.ARIZE_OTLP_ENDPOINT = "https://telemetry.example/v1/traces";
  process.env.ARIZE_PROJECT_NAME = "keating-test";
  const cwd = await mkdtemp(join(tmpdir(), "keating-evaluation-observation-")); directories.push(cwd);
  const key = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const now = 1_800_000_000_000;
  const env: Record<string, string> = { KEATING_EVOLUTION_JUDGE: "notorganic-exploratory", KEATING_JUDGEMENT_MODEL: "jev-receipt-concrete" };
  let calibration: string | undefined;
  if (options.calibrated) {
    const raw = JSON.stringify({ schemaVersion: 1, model: env.KEATING_JUDGEMENT_MODEL,
      questions: Object.fromEntries(cases[0]!.rubric.map((criterion) => [questionDigest(episodeCriterionQuestion(criterion)), { deferBelow: 0.5, actAtOrAbove: 0.9 }])) });
    calibration = createHash("sha256").update(raw).digest("hex");
    await writeFile(join(cwd, "calibration.json"), raw);
    Object.assign(env, { KEATING_EVOLUTION_JUDGE: "notorganic", KEATING_EVOLUTION_CALIBRATION_FILE: "calibration.json", KEATING_JUDGEMENT_CALIBRATION_SHA256: calibration });
  }
  const credential = { accessToken: "PRIVATE_ACCOUNT_TOKEN", env: {
    [NOTORGANIC_AUTH_ENV.issuer]: "https://account.example", [NOTORGANIC_AUTH_ENV.privateJwk]: JSON.stringify(await webcrypto.subtle.exportKey("jwk", key.privateKey)),
    [NOTORGANIC_AUTH_ENV.scope]: "infer:balanced judgement:evaluate", [NOTORGANIC_AUTH_ENV.tokenType]: "DPoP", [NOTORGANIC_AUTH_ENV.expiresAt]: String(now + 300_000),
  } };
  const judgement: CliEvolutionJudgementOptions = { env, transport: {
    now: () => now, loadCredential: () => credential,
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      const candidate = JSON.stringify(body.state).includes("candidate");
      const answers = Object.fromEntries(Object.entries(body.questions as Record<string, { type: string; criteria: Record<string, unknown> }>).map(([name, question]) => {
        if (question.type === "noul") return [name, { type: "noul", noul: options.uncertain ? 0.5 : (name.endsWith("accurate") ? !(candidate && options.regression) : candidate) ? 0.97 : 0.03 }];
        const keys = Object.keys(question.criteria);
        return [name, { type: "choice", choice: keys[0], confidence: 1, probabilities: Object.fromEntries(keys.map((key, index) => [key, index === 0 ? 1 : 0])) }];
      }));
      return { ok: true, status: 200, json: async () => ({ model: "jev-receipt-concrete", answers }) };
    },
  } };
  const observations: EvaluationObservationV1[] = [];
  setEvaluationObservationExporterForTests(async (observation) => { observations.push(observation); });
  return { cwd, judgement, observations, calibration };
}

test("typed benchmark exports current schema and concrete judge metadata without private evaluation content", async () => {
  const { cwd, judgement, observations } = await fixture();
  const result = await teachingBenchmarkArtifact(cwd, { cases, runner, judgement, surface: "mcp" });
  expect(observations).toHaveLength(1);
  expect(observations[0]).toMatchObject({ schemaVersion: EVALUATION_OBSERVATION_VERSION, operation: "benchmark", engine: "typed-judgement", status: "success", suite: "synthetic-teaching-episodes", model: result.judgement!.backend.model, backend: result.judgement!.backend.backend, surface: "mcp", score: 50, outcome_count: 1 });
  expect(observations[0]!.calibration_sha256).toBeUndefined();
  expect(observations[0]!.duration_ms).toBeGreaterThanOrEqual(0);
  expect(JSON.stringify(observations)).not.toContain("PRIVATE_");
  expect(JSON.stringify(observations)).not.toContain(cwd);
  expect(JSON.stringify(observations)).not.toContain("unrelated-tutor-model");
  expect(Object.keys(observations[0]!).sort()).toEqual(["schemaVersion", "operation", "engine", "status", "suite", "duration_ms", "model", "backend", "surface", "score", "outcome_count", "app_version"].sort());
});

test("calibrated benchmark exports the receipt calibration hash", async () => {
  const { cwd, judgement, observations, calibration } = await fixture({ calibrated: true });
  const result = await teachingBenchmarkArtifact(cwd, { cases, runner, judgement });
  expect(result.report.errorCount).toBe(0);
  expect(observations[0]!.calibration_sha256).toBe(calibration);
  expect(observations[0]!.calibration_sha256).toBe(result.judgement!.backend.calibrationSha256!);
});

test("typed evolution exports paired scores and preserves accepted artifacts when exporter fails", async () => {
  const { cwd, judgement, observations } = await fixture();
  setEvaluationObservationExporterForTests(async (observation) => { observations.push(observation); throw new Error("PRIVATE_EXPORT_FAILURE"); });
  const result = await teachingEvolutionArtifact(cwd, { cases, runner, proposer, judgement, surface: "pi" });
  expect(result.status).toBe("accepted");
  expect(observations).toHaveLength(1);
  expect(observations[0]).toMatchObject({ operation: "auto_improve", engine: "typed-judgement", status: "success", suite: "synthetic-teaching-evolution", surface: "pi", before_score: 50, after_score: 100, outcome_count: 26, candidate_count: 1, model: result.judgement!.backend.model });
  expect(JSON.parse(await readFile(result.observabilityPath, "utf8")).status).toBe("accepted");
  expect(JSON.stringify(observations)).not.toContain("PRIVATE_");
});

test("abstained scores remain absent and rejected evolution stays rejected in telemetry", async () => {
  const uncertain = await fixture({ uncertain: true });
  const benchmark = await teachingBenchmarkArtifact(uncertain.cwd, { cases, runner, judgement: uncertain.judgement });
  expect(benchmark.report.meanScore).toBeNull();
  expect(uncertain.observations[0]!.status).toBe("error");
  expect(uncertain.observations[0]!.score).toBeUndefined();
  const rejected = await fixture({ regression: true });
  const evolution = await teachingEvolutionArtifact(rejected.cwd, { cases, runner, proposer, judgement: rejected.judgement });
  expect(evolution.status).toBe("rejected");
  expect(rejected.observations[0]!.status).toBe("rejected");
  expect(rejected.observations[0]!.outcome_count).toBe(14);
});

test("both typed artifact callers honor disabled telemetry even with a registered exporter", async () => {
  const { cwd, judgement, observations } = await fixture();
  process.env.ARIZE_ENABLED = "false";
  await teachingBenchmarkArtifact(cwd, { cases, runner, judgement });
  await teachingEvolutionArtifact(cwd, { cases, runner, proposer, judgement });
  expect(observations).toEqual([]);
});

import { EVOLUTION_SPEND_QUESTIONS } from "../shared/evolution/spend-review.js";
import { fitJudgementCalibrationArtifact, serializeJudgementCalibrationArtifact } from "../src/judgement/calibration-artifact.js";
import { afterEach, expect, test } from "bun:test";
import { createHash, webcrypto } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { EpisodeRunner, SkillProposer, TeachingCase } from "../shared/evolution/contracts.js";
import { episodeCriterionQuestion } from "../shared/evolution/model-adapters.js";
import { questionDigest } from "../packages/learner-contracts/src/judgement/contracts.js";
import { activeTeachingPrompt, teachingEvolutionArtifact, teachingBenchmarkArtifact } from "../src/core/teaching-evolution.js";
import { NOTORGANIC_AUTH_ENV } from "../src/core/notorganic-auth.js";
import { type CliEvolutionJudgementOptions, EVOLUTION_JUDGE_ENV, EVOLUTION_CALIBRATION_FILE_ENV } from "../src/judgement/cli-evolution.js";
import { JUDGEMENT_MODEL_ENV, JUDGEMENT_CALIBRATION_ENV } from "../src/judgement/transport.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
const cases: TeachingCase[] = ["train", "validation", "holdout"].flatMap((split) => Array.from({ length: split === "train" ? 1 : 6 }, (_, index) => ({
  id: `${split}-${index}`, family: `${split}-family-${index}`, domain: "mathematics", split: split as TeachingCase["split"],
  messages: [{ role: "user", content: `Help with concept ${split}-${index}.` }],
  rubric: [{ id: "accurate", description: "Preserves accuracy.", critical: true }, { id: "diagnostic", description: "Diagnoses the misconception.", critical: false }, { id: "check", description: "Checks an independent attempt.", critical: false }],
})));
const runner: EpisodeRunner = async ({ systemPrompt }) => ({
  messages: [{ role: "assistant", content: systemPrompt.includes("CLI_REPAIR") ? "candidate" : "baseline" }], toolCalls: [], model: "independent-tutor", runtime: "fixture-tutor-runtime",
});
const proposer: SkillProposer = async ({ training }) => ({
  skill: { id: "cli-repair", title: "Check reasoning", instructions: "CLI_REPAIR: check the independent attempt.", hypothesis: "Independent checks improve teaching behavior.", evidenceIds: [training.results[0]!.id] },
  hypothesis: { id: "cli-hypothesis", statement: "Independent checks improve teaching behavior.", evidenceIds: [training.results[0]!.id], status: "proposed" },
});
async function fixture(mode: "ok" | "regression" | "uncertain" | "changed-model" | "unavailable" | "no-evidence" = "ok") {
  const cwd = await mkdtemp(join(tmpdir(), "keating-cli-judge-")); directories.push(cwd);
  const key = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const now = 1_800_000_000_000;
  const credential = { accessToken: "fixture-account-token", env: {
    [NOTORGANIC_AUTH_ENV.issuer]: "https://account.example", [NOTORGANIC_AUTH_ENV.privateJwk]: JSON.stringify(await webcrypto.subtle.exportKey("jwk", key.privateKey)),
    [NOTORGANIC_AUTH_ENV.scope]: "infer:balanced judgement:evaluate", [NOTORGANIC_AUTH_ENV.tokenType]: "DPoP", [NOTORGANIC_AUTH_ENV.expiresAt]: String(now + 300_000),
  } };
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const judgement: CliEvolutionJudgementOptions = {
    env: { [EVOLUTION_JUDGE_ENV]: "notorganic-exploratory", [JUDGEMENT_MODEL_ENV]: "jev-test-concrete", TYPESAFE_API_KEY: "never-forward", KEATING_JUDGEMENT_DIRECT: "true", KEATING_JUDGEMENT_ENDPOINT: "https://evil.example" },
    transport: { now: () => now, loadCredential: (project) => { expect(project).toBe(cwd); return credential; }, retry: { maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 },
      fetch: async (url, init) => {
        const body = JSON.parse(init.body); calls.push({ url, headers: init.headers, body });
        if (mode === "unavailable") return { ok: false, status: 503, json: async () => { throw new Error("provider secret must not be read"); } };
        const candidate = JSON.stringify(body.state).includes("candidate");
        const answers = Object.fromEntries(Object.entries(body.questions as Record<string, { type: string; criteria?: Record<string, unknown> }>).map(([name, question]) => {
          if (question.type === "noul") return [name, { type: "noul", noul: mode === "uncertain" ? 0.5 : (name.endsWith("accurate") ? !(candidate && mode === "regression") : candidate) ? 0.97 : 0.03 }];
          const options = Object.keys(question.criteria!); const choice = mode === "no-evidence" ? options.at(-1)! : options[0]!;
          return [name, { type: "choice", choice, probabilities: Object.fromEntries(options.map((option) => [option, option === choice ? 1 : 0])), confidence: 1 }];
        }));
        return { ok: true, status: 200, json: async () => ({ model: mode === "changed-model" ? "jev-other" : "jev-test-concrete", answers, usage: { input_tokens: 25, output_tokens: 0 } }) };
      },
    },
  };
  return { cwd, judgement, calls, credential };
}

test("production evolution uses project DPoP typed judge independent of tutor and retains both activation gates", async () => {
  const { cwd, judgement, calls } = await fixture();
  const before = await activeTeachingPrompt(cwd);
  const result = await teachingEvolutionArtifact(cwd, { cases, runner, proposer, judgement });
  expect(result.status).toBe("accepted");
  expect(result.experiment.validation?.decision.accepted).toBe(true);
  expect(result.experiment.holdout?.decision.accepted).toBe(true);
  expect((await activeTeachingPrompt(cwd)).revisionId).not.toBe(before.revisionId);
  expect(result.judgement?.calibration).toBe("uncalibrated");
  expect(result.judgement?.backend.calibrationSha256).toBeNull();
  expect(result.experiment.training?.results[0]?.execution?.model).toBe("independent-tutor+judge:system-one/jev-test-concrete@uncalibrated");
  expect(calls).toHaveLength(27);
  expect(calls.every((call) => call.url === "https://account.example/v1/judgement" && call.body.model === "judgement" && call.headers.authorization === "DPoP fixture-account-token" && Boolean(call.headers.dpop))).toBe(true);
  expect(JSON.stringify(calls)).not.toContain("never-forward");
  const saved = JSON.parse(await readFile(result.observabilityPath, "utf8"));
  expect(saved.judgement.calibration).toBe("uncalibrated");
  expect(saved.judgement.observations).toHaveLength(26);
  expect(saved.frontier.mode).toBe("ranked");
  expect(saved.training.results[0].judgments[0].rationale).toContain("Uncalibrated model estimate");
  expect(await readFile(result.reportPath, "utf8")).toContain("uncalibrated proxy estimates");
  await expect(teachingEvolutionArtifact(cwd, { cases, runner, proposer, judgement, force: true })).rejects.toThrow("holdout_consumed");
});

test("typed estimates cannot bypass a critical regression or consume the holdout on rejection", async () => {
  const { cwd, judgement, calls } = await fixture("regression");
  const before = await activeTeachingPrompt(cwd);
  const result = await teachingEvolutionArtifact(cwd, { cases, runner, proposer, judgement });
  expect(result.status).toBe("rejected");
  expect(result.experiment.reasons).toContain("critical_criterion_failed");
  expect(result.experiment.holdout).toBeNull();
  expect(calls).toHaveLength(15);
  expect((await activeTeachingPrompt(cwd)).revisionId).toBe(before.revisionId);
});

for (const failure of ["uncertain", "changed-model", "unavailable", "no-evidence"] as const) {
  test(`production benchmark abstains rather than inventing scores: ${failure}`, async () => {
    const { cwd, judgement } = await fixture(failure);
    const result = await teachingBenchmarkArtifact(cwd, { cases, runner, judgement });
    expect(result.report.meanScore).toBeNull();
    expect(result.report.results[0]?.status).toBe("judge-error");
    expect(result.report.results[0]?.judgments).toEqual([]);
    expect(result.judgement?.calibration).toBe("uncalibrated");
  });
}

test("missing consent and unresolved aliases fail before tutor execution with no direct fallback", async () => {
  const { cwd, judgement, calls, credential } = await fixture();
  let executions = 0;
  const counted: EpisodeRunner = async (input) => { executions++; return runner(input); };
  const inferenceOnly = { ...credential, env: { ...credential.env, [NOTORGANIC_AUTH_ENV.scope]: "infer:balanced" } };
  await expect(teachingBenchmarkArtifact(cwd, { cases, runner: counted, judgement: { ...judgement, transport: { ...judgement.transport, loadCredential: () => inferenceOnly } } })).rejects.toThrow("account_unavailable");
  for (const model of ["judgement", "jev-latest", ""]) {
    await expect(teachingBenchmarkArtifact(cwd, { cases, runner: counted, judgement: { ...judgement, env: { ...judgement.env, [JUDGEMENT_MODEL_ENV]: model } } })).rejects.toThrow("concrete_model_required");
  }
  expect(executions).toBe(0); expect(calls).toHaveLength(0);
});

test("calibrated mode binds measured question thresholds to an exact immutable file hash", async () => {
  const { cwd, judgement } = await fixture();
  const data = JSON.stringify({ schemaVersion: 1, model: "jev-test-concrete", questions: Object.fromEntries(cases[0]!.rubric.map((criterion) => [questionDigest(episodeCriterionQuestion(criterion)), { deferBelow: 0.5, actAtOrAbove: 0.9 }])) });
  await writeFile(join(cwd, "calibration.json"), data);
  const hash = createHash("sha256").update(data).digest("hex");
  const calibrated = { ...judgement, env: { ...judgement.env, [EVOLUTION_JUDGE_ENV]: "notorganic", [EVOLUTION_CALIBRATION_FILE_ENV]: "calibration.json", [JUDGEMENT_CALIBRATION_ENV]: hash } };
  const result = await teachingBenchmarkArtifact(cwd, { cases, runner, judgement: calibrated });
  expect(result.report.errorCount).toBe(0);
  expect(result.judgement?.calibration).toBe("calibrated");
  expect(result.judgement?.backend.calibrationSha256).toBe(hash);
  await writeFile(join(cwd, "calibration.json"), `${data}\n`);
  await expect(teachingBenchmarkArtifact(cwd, { cases, runner, judgement: calibrated })).rejects.toThrow("calibration_pin_mismatch");
});

test("production CLI separately opted-in spend review reads only prior training and remains advisory without a fitted artifact", async () => {
  const { cwd, judgement, calls } = await fixture("regression");
  await teachingEvolutionArtifact(cwd, { cases, runner, proposer, judgement });
  const result = await teachingEvolutionArtifact(cwd, { cases, runner, proposer, force: true,
    judgement: { ...judgement, env: { ...judgement.env, KEATING_EVOLUTION_SPEND_JUDGE: "notorganic-exploratory" } } });
  const spendingCalls = calls.filter(call => Object.keys(call.body.questions as object).includes("skip"));
  expect(spendingCalls).toHaveLength(1);
  expect(JSON.stringify(spendingCalls[0]!.body.state)).not.toContain("holdout-family");
  expect(result.experiment.spendReview?.status).toBe("uncalibrated");
  expect(result.experiment.training).not.toBeNull();
  expect(result.experiment.status).toBe("rejected");
});

test("production CLI verifies a fitted spending artifact before deferring and rejects a changed artifact", async () => {
  const { cwd, judgement } = await fixture("regression");
  await teachingEvolutionArtifact(cwd, { cases, runner, proposer, judgement });
  const backend = { backend: "system-one", model: "jev-test-concrete", calibrationSha256: "c".repeat(64) };
  const observations = Object.entries(EVOLUTION_SPEND_QUESTIONS).flatMap(([id, question]) => ["fit", "validation"].flatMap(split =>
    Array.from({ length: 80 }, (_, i) => ({ observationId: `${id}-${split}-${i}`, sourceId: `${id}-${split}-${i}`, groupId: `${id}-${split}-${i}`,
      split, evidence: "observed", backend: { ...backend, calibrationSha256: null }, question, metricKind: "noul-probability", value: i < 40 ? 0.95 : 0.05, label: i < 40 ? 1 : 0 }))));
  const artifact = fitJudgementCalibrationArtifact({ schemaVersion: 1, policy: { maxFalsePositiveRate: 0.1, maxActionErrorRate: 0.1, minSamples: 20, minActions: 20, minNegatives: 20 }, observations });
  const raw = serializeJudgementCalibrationArtifact(artifact), path = join(cwd, "spending-calibration.json");
  await writeFile(path, raw);
  let tutorCalls = 0, spendCalls = 0, changeDuringCall = false;
  const configured: CliEvolutionJudgementOptions = { ...judgement,
    env: { ...judgement.env, KEATING_EVOLUTION_SPEND_JUDGE: "notorganic", KEATING_EVOLUTION_SPEND_CALIBRATION_FILE: path,
      KEATING_EVOLUTION_SPEND_CALIBRATION_FILE_SHA256: createHash("sha256").update(raw).digest("hex"), [JUDGEMENT_CALIBRATION_ENV]: artifact.calibrationSha256 },
    transport: { ...judgement.transport, fetch: async (url, init) => {
      const request = JSON.parse(init.body);
      if (!request.questions.skip) return judgement.transport!.fetch!(url, init);
      spendCalls++;
      if (changeDuringCall) await writeFile(path, raw + " ");
      return { ok: true, status: 200, json: async () => ({ model: backend.model, answers: { skip: { type: "noul", noul: 0.99 }, failure: { type: "noul", noul: 0.01 }, addressable: { type: "noul", noul: 0.01 } } }) };
    } },
  };
  const result = await teachingEvolutionArtifact(cwd, { force: true, cases, proposer, judgement: configured, runner: async input => { tutorCalls++; return runner(input); } });
  expect(result.experiment.spendReview?.status).toBe("defer"); expect(tutorCalls).toBe(0); expect(spendCalls).toBe(1);
  changeDuringCall = true;
  const stale = await teachingEvolutionArtifact(cwd, { force: true, cases, proposer, judgement: configured, runner: async input => { tutorCalls++; return runner(input); } });
  expect(stale.experiment.spendReview?.status).toBe("unavailable"); expect(tutorCalls).toBeGreaterThan(0); expect(spendCalls).toBe(2);
  const advisory = await teachingEvolutionArtifact(cwd, { force: true, cases, proposer, judgement: configured, runner: async input => { tutorCalls++; return runner(input); } });
  expect(advisory.experiment.spendReview?.status).toBe("unavailable"); expect(tutorCalls).toBeGreaterThan(0); expect(spendCalls).toBe(2);
});

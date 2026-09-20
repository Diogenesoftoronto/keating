import { afterEach, expect, test } from "bun:test";
import { createHash, webcrypto } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dueTopicsArtifact, ensureProjectScaffold } from "../src/core/project.js";
import { learnerStatePath, timelineDir, engagementPolicyPath } from "../src/core/paths.js";
import { loadLearnerState, saveLearnerState } from "../src/core/learner-state.js";
import { cliQuizRecordPath, saveCliQuizSubmission } from "../src/core/quiz-grading.js";
import { generateQuiz } from "../src/core/quiz.js";
import { NOTORGANIC_AUTH_ENV } from "../src/core/notorganic-auth.js";
import { keatingToolMaker } from "../src/pi/hyper-teacher/tools/shared.js";
import type { CliReadinessOptions } from "../src/judgement/cli-readiness.js";
import { fitJudgementCalibrationArtifact, serializeJudgementCalibrationArtifact } from "../src/judgement/calibration-artifact.js";
import { thresholdKey } from "../packages/learner-contracts/src/judgement/projections.js";
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), "keating-readiness-")); directories.push(cwd);
  await ensureProjectScaffold(cwd);
  const state = await loadLearnerState(learnerStatePath(cwd));
  state.coveredTopics = ["derivative", "functions", "limits", "slope"].map(slug => ({ slug, domain: "math", masteryEstimate: .4, sessionCount: 1,
    lastSeen: new Date(Date.now() - (slug === "derivative" ? 35 : 0) * 86400000).toISOString() }));
  await saveLearnerState(learnerStatePath(cwd), state);
  const quiz = generateQuiz("derivative");
  const id = "quiz-readiness-12345678";
  await saveCliQuizSubmission(cwd, { id, quiz, answers: Object.fromEntries(quiz.questions.map(q => [q.id, "A slope describes the rate of change."])), objectiveResults: {}, pendingMathIds: [] });
  const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const credential = { accessToken: "fixture-readiness-token", env: {
    [NOTORGANIC_AUTH_ENV.issuer]: "https://readiness.example", [NOTORGANIC_AUTH_ENV.privateJwk]: JSON.stringify(await webcrypto.subtle.exportKey("jwk", pair.privateKey)),
    [NOTORGANIC_AUTH_ENV.scope]: "judgement:evaluate", [NOTORGANIC_AUTH_ENV.tokenType]: "DPoP", [NOTORGANIC_AUTH_ENV.expiresAt]: String(Date.now() + 300000),
  } };
  const requests: any[] = [];
  const hooks = { onCall: async () => {} };
  const options: CliReadinessOptions = { env: { KEATING_READINESS_JUDGE: "notorganic", KEATING_JUDGEMENT_MODEL: "jev-readiness-fixture" },
    transport: { loadCredential: () => credential, fetch: async (url, init) => {
      expect(url).toBe("https://readiness.example/v1/judgement");
      expect(init.headers.authorization).toBe("DPoP fixture-readiness-token");
      const request = JSON.parse(init.body); requests.push(request); await hooks.onCall();
      return { ok: true, status: 200, json: async () => ({ model: "jev-readiness-fixture", answers: Object.fromEntries(Object.keys(request.questions).map(id => [id, { type: "noul", noul: .92 }])) }) };
    } } };
  return { cwd, id, options, requests, hooks };
}
test("ordinary due remains offline; explicit readiness persists an independent private proxy receipt", async () => {
  const { cwd, options, requests } = await setup();
  const before = await readFile(learnerStatePath(cwd), "utf8");
  const ordinary = await dueTopicsArtifact(cwd, { judgement: options }); expect(requests).toHaveLength(0); expect(ordinary.readiness).toBeUndefined();
  const result = await dueTopicsArtifact(cwd, { readiness: true, judgement: options });
  expect(requests).toHaveLength(1); expect(result.readiness?.status).toBe("uncalibrated"); expect(result.readiness?.selectedId).toBeNull();
  expect(result.readiness?.estimates[0]?.id).toBe("derivative");
  expect(result.markdown).toContain("No calibrated next-review recommendation");
  expect(await readFile(join(timelineDir(cwd), "due.md"), "utf8")).toBe(ordinary.markdown);
  expect(await readFile(learnerStatePath(cwd), "utf8")).toBe(before);
  const path = result.readiness!.receiptPath; expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect(await readFile(path, "utf8")).not.toContain("fixture-readiness-token");
  const body = typeof requests[0].state === "string" ? JSON.parse(requests[0].state) : requests[0].state;
  expect(body.candidates.candidate_0.work[0].result).toBe("pending");
});
test("scheduling and policy changes during dispatch invalidate the result", async () => {
  for (const changePolicy of [false, true]) {
    const { cwd, options, hooks } = await setup();
    hooks.onCall = async () => {
      if (changePolicy) await writeFile(engagementPolicyPath(cwd), JSON.stringify({ minReviewIntervalDays: 365 }));
      else { const state = await loadLearnerState(learnerStatePath(cwd)); state.coveredTopics[0]!.lastSeen = new Date().toISOString(); await saveLearnerState(learnerStatePath(cwd), state); }
    };
    const result = await dueTopicsArtifact(cwd, { readiness: true, judgement: options });
    expect(result.readiness?.stale).toBe(true); expect(result.readiness?.status).toBe("unavailable"); expect(result.readiness?.selectedId).toBeNull();
    expect(result.markdown).not.toContain("readiness estimate");
  }
});
test("malformed durable question content and review verdict never reach a provider", async () => {
  for (const invalidReview of [false, true]) {
    const { cwd, id, options, requests } = await setup();
    const path = cliQuizRecordPath(cwd, id); const record = JSON.parse(await readFile(path, "utf8"));
    if (invalidReview) await writeFile(`${path}.review.json`, JSON.stringify({ schemaVersion: 1, source: "explicit-review", grades: { [record.quiz.questions[0].id]: { verdict: "arbitrary text" } } }));
    else { record.quiz.questions[0].question = { unexpected: "payload" }; await writeFile(path, JSON.stringify(record)); }
    const result = await dueTopicsArtifact(cwd, { readiness: true, judgement: options });
    expect(result.readiness?.status).toBe("unavailable"); expect(requests).toHaveLength(0);
  }
});
test("tool wrapper forwards cancellation; cancelled provider output cannot produce recommendation", async () => {
  const controller = new AbortController(); let passed: AbortSignal | undefined;
  const tool = keatingToolMaker("fixture", "fixture", "fixture", {}, async (_params, _ctx, signal) => { passed = signal; return {}; });
  await tool.execute("id", {}, controller.signal, undefined, {}); expect(passed).toBe(controller.signal);
  const { cwd, options, hooks } = await setup(); hooks.onCall = async () => { controller.abort(); };
  const result = await dueTopicsArtifact(cwd, { readiness: true, judgement: { ...options, signal: controller.signal } });
  expect(result.readiness?.status).toBe("cancelled"); expect(result.readiness?.selectedId).toBeNull();
});

test("a configured calibration without its exact file pin fails closed before hosted inference", async () => {
  for (const config of [
    { KEATING_READINESS_CALIBRATION_FILE: "missing-calibration.json" },
    { KEATING_READINESS_CALIBRATION_FILE_SHA256: "a".repeat(64) },
    { KEATING_READINESS_CALIBRATION_FILE: "missing-calibration.json", KEATING_READINESS_CALIBRATION_FILE_SHA256: "a".repeat(64) },
  ]) {
    const { cwd, options, requests } = await setup();
    const result = await dueTopicsArtifact(cwd, { readiness: true, judgement: { ...options, env: { ...options.env, ...config } } });
    expect(result.readiness?.status).toBe("unavailable");
    expect(result.readiness?.calibrationArtifact).toEqual({ status: "invalid", sha256: null });
    expect(result.readiness?.selectedId).toBeNull();
    expect(requests).toHaveLength(0);
    expect(result.markdown).toContain("Configured calibration could not be verified");
  }
});

// Synthetic fixtures exercise the observed-record contract; they are never
// shipped as measured calibration or as evidence of learner effectiveness.
async function calibratedFixture() {
  const fixture = await setup();
  const { cwd, options, requests } = fixture;
  const backend = { backend: "system-one" as const, model: "jev-readiness-fixture", calibrationSha256: "a".repeat(64) };
  const env = { ...options.env, KEATING_JUDGEMENT_CALIBRATION_SHA256: backend.calibrationSha256 };
  const first = await dueTopicsArtifact(cwd, { readiness: true, judgement: { ...options, env } });
  const entries = Object.fromEntries(Object.values(first.readiness!.questionDigests).map(digest => [thresholdKey(backend, digest), { deferBelow: .5, actAtOrAbove: .8 }]));
  const second = await dueTopicsArtifact(cwd, { readiness: true, judgement: { ...options, env, calibration: { entries } } });
  const questions = Object.values(second.readiness!.questionDigests).map(value => JSON.parse(value));
  expect(questions).toHaveLength(2);
  const observations = questions.flatMap((question, q) => ["fit", "validation"].flatMap(split => Array.from({ length: 100 }, (_, i) => ({
    observationId: `${q}-${split}-${i}`, sourceId: `source-${q}-${split}-${i}`, groupId: `group-${q}-${split}-${i}`,
    split, evidence: "observed", backend: { ...backend, calibrationSha256: null }, question, metricKind: question.type === "noul" ? "noul-probability" : "choice-confidence",
    value: i < 50 ? .9 : .1, label: i < 50 ? 1 : 0,
  }))));
  const artifact = fitJudgementCalibrationArtifact({ schemaVersion: 1,
    policy: { maxFalsePositiveRate: .1, maxActionErrorRate: .1, minSamples: 40, minActions: 40, minNegatives: 40 }, observations });
  const source = serializeJudgementCalibrationArtifact(artifact);
  const path = join(cwd, "calibration.json");
  await writeFile(path, source, { mode: 0o600 });
  const pin = createHash("sha256").update(source).digest("hex");
  requests.length = 0;
  const fetch = options.transport!.fetch!;
  const configured: CliReadinessOptions = { ...options,
    env: { ...env, KEATING_JUDGEMENT_CALIBRATION_SHA256: artifact.calibrationSha256, KEATING_READINESS_CALIBRATION_FILE: path, KEATING_READINESS_CALIBRATION_FILE_SHA256: pin },
    transport: { ...options.transport, fetch: async (url, init) => {
      const result = await fetch(url, init);
      const request = JSON.parse(init.body);
      if (!request.questions.selection) return result;
      return { ok: true, status: 200, json: async () => ({ model: backend.model, answers: {
        selection: { type: "choice", choice: "candidate_0", confidence: .99, probabilities: { candidate_0: .99, none: .01 } },
      } }) };
    } },
  };
  return { ...fixture, configured, path, pin };
}

test("production readiness loads exact fitted artifact and applies both calibrated stages", async () => {
  const { cwd, configured, requests, pin } = await calibratedFixture();
  const before = await readFile(learnerStatePath(cwd), "utf8");
  const result = await dueTopicsArtifact(cwd, { readiness: true, judgement: configured });
  expect(result.readiness?.status).toBe("selected");
  expect(result.readiness?.selectedId).toBe("derivative");
  expect(result.readiness?.calibrationArtifact).toEqual({ status: "loaded", sha256: pin });
  expect(requests).toHaveLength(2);
  expect(await readFile(learnerStatePath(cwd), "utf8")).toBe(before);
});

test("calibration changes during inference invalidate the proposed recommendation", async () => {
  const { cwd, configured, path, hooks } = await calibratedFixture();
  hooks.onCall = async () => { await writeFile(path, "{}"); };
  const result = await dueTopicsArtifact(cwd, { readiness: true, judgement: configured });
  expect(result.readiness?.status).toBe("unavailable");
  expect(result.readiness?.stale).toBe(true);
  expect(result.readiness?.selectedId).toBeNull();
  expect(result.readiness?.calibrationArtifact.status).toBe("invalid");
  expect(result.markdown).not.toContain("readiness estimate");
});

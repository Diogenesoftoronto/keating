import { expect, test } from "bun:test";
import { abstained, decided, questionDigest, routeJudgement, thresholdKey, type JudgementBackendKey, type RoutedQuestion } from "@keating/learner-contracts";
import { createWebJudgementRuntime, type WebJudgementCalibration, type WebJudgementRuntimeOptions } from "../keating/judgement/runtime";
import { DESKTOP_OFFLINE_MODEL, type DesktopOfflineBridge } from "../lib/desktop-offline";
import type { JudgementModelSettings } from "../keating/judgement-model";

const local: JudgementBackendKey = { backend: "local", model: DESKTOP_OFFLINE_MODEL.id, calibrationSha256: "a".repeat(64) };
const hosted: JudgementBackendKey = { backend: "system-one", model: "jev-1.13", calibrationSha256: "b".repeat(64) };
const question: RoutedQuestion<boolean> = {
  key: "ready", question: { type: "noul", instructions: "Independent work?", criteria: { false: "needed help", true: "worked independently" } }, baseline: false,
  read: (answer, thresholds, provenance) => answer.type === "noul" && answer.noul >= thresholds.actAtOrAbove
    ? decided(true, null, provenance) : abstained("below-confidence-floor", provenance),
};
const settings = (backend: JudgementModelSettings["backend"]): JudgementModelSettings => ({ backend, localModelId: local.model, gatewayPath: "/api/judgement" });
const calibration = (backend: JudgementBackendKey): WebJudgementCalibration => ({ backend, table: { entries: {
  [thresholdKey(backend, questionDigest(question.question))]: { deferBelow: 0.5, actAtOrAbove: 0.9 },
} } });
const response = (model = hosted.model) => ({ ok: true, status: 200, json: async () => ({ model, answers: { ready: { type: "noul", noul: 0.99 } } }) });
const route = (options: WebJudgementRuntimeOptions) => routeJudgement("learner work", question, createWebJudgementRuntime(options).policy);

// Tables here are synthetic fixtures, not production calibration evidence.
test("desktop runtime uses the chosen model and full rubric through the real adapter", async () => {
  let calls = 0;
  const desktopBridge = { scoreLabels: async (request: { modelId: string; prompt: string }) => {
    calls++;
    expect(request.modelId).toBe(local.model);
    expect(JSON.parse(request.prompt.split("\n").at(-1)!).question).toEqual(question.question);
    return { modelId: request.modelId, negativeLogLikelihoods: [10, 1] };
  } } as unknown as DesktopOfflineBridge;
  const result = await route({ settings: settings("local"), desktopBridge, calibration: { local: calibration(local) } });
  expect(result.value).toBe(true);
  expect(result.attempts[0].backend).toEqual(local);
  expect(calls).toBe(1);
});

test("off and local settings never send learner work to hosted inference", async () => {
  let remoteCalls = 0;
  for (const mode of ["off", "local"] as const) {
    const result = await route({ settings: settings(mode), localScorer: { modelId: local.model, scoreLabels: async () => [1, 1] },
      hosted: { fetch: async () => { remoteCalls++; return response(); } },
      calibration: { local: calibration(local), hosted: calibration(hosted) }, pinnedBackend: hosted });
    expect(result.value).toBe(false);
    expect(result.attempts).toEqual([]);
  }
  expect(remoteCalls).toBe(0);
});

test("hosted opt-in escalates only after local abstention", async () => {
  const calls: string[] = [];
  const result = await route({ settings: settings("hosted"), localScorer: { modelId: local.model, scoreLabels: async () => { calls.push("local"); return [1, 1]; } },
    hosted: { fetch: async (url, init) => { calls.push("hosted"); expect(url).toBe("/api/judgement"); expect(init.headers.authorization).toBeUndefined(); expect(JSON.parse(init.body).model).toBe("judgement"); return response(); } },
    calibration: { local: calibration(local), hosted: calibration(hosted) } });
  expect(calls).toEqual(["local", "hosted"]);
  expect(result.value).toBe(true);
  expect(result.attempts.map(attempt => attempt.outcome)).toEqual(["abstained", "decided"]);
});

test("missing calibration, wrong identities, and aliases never invent usable thresholds", async () => {
  let calls = 0;
  const options: WebJudgementRuntimeOptions = { settings: settings("hosted"), localScorer: { modelId: local.model, scoreLabels: async () => { calls++; return [0, 1]; } }, hosted: { fetch: async () => { calls++; return response(); } } };
  for (const tables of [undefined, { local: calibration(hosted), hosted: calibration(local) },
    { local: calibration({ ...local, calibrationSha256: null }), hosted: calibration({ ...hosted, model: "jev-latest" }) }]) {
    const result = await route({ ...options, calibration: tables });
    expect(result.value).toBe(false);
    expect(result.attempts.every(attempt => attempt.outcome === "skipped-uncalibrated")).toBe(true);
  }
  expect(calls).toBe(0);
});

test("calibration from another question or backend cannot bleed across tables", async () => {
  let calls = 0;
  const foreign = calibration(hosted);
  const wrongQuestion = { ...question.question, instructions: "A different question" };
  const runtime = createWebJudgementRuntime({ settings: settings("local"), localScorer: { modelId: local.model, scoreLabels: async () => { calls++; return [0, 1]; } }, calibration: { local: { backend: local, table: { entries: { ...foreign.table.entries,
    [thresholdKey(local, questionDigest(wrongQuestion))]: { deferBelow: 0.5, actAtOrAbove: 0.9 },
    [thresholdKey(local, questionDigest(question.question))]: { deferBelow: 0.9, actAtOrAbove: 0.1 },
  } } } } });
  expect(Object.keys(runtime.policy.calibration.entries)).toEqual([thresholdKey(local, questionDigest(wrongQuestion))]);
  expect((await routeJudgement("work", question, runtime.policy)).value).toBe(false);
  expect(calls).toBe(0);
});

test("unavailable browser model is not silently replaced with the installed desktop model", async () => {
  let calls = 0;
  const selected = { ...local, model: "selected-browser-model" };
  const result = await route({ settings: { ...settings("local"), localModelId: selected.model },
    localScorer: { modelId: local.model, scoreLabels: async () => { calls++; return [0, 1]; } },
    desktopBridge: { scoreLabels: async () => { calls++; return null; } } as unknown as DesktopOfflineBridge,
    calibration: { local: calibration(selected) } });
  expect(result.attempts[0].outcome).toBe("skipped-unavailable");
  expect(result.attempts[0].backend.model).toBe(selected.model);
  expect(calls).toBe(0);
});

test("pins disable fallback and require the exact calibration identity", async () => {
  let remoteCalls = 0, localCalls = 0;
  const options: WebJudgementRuntimeOptions = { settings: settings("hosted"), localScorer: { modelId: local.model, scoreLabels: async () => { localCalls++; return [1, 1]; } },
    hosted: { fetch: async () => { remoteCalls++; return response(); } }, calibration: { local: calibration(local), hosted: calibration(hosted) } };
  expect((await route({ ...options, pinnedBackend: local })).value).toBe(false);
  expect(remoteCalls).toBe(0);
  expect(localCalls).toBe(1);
  expect((await route({ ...options, pinnedBackend: { ...hosted, calibrationSha256: "c".repeat(64) } })).attempts).toEqual([]);
  expect((await route({ ...options, pinnedBackend: hosted })).value).toBe(true);
  expect(remoteCalls).toBe(1);
  expect(localCalls).toBe(1);
});

test("gateway model drift invalidates a pinned response", async () => {
  const result = await route({ settings: settings("hosted"), hosted: { fetch: async () => response("jev-1.14") }, calibration: { hosted: calibration(hosted) }, pinnedBackend: hosted });
  expect(result.value).toBe(false);
  expect(result.attempts[0].detail).toBe("backend-identity-mismatch");
});

test("configuration snapshots isolate a running operation from later settings and table mutations", async () => {
  const selected = { ...settings("local") };
  const thresholds = { deferBelow: 0.5, actAtOrAbove: 0.9 };
  const table = { backend: local, table: { entries: { [thresholdKey(local, questionDigest(question.question))]: thresholds } } };
  const pin = { ...local };
  const runtime = createWebJudgementRuntime({ settings: selected, localScorer: { modelId: local.model, scoreLabels: async () => [0, 1] }, calibration: { local: table }, pinnedBackend: pin });
  selected.backend = "off";
  pin.model = "different";
  thresholds.actAtOrAbove = 1;
  expect(runtime.settings.backend).toBe("local");
  expect(runtime.policy.pinnedBackend).toEqual(local);
  expect(runtime.policy.calibration.entries[thresholdKey(local, questionDigest(question.question))].actAtOrAbove).toBe(0.9);
  expect((await routeJudgement("work", question, runtime.policy)).value).toBe(true);
});

test("unsafe persisted gateway paths cannot redirect learner text off origin", async () => {
  for (const path of ["https://outside.example", "//outside.example", "/\\outside.example", "/\t/outside.example"]) {
    await route({ settings: { ...settings("hosted"), gatewayPath: path }, pinnedBackend: hosted, calibration: { hosted: calibration(hosted) },
      hosted: { fetch: async url => { expect(url).toBe("/api/judgement"); return response(); } } });
  }
});


test("uppercase calibration hashes stay unknown for both backends", async () => {
  let calls = 0;
  const runtime = createWebJudgementRuntime({
    settings: settings("hosted"),
    localScorer: { modelId: local.model, scoreLabels: async () => { calls++; return [0, 1]; } },
    hosted: { fetch: async () => { calls++; return response(); } },
    calibration: {
      local: calibration({ ...local, calibrationSha256: "A".repeat(64) }),
      hosted: calibration({ ...hosted, calibrationSha256: "B".repeat(64) }),
    },
  });
  expect(runtime.policy.tiers.map(tier => tier.key.calibrationSha256)).toEqual([null, null]);
  expect(runtime.policy.calibration.entries).toEqual({});
  const result = await routeJudgement("work", question, runtime.policy);
  expect(result.value).toBe(false);
  expect(result.attempts.map(attempt => attempt.outcome)).toEqual(["skipped-uncalibrated", "skipped-uncalibrated"]);
  expect(calls).toBe(0);
});

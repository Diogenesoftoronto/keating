import { expect, test } from "bun:test";
import type { JudgementBackendKey, JudgementCaller, JudgementOutcome, JudgementRequest } from "@keating/learner-contracts";
import { createJudgementOperationCaller } from "../keating/judgement/operation";
import type { WebJudgementRuntime } from "../keating/judgement/runtime";

const local: JudgementBackendKey = { backend: "local", model: "selected-local", calibrationSha256: null };
const hosted: JudgementBackendKey = { backend: "system-one", model: "jev-concrete", calibrationSha256: null };
const request: JudgementRequest = { state: "private learning record", questions: { ready: { type: "noul", instructions: "Is it ready?" } } };
const success = (backend = hosted, noul = 1): JudgementOutcome => ({ ok: true, response: { backend, answers: { ready: { type: "noul", noul } } } });
const runtime = (tiers: WebJudgementRuntime["policy"]["tiers"], backend: "off" | "local" | "hosted" = "hosted"): WebJudgementRuntime => ({
  settings: { backend, localModelId: local.model, gatewayPath: "/api/judgement" }, policy: { tiers, calibration: { entries: {} } },
});
const accept = (response: Extract<JudgementOutcome, { ok: true }>["response"]) => response.answers.ready.type === "noul" && response.answers.ready.noul === 1;

test("explicit operation escalates local uncertainty only with hosted opt-in", async () => {
  const calls: string[] = [];
  const tiers = [
    { key: local, call: async () => { calls.push("local"); return success(local, 0.5); } },
    { key: { ...hosted, model: "judgement" }, call: async () => { calls.push("hosted"); return success(); } },
  ];
  expect((await createJudgementOperationCaller({ runtime: runtime(tiers), accept })(request)).ok).toBe(true);
  expect(calls).toEqual(["local", "hosted"]); calls.length = 0;
  expect((await createJudgementOperationCaller({ runtime: runtime(tiers, "local"), accept })(request)).ok).toBe(false);
  expect(calls).toEqual(["local"]); calls.length = 0;
  expect((await createJudgementOperationCaller({ runtime: runtime(tiers, "off"), accept })(request)).ok).toBe(false);
  expect(calls).toEqual([]);
});

test("operation resolves alias once and rejects drift, wrong backend and borrowed calibration", async () => {
  let actual = hosted;
  const call = createJudgementOperationCaller({ runtime: runtime([{ key: { ...hosted, model: "judgement" }, call: async () => success(actual) }]), accept });
  expect((await call(request)).ok).toBe(true);
  actual = { ...hosted, model: "jev-next" };
  expect(await call(request)).toMatchObject({ ok: false, error: { code: "response-malformed" } });
  for (const bad of [{ ...hosted, model: "judgement" }, { ...hosted, model: "jev-latest" }, local, { ...hosted, calibrationSha256: "a".repeat(64) }]) {
    const result = await createJudgementOperationCaller({ runtime: runtime([{ key: { ...hosted, model: "judgement" }, call: async () => success(bad) }]), accept })(request);
    expect(result).toMatchObject({ ok: false, error: { code: "response-malformed" } });
  }
});

test("pins restrict execution, timeout bounds broken callers, cancellation and exceptions stay private", async () => {
  let calls = 0;
  const tier = { key: local, call: async () => { calls++; return success(local); } };
  const selected = runtime([tier]);
  const pinned = { ...selected, policy: { ...selected.policy, pinnedBackend: hosted } };
  expect((await createJudgementOperationCaller({ runtime: pinned, accept })(request)).ok).toBe(false);
  expect(calls).toBe(0);
  const hanging: JudgementCaller = () => new Promise(() => {});
  expect(await createJudgementOperationCaller({ runtime: runtime([{ key: local, call: hanging }]), accept, timeoutMs: 2 })(request)).toMatchObject({ ok: false, error: { code: "backend-timeout" } });
  const controller = new AbortController(); controller.abort();
  expect(await createJudgementOperationCaller({ runtime: selected, accept })(request, controller.signal)).toMatchObject({ ok: false, error: { code: "cancelled" } });
  expect(calls).toBe(0);
  const result = await createJudgementOperationCaller({ runtime: runtime([{ key: local, call: async () => { throw new Error("private learner answer"); } }]), accept })(request);
  expect(JSON.stringify(result)).not.toContain("private");
});

import { expect, test } from "bun:test";
import type { JudgementBackendKey, JudgementOutcome, JudgementRequest } from "@keating/learner-contracts";
import { evolveBrowserPrompt } from "../keating/prompt-evolution";
import { evolvePromptTemplate } from "../keating/core";
import type { WebJudgementRuntime } from "../keating/judgement/runtime";
import type { KeatingStorage } from "../keating/storage";
import { saveJudgementModelSettings } from "../keating/judgement-model";
import { judgementRequestProblem } from "@keating/learner-contracts";
import { configureJudgementDiagnostics, getJudgementDiagnostics, observeJudgementCaller } from "../keating/judgement/diagnostics";

if (typeof (globalThis as { DOMMatrix?: unknown }).DOMMatrix === "undefined") {
  (globalThis as { DOMMatrix: new () => unknown }).DOMMatrix = class DOMMatrix {};
}
const prompt = "Teach the learner in their own words. Diagnose prerequisite gaps. Verify claims. Require retrieval. Bridge the idea to another domain.";
const key: JudgementBackendKey = { backend: "system-one", model: "jev-1.13.0", calibrationSha256: null };
const local: JudgementBackendKey = { backend: "local", model: "local-v1", calibrationSha256: null };
function runtime(tiers: WebJudgementRuntime["policy"]["tiers"], backend: "off" | "local" | "hosted" = "hosted"): WebJudgementRuntime {
  return { settings: { backend, localModelId: local.model, gatewayPath: "/api/judgement" }, policy: { tiers, calibration: { entries: {} } } };
}
function response(request: JudgementRequest, backend = key, level = 2): JudgementOutcome {
  return { ok: true, response: { backend: { ...backend }, answers: Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
    if (question.type === "score") return [id, { type: "score", score: level, confidence: 1,
      probabilities: Object.fromEntries(question.criteria.map((_, i) => [String(i), i === level ? 1 : 0])),
      legend: Object.fromEntries(question.criteria.map((label, i) => [String(i), label])) }];
    if (question.type !== "choice") throw new Error("unexpected");
    const keys = Object.keys(question.criteria);
    return [id, { type: "choice", choice: keys[0], confidence: 1,
      probabilities: Object.fromEntries(keys.map((option, i) => [option, i === 0 ? 1 : 0])) }];
  })) } } as JudgementOutcome;
}
class Store {
  values: any[] = [];
  async put(_key: string, value: unknown) { this.values.push(structuredClone(value)); }
}

test("production prompt_evolve scores baseline plus four unchanged proposals and saves raw concrete provenance", async () => {
  const { createImprovementTools } = await import("../keating/browser-tools/improvement");
  const { getActiveKeatingPrompt } = await import("../keating/browser-tools/prompt");
  const saved: any[] = [], requests: JudgementRequest[] = [];
  const storage = { savePromptEvolution: async (_name: string, value: unknown) => { saved.push(value); } } as unknown as KeatingStorage;
  const base = await getActiveKeatingPrompt(storage);
  const store = new Store();
  const entry = createImprovementTools(storage, {}, async () => [], { store, runtime: runtime([{ key: { ...key, model: "judgement" }, call: async request => {
    requests.push(structuredClone(request)); return response(request);
  } }]) }).find(tool => tool.name === "prompt_evolve")!;
  const result = await entry.execute("evolve", { name: "learn" });
  expect(requests).toHaveLength(5); expect(saved).toHaveLength(1);
  for (const request of requests) {
    expect(judgementRequestProblem(request)).toBeNull();
    expect(JSON.stringify(request).length).toBeLessThanOrEqual(128_000);
  }
  expect(requests.slice(1).map(request => (request.state as { promptText: string }).promptText)).toEqual(evolvePromptTemplate(base).exploredCandidates.map(candidate => candidate.prompt));
  expect(JSON.stringify(result)).toContain("Uncalibrated model estimates throughout");
  expect(JSON.stringify(result)).toContain("jev-1.13.0");
  expect(store.values[0].backend).toEqual(key);
  expect(Object.keys(store.values[0].questionDigests)).toHaveLength(6);
  expect(store.values[0].evaluations).toHaveLength(5);
  expect(store.values[0].evaluations.every((evaluation: any) => evaluation.attempts.length === 1)).toBe(true);
  expect(await getActiveKeatingPrompt(storage)).toBe(base);
});

test("baseline may select fallback once; chosen local failure never escalates mid-comparison", async () => {
  let localCalls = 0, hostedCalls = 0;
  const store = new Store();
  const result = await evolveBrowserPrompt(prompt, "learn", { store, runtime: runtime([
    { key: local, call: async request => ++localCalls === 1 ? response(request, local) : { ok: false, error: { code: "backend-unavailable", retryable: false } } },
    { key, call: async request => { hostedCalls++; return response(request); } },
  ]) });
  expect(result.run).toBeNull(); expect(localCalls).toBe(2); expect(hostedCalls).toBe(0);
  expect(result.receipt.reason).toBe("judgement-abstained");
  expect(store.values[0].evaluations).toHaveLength(2);
  expect(store.values[0].evaluations[1].attempts[0].outcome.ok).toBe(false);

  localCalls = 0; hostedCalls = 0;
  const fallback = await evolveBrowserPrompt(prompt, "learn", { store: new Store(), runtime: runtime([
    { key: local, call: async () => { localCalls++; return { ok: false, error: { code: "backend-unavailable", retryable: false } }; } },
    { key, call: async request => { hostedCalls++; return response(request); } },
  ]) });
  expect(fallback.run).not.toBeNull(); expect(localCalls).toBe(1); expect(hostedCalls).toBe(5);
  expect(fallback.receipt.evaluations[0]!.attempts).toHaveLength(2);
});

test("unavailable baseline locks legacy heuristic scoring without retry; off/local never call hosted", async () => {
  let calls = 0;
  for (const backend of ["hosted", "local", "off"] as const) {
    const result = await evolveBrowserPrompt(prompt, "learn", { store: new Store(), runtime: runtime([{ key, call: async () => {
      calls++; return { ok: false, error: { code: "backend-unavailable", retryable: false } };
    } }], backend) });
    expect(result.run).toEqual(evolvePromptTemplate(prompt));
    expect(result.receipt.source).toBe("heuristic");
  }
  expect(calls).toBe(1);
});

test("model and calibration drift abort with raw conflicting responses retained", async () => {
  for (const drift of [{ ...key, model: "jev-2" }, { ...key, calibrationSha256: "a".repeat(64) }]) {
    let calls = 0;
    const result = await evolveBrowserPrompt(prompt, "learn", { store: new Store(), runtime: runtime([{ key: { ...key, model: "judgement" }, call: async request => response(request, ++calls === 1 ? key : drift) }]) });
    expect(calls).toBe(2); expect(result.run).toBeNull();
    expect(result.receipt.reason).toBe("identity-changed");
    expect(result.receipt.evaluations[1]!.attempts[0]!.outcome).toMatchObject({ response: { backend: drift } });
  }
});

test("runtime mutation cannot replace the chosen scorer, and missing later evidence saves no proposal", async () => {
  let calls = 0;
  const configured = runtime([{ key, call: async request => {
    calls++;
    (configured.settings as { backend: string }).backend = "off";
    (configured.policy.tiers as unknown[]).splice(0);
    return response(request);
  } }]);
  const stable = await evolveBrowserPrompt(prompt, "learn", { store: new Store(), runtime: configured });
  expect(stable.run).not.toBeNull(); expect(calls).toBe(5);

  const { createImprovementTools } = await import("../keating/browser-tools/improvement");
  let saved = 0, attempts = 0;
  const store = new Store();
  const entry = createImprovementTools({ savePromptEvolution: async () => { saved++; } } as unknown as KeatingStorage,
    {}, async () => [], { store, runtime: runtime([{ key, call: async request => {
      const result = response(request);
      if (++attempts > 1 && result.ok) return { ...result, response: { ...result.response, answers: Object.fromEntries(Object.entries(result.response.answers).filter(([id]) => id !== "evidence:diagnosis")) } };
      return result;
    } }]) }).find(tool => tool.name === "prompt_evolve")!;
  await expect(entry.execute("evolve", { name: "learn" })).rejects.toThrow("no winner was saved");
  expect(saved).toBe(0); expect(attempts).toBe(2);
  expect(store.values[0].evaluations[1].attempts[0].outcome.ok).toBe(true);
  expect(store.values[0].reason).toBe("judgement-abstained");
});

test("aborted and setting-invalidated noncooperative calls stop without publishing a winner", async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  try { for (const settingsChange of [false, true]) {
    const controller = new AbortController();
    const store = new Store();
    const run = evolveBrowserPrompt(prompt, "learn", { store, runtime: runtime([{ key, call: async () => {
      queueMicrotask(() => settingsChange ? saveJudgementModelSettings({ backend: "off", localModelId: local.model, gatewayPath: "/api/judgement" }) : controller.abort());
      return await new Promise<JudgementOutcome>(() => {});
    } }]) }, controller.signal);
    const result = await run;
    expect(result.run).toBeNull(); expect(result.receipt.reason).toBe("cancelled"); expect(store.values).toHaveLength(1);
  } } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("oversized input does not dispatch; failed receipt storage is explicit", async () => {
  let calls = 0;
  const result = await evolveBrowserPrompt("x".repeat(24_001), "learn", { runtime: runtime([{ key, call: async request => { calls++; return response(request); } }]),
    store: { put: async () => { throw new Error("private"); } } });
  expect(calls).toBe(0); expect(result.receiptKey).toBeNull();
  expect(result.receipt.evaluations[0]!.review.judgement.reason).toBe("input-budget");
  expect(result.run).not.toBeNull();
});

test("cloned dispatched requests retain operation deduplication and release their markers without losing source isolation", async () => {
  configureJudgementDiagnostics({ enabled: true });
  try {
    const dispatched: JudgementRequest[] = [];
    const observed = observeJudgementCaller(async request => {
      dispatched.push(request);
      const result = response(request);
      (request.state as { promptText: string }).promptText = "provider mutation";
      return result;
    }, key);
    const result = await evolveBrowserPrompt(prompt, "learn", { store: new Store(), runtime: runtime([{ key, call: observed }]) });
    expect(result.run).not.toBeNull();
    expect(getJudgementDiagnostics().events).toHaveLength(5);
    expect(getJudgementDiagnostics().events.every(event => event.origin === "prompt-evolution")).toBe(true);
    expect(result.receipt.evaluations[0]!.prompt).toBe(prompt);
    expect(result.receipt.evaluations[0]!.attempts[0]!.request.state).toMatchObject({ promptText: prompt });
    await observed(dispatched[0]!);
    expect(getJudgementDiagnostics().events).toHaveLength(6);
    expect(getJudgementDiagnostics().events.at(-1)!.origin).toBe("calibrated-router");
  } finally { configureJudgementDiagnostics({ enabled: false }); }
});

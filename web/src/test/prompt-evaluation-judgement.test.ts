import { expect, test } from "bun:test";
import type { JudgementBackendKey, JudgementOutcome, JudgementRequest } from "@keating/learner-contracts";
import type { WebJudgementRuntime } from "../keating/judgement/runtime";
import type { KeatingStorage } from "../keating/storage";
import { evaluateBrowserPrompt } from "../keating/judgement/prompt-evaluation";

if (typeof (globalThis as { DOMMatrix?: unknown }).DOMMatrix === "undefined") {
  (globalThis as { DOMMatrix: new () => unknown }).DOMMatrix = class DOMMatrix {};
}
const prompt = "Ask the learner to explain in their own words. Diagnose prerequisite gaps. Verify factual claims. Require retrieval without looking. Ask for transfer to another context. Continue only after a learner checkpoint.";
const hosted: JudgementBackendKey = { backend: "system-one", model: "judgement", calibrationSha256: null };
const concrete = { ...hosted, model: "jev-1.13.0" };
const local: JudgementBackendKey = { backend: "local", model: "independent-local-v1", calibrationSha256: null };
function runtime(tiers: WebJudgementRuntime["policy"]["tiers"], backend: "off" | "local" | "hosted" = "hosted"): WebJudgementRuntime {
  return { settings: { backend, localModelId: local.model, gatewayPath: "/api/judgement" }, policy: { tiers, calibration: { entries: {} } } };
}
function response(request: JudgementRequest, backend = concrete, uncertain = false): JudgementOutcome {
  return { ok: true, response: { backend, answers: Object.fromEntries(Object.entries(request.questions).map(([key, question]) => {
    if (question.type === "score") return [key, { type: "score", score: 2, confidence: 1,
      probabilities: uncertain ? { "0": 0.5, "1": 0, "2": 0, "3": 0.5 } : { "0": 0, "1": 0, "2": 1, "3": 0 },
      legend: Object.fromEntries(question.criteria.map((label, i) => [String(i), label])) }];
    if (question.type !== "choice") throw new Error("unexpected primitive");
    const keys = Object.keys(question.criteria);
    return [key, { type: "choice", choice: keys[0], confidence: 1, probabilities: Object.fromEntries(keys.map((option, i) => [option, i === 0 ? 1 : 0])) }];
  })) } } as JudgementOutcome;
}
class Store {
  values = new Map<string, any>();
  async put(key: string, value: unknown) { this.values.set(key, structuredClone(value)); }
}
async function tool(judgementRuntime: WebJudgementRuntime, store: { put(key: string, value: unknown): Promise<void> }) {
  const { createImprovementTools } = await import("../keating/browser-tools/improvement");
  return createImprovementTools({} as KeatingStorage, {}, async () => [], { runtime: judgementRuntime, store }).find(entry => entry.name === "prompt_eval")!;
}

test("production prompt_eval dispatches twelve independent questions and displays a stored uncalibrated concrete receipt", async () => {
  const store = new Store();
  const requests: JudgementRequest[] = [];
  const entry = await tool(runtime([{ key: hosted, call: async request => { requests.push(request); return response(request); } }]), store);
  const result = await entry.execute("eval", { prompt });
  expect(requests).toHaveLength(1); expect(requests[0]!.state).toMatchObject({ promptText: prompt });
  expect(Object.keys(requests[0]!.questions)).toHaveLength(12);
  expect(JSON.stringify(result)).toContain("jev-1.13.0");
  expect(JSON.stringify(result)).toContain("uncalibrated model estimate");
  expect(JSON.stringify(result)).toContain("saved locally");
  const [key, receipt] = [...store.values][0]!;
  expect(key).toStartWith("raw/prompt-evaluation-");
  expect(receipt.source).toBe("proxy"); expect(receipt.judgement.backend).toEqual(concrete);
  expect(receipt.attempts).toEqual([response(requests[0]!)]);
  expect(receipt.judgement.evidence.diagnosis.quote).toBe(prompt.slice(receipt.judgement.evidence.diagnosis.start, receipt.judgement.evidence.diagnosis.end));
});

test("off and local-only settings preserve a labeled baseline without dispatching hosted judgement", async () => {
  let hostedCalls = 0;
  for (const backend of ["off", "local"] as const) {
    const store = new Store();
    const entry = await tool(runtime([{ key: hosted, call: async request => { hostedCalls++; return response(request); } }], backend), store);
    const result = await entry.execute("eval", { prompt });
    expect(JSON.stringify(result)).toContain("heuristic keyword baseline");
    expect([...store.values.values()][0].source).toBe("heuristic");
  }
  expect(hostedCalls).toBe(0);
});

test("uncertain local evidence escalates only with hosted consent and retains both raw attempts", async () => {
  let hostedCalls = 0;
  const tiers: WebJudgementRuntime["policy"]["tiers"] = [
    { key: local, call: async request => response(request, local, true) },
    { key: hosted, call: async request => { hostedCalls++; return response(request); } },
  ];
  const localOnly = await evaluateBrowserPrompt(prompt, { runtime: runtime(tiers, "local"), store: new Store() });
  expect(localOnly.source).toBe("heuristic"); expect(localOnly.attempts).toHaveLength(1); expect(hostedCalls).toBe(0);
  const consented = await evaluateBrowserPrompt(prompt, { runtime: runtime(tiers), store: new Store() });
  expect(consented.source).toBe("proxy"); expect(consented.attempts).toHaveLength(2); expect(hostedCalls).toBe(1);
  expect(consented.judgement.backend).toEqual(concrete);
});

test("missing evidence abstains; input limits skip providers; storage failure is visible", async () => {
  let calls = 0;
  const judgementRuntime = runtime([{ key: hosted, call: async request => {
    calls++; const outcome = response(request);
    if (!outcome.ok) return outcome;
    return { ...outcome, response: { ...outcome.response, answers: Object.fromEntries(Object.entries(outcome.response.answers).filter(([key]) => key !== "evidence:diagnosis")) } };
  } }]);
  const missing = await evaluateBrowserPrompt(prompt, { runtime: judgementRuntime, store: new Store() });
  expect(missing.source).toBe("heuristic"); expect(missing.attempts).toHaveLength(1);
  expect(missing.judgement.status).toBe("abstained"); expect(missing.judgement.reason).toBe("invalid-or-uncertain");
  const oversized = await evaluateBrowserPrompt("x".repeat(24_001), { runtime: judgementRuntime, store: new Store() });
  expect(oversized.judgement.reason).toBe("input-budget"); expect(calls).toBe(1);
  const entry = await tool(runtime([{ key: hosted, call: async request => response(request) }]), { put: async () => { throw new Error("private storage exception"); } });
  const result = await entry.execute("eval", { prompt });
  expect(JSON.stringify(result)).toContain("could not be saved locally");
  expect(JSON.stringify(result)).not.toContain("private storage exception");
  expect(JSON.stringify(result)).toContain("jev-1.13.0");
});

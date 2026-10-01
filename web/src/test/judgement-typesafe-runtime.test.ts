import { afterEach, expect, test } from "bun:test";
import { getAppStorage, setAppStorage, type AppStorage } from "../keating/app-storage";
import { createWebJudgementRuntime } from "../keating/judgement/runtime";
import { createDraftGateJudgementCaller } from "../keating/judgement/draft-gate";

const originalFetch = globalThis.fetch;
let previous: AppStorage | undefined;
try { previous = getAppStorage(); } catch {}
afterEach(() => { globalThis.fetch = originalFetch; setAppStorage(previous!); });
const settings = { backend: "hosted" as const, hostedProvider: "typesafe" as const,
  customModel: "jev-latest", localModelId: "uninstalled", gatewayPath: "/api/judgement" };
const request = { state: "Learner work", questions: { check: { type: "noul" as const, instructions: "Is this correct?" } } };

test("direct runtime reads the separate stored key and reviews without an account grant", async () => {
  let keyRead = "";
  setAppStorage({ providerKeys: { get: async (id: string) => { keyRead = id; return "own-typesafe-key"; } } } as unknown as AppStorage);
  let calls = 0;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    expect(String(url)).toBe("/api/judgement/typesafe");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer own-typesafe-key");
    expect(JSON.parse(init!.body as string).model).toBe("jev-latest");
    return Response.json({ model: "jev-1.13", answers: { check: { noul: .1 } } });
  }) as unknown as typeof fetch;
  const runtime = createWebJudgementRuntime({ settings, calibration: {}, hosted: { accountClient: null } });
  expect(runtime.policy.calibration.entries).toEqual({});
  expect(runtime.judgementModel?.requestTokens).toBe(64_000);
  const result = await createDraftGateJudgementCaller(runtime)(request);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.response.backend).toEqual({ backend: "system-one", model: "jev-1.13", calibrationSha256: null });
  expect(keyRead).toBe("typesafe-judgement");
  expect(calls).toBe(1);
});
test("missing direct key reports authorization without dispatch or account fallback", async () => {
  setAppStorage({ providerKeys: { get: async () => null } } as unknown as AppStorage);
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error("should not run"); }) as unknown as typeof fetch;
  const runtime = createWebJudgementRuntime({ settings, calibration: {}, hosted: { accountClient: null } });
  expect(await createDraftGateJudgementCaller(runtime)(request)).toEqual({ ok: false, error: { code: "backend-unauthorized", retryable: false } });
  expect(calls).toBe(0);
});

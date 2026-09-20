import { expect, test } from "bun:test";
import { createPublicAccountJudgementBackend, judgementAccountStatus, type JudgementAccountClient } from "../keating/judgement/public-account";
import { createWebJudgementRuntime } from "../keating/judgement/runtime";

const request = { state: { learner: { answer: "2x" } }, questions: {
  correct: { type: "noul" as const, instructions: "The learner differentiated x squared correctly.",
    criteria: { true: "Derivative is 2x", false: "Derivative is something else" } },
} };
const response = (model = "jev-1.13") => Response.json({ model, answers: { correct: { noul: .9 } } });

function fixture() {
  let scope = "infer:balanced judgement:evaluate";
  let expiresAt = Date.now() + 300_000;
  const calls: Array<{ path: string; init: RequestInit }> = [];
  const client: JudgementAccountClient = {
    config: { issuer: "https://account.test" },
    getSession: () => ({ accessToken: "opaque-account-capability", scope, expiresAt, returnTo: "/" }),
    request: async (path, init = {}) => { calls.push({ path, init }); return response(); },
  };
  return { client, calls, scope: (value: string) => { scope = value; }, expire: () => { expiresAt = 0; } };
}

test("browser judgement uses the account client, exact route, and intact structured state", async () => {
  const { client, calls } = fixture();
  const backend = createPublicAccountJudgementBackend({ client })!;
  const result = await backend.call(request);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.response.backend).toEqual({ backend: "system-one", model: "jev-1.13", calibrationSha256: null });
  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe("/v1/judgement");
  expect(calls[0].init.redirect).toBe("error");
  const body = JSON.parse(calls[0].init.body as string);
  expect(body.model).toBe("judgement");
  expect(JSON.parse(body.state)).toEqual(request.state);
  expect(body.questions).toEqual(request.questions);
  expect(new Headers(calls[0].init.headers).get("x-notorganic-max-cost-microusd")).toBe("100000");
  expect(JSON.stringify(calls)).not.toContain("opaque-account-capability");
});

test("session authority and expiry are checked again after runtime construction", async () => {
  const f = fixture();
  const backend = createPublicAccountJudgementBackend({ client: f.client })!;
  expect(judgementAccountStatus(f.client)).toEqual({ configured: true, connected: true, judgementAuthorized: true });
  f.scope("infer:balanced");
  expect((await backend.call(request)).ok).toBe(false);
  expect(judgementAccountStatus(f.client).judgementAuthorized).toBe(false);
  f.scope("judgement:evaluate");
  f.expire();
  expect((await backend.call(request)).ok).toBe(false);
  expect(f.calls).toHaveLength(0);
});

test("redirecting the configured issuer after construction cannot move account authority", async () => {
  const f = fixture();
  const backend = createPublicAccountJudgementBackend({ client: f.client })!;
  f.client.config.issuer = "https://other.test";
  expect((await backend.call(request)).ok).toBe(false);
  expect(f.calls).toHaveLength(0);
});

test("hosted runtime consumes the real account boundary only after explicit opt-in", async () => {
  const f = fixture();
  for (const backend of ["local", "off"] as const) {
    const runtime = createWebJudgementRuntime({ settings: { backend, localModelId: "not-installed", gatewayPath: "/api/judgement" },
      hosted: { accountClient: f.client } });
    expect(runtime.policy.tiers.some(tier => tier.key.backend === "system-one")).toBe(false);
  }
  const runtime = createWebJudgementRuntime({ settings: { backend: "hosted", localModelId: "not-installed", gatewayPath: "/api/judgement" },
    hosted: { accountClient: f.client } });
  const hosted = runtime.policy.tiers.find(tier => tier.key.backend === "system-one")!;
  expect((await hosted.call(request)).ok).toBe(true);
  expect(f.calls).toHaveLength(1);
});

test("HTTP retries retain one settlement key, separate judgements receive new keys", async () => {
  const f = fixture();
  const keys: Array<string | null> = [];
  f.client.request = async (_path, init = {}) => {
    keys.push(new Headers(init.headers).get("idempotency-key"));
    return keys.length === 1 ? new Response("private upstream detail", { status: 503 }) : response();
  };
  const backend = createPublicAccountJudgementBackend({ client: f.client, sleep: async () => {} })!;
  expect((await backend.call(request)).ok).toBe(true);
  expect((await backend.call(request)).ok).toBe(true);
  expect(keys).toHaveLength(3);
  expect(keys[0]).toBe(keys[1]);
  expect(keys[2]).not.toBe(keys[0]);
});

test("unresolved model identity and oversized state do not become scored responses", async () => {
  const f = fixture();
  f.client.request = async () => response("jev-latest");
  const backend = createPublicAccountJudgementBackend({ client: f.client })!;
  expect((await backend.call(request)).ok).toBe(false);
  let calls = 0;
  f.client.request = async () => { calls++; return response(); };
  expect((await backend.call({ ...request, state: "x".repeat(96_001) })).ok).toBe(false);
  expect(calls).toBe(0);
});

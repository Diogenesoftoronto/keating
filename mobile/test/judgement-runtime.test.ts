import { afterEach, expect, test } from "bun:test";
import type { JudgementRequest } from "@keating/learner-contracts";
import { createMobileJudgementRuntime } from "../src/lib/judgement/runtime";
import { reviewMobileQuestionChecks } from "../src/lib/judgement/grading";
import { notOrganicJudgementRequest, setAccountFetchForTests } from "../src/lib/notorganic-account/client";
import { clearDeviceSession, saveDeviceSession, setAccountCredentialStoreForTests } from "../src/lib/notorganic-account/credentials";
import { setAccountCryptoAdapterForTests } from "../src/lib/notorganic-account/crypto";
import { setDeviceKeyAdapterForTests } from "../src/lib/notorganic-account/dpop";
import { defaultNotOrganicAccountConfig, mobileJudgementAccountConfig, NOTORGANIC_MOBILE_SCOPE } from "../src/lib/notorganic-account/contracts";
import { DEFAULT_UI_SETTINGS, normalizeUiSettings } from "../src/lib/ui-settings";

const request: JudgementRequest = { state: { answer: { text: "Nested learner answer" } }, questions: { ready: { type: "noul", instructions: "Is it ready?" } } };
function response(model = "jev-1.13.0") { return Response.json({ model, answers: { ready: { type: "noul", noul: 0.9 } } }); }
const config = { ...defaultNotOrganicAccountConfig(), issuer: "https://gateway.test" };
const session = { issuer: config.issuer, accessToken: "private-capability", accessExpiresAt: Date.now() + 60_000,
  refreshToken: "private-refresh", refreshExpiresAt: Date.now() + 600_000, scope: "infer:balanced judgement:evaluate" };

function installAccount() {
  const values = new Map<string, string>();
  setAccountCredentialStoreForTests({ getItem: async key => values.get(key) ?? null, setItem: async (key, value) => { values.set(key, value); }, deleteItem: async key => { values.delete(key); } });
  setAccountCryptoAdapterForTests({ randomBytes: async length => crypto.getRandomValues(new Uint8Array(length)),
    sha256Base64: async value => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("base64") });
  setDeviceKeyAdapterForTests({ getOrCreatePublicJwkAsync: async () => ({ kty: "EC", crv: "P-256", x: "x", y: "y" }),
    signAsync: async () => "signature", deleteKeyAsync: async () => {} });
}
afterEach(() => { setAccountFetchForTests(null); setAccountCredentialStoreForTests(null); setAccountCryptoAdapterForTests(null); setDeviceKeyAdapterForTests(null); });

test("hosted judgement defaults off and its scope is requested only by explicit opt-in", () => {
  expect(DEFAULT_UI_SETTINGS.judgementHosted).toBe(false);
  expect(normalizeUiSettings({ judgementHosted: "yes" }).judgementHosted).toBe(false);
  expect(NOTORGANIC_MOBILE_SCOPE.split(" ")).not.toContain("judgement:evaluate");
  expect(mobileJudgementAccountConfig(config).scope.split(" ")).toEqual([...NOTORGANIC_MOBILE_SCOPE.split(" "), "judgement:evaluate"]);
});

test("mobile account judgement preserves DPoP, exact issuer/path, budget and redirect rejection", async () => {
  installAccount(); await saveDeviceSession(session);
  let calls = 0;
  setAccountFetchForTests((async (url, init) => {
    calls++; expect(url).toBe("https://gateway.test/v1/judgement"); expect(init?.redirect).toBe("error");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("DPoP private-capability");
    expect(headers.get("x-notorganic-max-cost-microusd")).toBe("100000");
    expect(headers.get("idempotency-key")).toStartWith("keating-mobile-judgement-");
    const proof = JSON.parse(Buffer.from(headers.get("dpop")!.split(".")[1], "base64url").toString());
    expect(proof).toMatchObject({ htm: "POST", htu: url }); expect(proof.ath).toBeString();
    return response();
  }) as typeof fetch);
  const runtime = createMobileJudgementRuntime({ hostedEnabled: true, request: (body, signal) => notOrganicJudgementRequest(body, signal, config) });
  expect((await runtime.call(request)).ok).toBe(true); expect(calls).toBe(1);
  for (const next of [{ ...session, issuer: "https://wrong.test" }, { ...session, issuer: undefined }, { ...session, scope: "infer:balanced" }]) {
    await saveDeviceSession(next); expect((await runtime.call(request)).ok).toBe(false);
  }
  expect(calls).toBe(1);
});

test("logout while DPoP is being signed prevents any outgoing authenticated request", async () => {
  installAccount(); await saveDeviceSession(session);
  setDeviceKeyAdapterForTests({ getOrCreatePublicJwkAsync: async () => ({ kty: "EC", crv: "P-256", x: "x", y: "y" }),
    signAsync: async () => { await clearDeviceSession(); return "signature"; }, deleteKeyAsync: async () => {} });
  let calls = 0; setAccountFetchForTests((async () => { calls++; return response(); }) as typeof fetch);
  expect((await notOrganicJudgementRequest("{}", undefined, config)).status).toBe(403); expect(calls).toBe(0);
});

test("runtime preserves nested state, records concrete identity, pins a batch and rechecks consent", async () => {
  let calls = 0; let model = "jev-1.13.0"; let consent = true;
  const runtime = createMobileJudgementRuntime({ hostedEnabled: true, consent: async () => consent, request: async body => {
    calls++; const wire = JSON.parse(body); expect(wire.model).toBe("judgement"); expect(JSON.parse(wire.state)).toEqual(request.state); return response(model);
  } });
  const first = await runtime.call(request); expect(first.ok && first.response.backend).toEqual({ backend: "system-one", model, calibrationSha256: null });
  model = "jev-next"; expect(await runtime.call(request)).toMatchObject({ ok: false, error: { code: "response-malformed" } });
  consent = false; expect((await runtime.call(request)).ok).toBe(false); expect(calls).toBe(2);
  expect((await createMobileJudgementRuntime({ hostedEnabled: false, request: async () => { throw new Error("must not call"); } }).call(request)).ok).toBe(false);
});

test("unknown identity, timeout and over-budget choices cannot produce scores", async () => {
  expect((await createMobileJudgementRuntime({ hostedEnabled: true, request: async () => response("jev-latest") }).call(request)).ok).toBe(false);
  expect(await createMobileJudgementRuntime({ hostedEnabled: true, timeoutMs: 2, request: async () => new Promise(() => {}) }).call(request)).toMatchObject({ ok: false, error: { code: "backend-timeout" } });
  let calls = 0;
  expect((await createMobileJudgementRuntime({ hostedEnabled: true, request: async () => { calls++; return response(); } }).call({ state: "data", questions: { choice: { type: "choice", instructions: "Choose", criteria: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [String(i), null])) } } })).ok).toBe(false);
  expect(calls).toBe(0);
});

test("shared grading keeps semantic estimates separate from pending grades and cites exact evidence", async () => {
  let calls = 0;
  const runtime = createMobileJudgementRuntime({ hostedEnabled: true, request: async body => {
    calls++; const wire = JSON.parse(body); const criteria = wire.questions.score.criteria as string[];
    const options = Object.keys(wire.questions.evidence.criteria); const chosen = options[0];
    return Response.json({ model: "jev-1.13.0", answers: {
      score: { type: "score", score: 4, confidence: 0.99, probabilities: Object.fromEntries(criteria.map((_, i) => [i, i === 4 ? 1 : 0])), legend: Object.fromEntries(criteria.map((label, i) => [i, label])) },
      evidence: { type: "choice", choice: chosen, confidence: 0.99, probabilities: Object.fromEntries(options.map(label => [label, label === chosen ? 1 : 0])) },
    } });
  } });
  const input = { id: "question-1", question: "What is half?", learnerAnswer: "One of two equal parts.", referenceAnswer: "Half of a whole" };
  const [result] = await reviewMobileQuestionChecks([input], runtime);
  expect(result.final).toMatchObject({ grading: "pending", credit: null, source: "proxy" });
  expect(result.proposal).toMatchObject({ backend: { model: "jev-1.13.0", calibrationSha256: null }, evidenceQuote: input.learnerAnswer, verdict: "correct" });
  const [exact] = await reviewMobileQuestionChecks([{ ...input, learnerAnswer: input.referenceAnswer }], runtime);
  expect(exact.final.grading).toBe("auto"); expect(exact.proposal).toBeNull(); expect(calls).toBe(1);
});

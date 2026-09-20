import { test, expect } from "bun:test";
import { webcrypto } from "node:crypto";

import {
  JUDGEMENT_API_KEY_ENV,
  JUDGEMENT_DIRECT_ENV,
  JUDGEMENT_ENDPOINT_ENV,
  JUDGEMENT_MODEL_ENV,
  JUDGEMENT_CALIBRATION_ENV,
  createCliJudgementBackend,
} from "../src/judgement/transport.js";
import { SYSTEM_ONE_ENDPOINT } from "../packages/learner-contracts/src/judgement/wire.js";
import type { FetchLike } from "../packages/learner-contracts/src/judgement/system-one.js";
import { NOTORGANIC_AUTH_ENV } from "../src/core/notorganic-auth.js";
import type { NotOrganicJudgementCredential } from "../src/judgement/notorganic.js";

const REQUEST = {
  state: "learner wrote: the derivative is 2x",
  questions: {
    correct: { type: "noul", instructions: "The learner's work shows a correct result." },
  },
} as const;

interface CapturedCall {
  input: string;
  authorization: string | null;
}

function captureFetch(calls: CapturedCall[]): FetchLike {
  return (async (input, init) => {
    calls.push({
      input,
      authorization: new Headers(init.headers as Record<string, string>).get("authorization"),
    });
    return { ok: false, status: 500, json: async () => ({}) };
  }) as FetchLike;
}

async function callOnce(
  env: Record<string, string | undefined>,
): Promise<{ calls: CapturedCall[]; code: string | null }> {
  const calls: CapturedCall[] = [];
  const backend = createCliJudgementBackend({ env, fetch: captureFetch(calls), retry: { maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 } });
  if (!backend) return { calls, code: null };
  const outcome = await backend.call({ state: REQUEST.state, questions: { ...REQUEST.questions } });
  return { calls, code: outcome.ok ? null : outcome.error.code };
}

test("no configuration resolves to null: the tier abstains", () => {
  expect(createCliJudgementBackend({ env: {} })).toBeNull();
});

test("a bare credential without the direct opt-in resolves to null", () => {
  expect(createCliJudgementBackend({ env: { [JUDGEMENT_API_KEY_ENV]: "key" } })).toBeNull();
  expect(
    createCliJudgementBackend({ env: { [JUDGEMENT_API_KEY_ENV]: "key", [JUDGEMENT_DIRECT_ENV]: "0" } }),
  ).toBeNull();
});

test("direct SystemOne access requires the explicit opt-in", async () => {
  for (const optIn of ["1", "true"]) {
    const { calls } = await callOnce({ [JUDGEMENT_API_KEY_ENV]: "key", [JUDGEMENT_DIRECT_ENV]: optIn });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]?.input).toBe(SYSTEM_ONE_ENDPOINT);
    expect(calls[0]?.authorization).toBe("Bearer key");
  }
});

test("a custom gateway never receives the direct TypeSafe credential", async () => {
  const gateway = "https://gateway.example/v1/judgement";
  const { calls } = await callOnce({
    [JUDGEMENT_ENDPOINT_ENV]: gateway,
    [JUDGEMENT_API_KEY_ENV]: "key",
  });
  expect(calls.length).toBeGreaterThan(0);
  expect(calls[0]?.input).toBe(gateway);
  expect(calls[0]?.authorization).toBeNull();
});

const ISSUER = "https://account.example";
const NOW = 1_800_000_000_000;
async function accountCredential(overrides: Record<string, string> = {}): Promise<NotOrganicJudgementCredential> {
  const key = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return {
    accessToken: "fake-account-token",
    env: {
      [NOTORGANIC_AUTH_ENV.issuer]: ISSUER,
      [NOTORGANIC_AUTH_ENV.privateJwk]: JSON.stringify(await webcrypto.subtle.exportKey("jwk", key.privateKey)),
      [NOTORGANIC_AUTH_ENV.scope]: "infer:balanced judgement:evaluate",
      [NOTORGANIC_AUTH_ENV.tokenType]: "DPoP",
      [NOTORGANIC_AUTH_ENV.expiresAt]: String(NOW + 300_000),
      ...overrides,
    },
  };
}

const success = () => ({ ok: true, status: 200, json: async () => ({ model: "jev-1.13", answers: { correct: { noul: 0.9 } } }) });

test("account judgement signs the exact issuer route and sends alias while preserving concrete identity", async () => {
  const credential = await accountCredential();
  let wire: Parameters<FetchLike> | undefined;
  const backend = createCliJudgementBackend({
    env: { [JUDGEMENT_API_KEY_ENV]: "must-not-leak", [JUDGEMENT_MODEL_ENV]: "jev-1.13", [JUDGEMENT_CALIBRATION_ENV]: "a".repeat(64) },
    cwd: "/fake-workspace", loadCredential: (cwd) => { expect(cwd).toBe("/fake-workspace"); return credential; },
    now: () => NOW,
    fetch: async (...args) => { wire = args; return success(); },
  })!;
  const outcome = await backend.call(REQUEST);
  expect(outcome.ok).toBe(true);
  if (outcome.ok) expect(outcome.response.backend).toEqual({ backend: "system-one", model: "jev-1.13", calibrationSha256: "a".repeat(64) });
  expect(wire![0]).toBe(`${ISSUER}/v1/judgement`);
  const init = wire![1];
  expect(JSON.parse(init.body).model).toBe("judgement");
  expect(init.headers.authorization).toBe("DPoP fake-account-token");
  expect(JSON.stringify(init)).not.toContain("must-not-leak");
  const [header, payload, signature] = init.headers.dpop.split(".");
  const decodedHeader = JSON.parse(Buffer.from(header, "base64url").toString());
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  expect(decodedHeader.jwk.d).toBeUndefined();
  expect(claims.htm).toBe("POST");
  expect(claims.htu).toBe(`${ISSUER}/v1/judgement`);
  expect(claims.ath).toBe(Buffer.from(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(credential.accessToken))).toString("base64url"));
  const publicKey = await webcrypto.subtle.importKey("jwk", decodedHeader.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  expect(await webcrypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, Buffer.from(signature, "base64url"), new TextEncoder().encode(`${header}.${payload}`))).toBe(true);
});

test("account retries renew proof but retain settlement key; a new judgement gets a new key", async () => {
  const calls: Record<string, string>[] = [];
  const backend = createCliJudgementBackend({ env: {}, credential: await accountCredential(), now: () => NOW,
    retry: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 }, sleep: async () => {},
    fetch: async (_url, init) => {
      calls.push(init.headers);
      return calls.length === 1 ? { ok: false, status: 503, json: async () => { throw new Error("must never read error body"); } } : success();
    },
  })!;
  expect((await backend.call(REQUEST)).ok).toBe(true);
  expect(calls[0]["idempotency-key"]).toBe(calls[1]["idempotency-key"]);
  expect(calls[0].dpop).not.toBe(calls[1].dpop);
  await backend.call(REQUEST);
  expect(calls[2]["idempotency-key"]).not.toBe(calls[1]["idempotency-key"]);
});

test("missing, expired, malformed, or inference-only credentials cannot authorize judgement", async () => {
  for (const overrides of [
    { [NOTORGANIC_AUTH_ENV.scope]: "infer:balanced" },
    { [NOTORGANIC_AUTH_ENV.expiresAt]: String(NOW) },
    { [NOTORGANIC_AUTH_ENV.privateJwk]: "bad" },
    { [NOTORGANIC_AUTH_ENV.tokenType]: "Bearer" },
  ]) {
    const fetch: FetchLike = async () => { throw new Error("must not fetch"); };
    expect(createCliJudgementBackend({ env: {}, credential: await accountCredential(overrides), now: () => NOW, fetch })).toBeNull();
  }
  expect(createCliJudgementBackend({ env: {}, cwd: "/fake", loadCredential: () => null })).toBeNull();
});

test("account credentials cannot be redirected to a custom endpoint", async () => {
  for (const endpoint of ["https://attacker.example/v1/judgement", `${ISSUER}/v1/chat/completions`, `${ISSUER}/v1/judgement?x=1`]) {
    expect(createCliJudgementBackend({ env: { [JUDGEMENT_ENDPOINT_ENV]: endpoint }, credential: await accountCredential(), now: () => NOW })).toBeNull();
  }
});

test("account expiry is rechecked at send and raw errors stay private", async () => {
  let now = NOW;
  let sent = false;
  const backend = createCliJudgementBackend({ env: {}, credential: await accountCredential(), now: () => now,
    fetch: async () => { sent = true; return success(); },
  })!;
  now += 300_001;
  const result = await backend.call(REQUEST);
  expect(result).toEqual({ ok: false, error: { code: "backend-unauthorized", retryable: false } });
  expect(sent).toBe(false);
});

test("an unresolved account alias never borrows a calibration pin", async () => {
  const backend = createCliJudgementBackend({ env: { [JUDGEMENT_CALIBRATION_ENV]: "a".repeat(64) }, credential: await accountCredential(), now: () => NOW, fetch: async () => success() })!;
  expect(backend.key.calibrationSha256).toBeNull();
  const outcome = await backend.call(REQUEST);
  expect(outcome.ok).toBe(true);
  if (outcome.ok) expect(outcome.response.backend).toEqual({ backend: "system-one", model: "jev-1.13", calibrationSha256: null });
});

test("account transport preserves nested state as JSON text and leaves named string state intact", async () => {
  const bodies: Array<{ state: unknown; questions: unknown }> = [];
  const backend = createCliJudgementBackend({ env: {}, credential: await accountCredential(), now: () => NOW,
    fetch: async (_url, init) => { bodies.push(JSON.parse(init.body)); return success(); },
  })!;
  const nested = { learner: { answer: "2x", attempts: 2 }, transcript: ["differentiate x squared"] };
  const array = ["learner", { answer: "2x" }];
  const named = { learnerAnswer: "2x", prompt: "differentiate x squared" };
  for (const state of [nested, array, named]) await backend.call({ ...REQUEST, state });
  expect(JSON.parse(bodies[0].state as string)).toEqual(nested);
  expect(JSON.parse(bodies[1].state as string)).toEqual(array);
  expect(bodies[2].state).toEqual(named);
  for (const body of bodies) expect(body.questions).toEqual(REQUEST.questions);
});

test("account criteria ceiling refuses oversized Choices and Scores before signing or sending", async () => {
  let sent = 0;
  const backend = createCliJudgementBackend({ env: {}, credential: await accountCredential(), now: () => NOW,
    fetch: async () => { sent++; return success(); },
  })!;
  const labels = Array.from({ length: 65 }, (_, index) => `candidate-${index}`);
  for (const question of [
    { type: "choice" as const, instructions: "Choose evidence", criteria: Object.fromEntries(labels.map((label) => [label, null])) },
    { type: "score" as const, instructions: "Grade", criteria: labels },
  ]) {
    expect(await backend.call({ state: "example", questions: { correct: question } })).toEqual({ ok: false, error: { code: "request-invalid", retryable: false } });
  }
  expect(sent).toBe(0);
  await backend.call({ state: "example", questions: { correct: { type: "choice", instructions: "Choose evidence", criteria: Object.fromEntries(labels.slice(0, 64).map((label) => [label, null])) } } });
  expect(sent).toBe(1);
});

test("account adaptation preserves Noul pole definitions and nullable Choice descriptions", async () => {
  let sentQuestions: unknown;
  const backend = createCliJudgementBackend({ env: {}, credential: await accountCredential(), now: () => NOW,
    fetch: async (_url, init) => { sentQuestions = JSON.parse(init.body).questions; return success(); },
  })!;
  const questions = {
    correct: { type: "noul" as const, instructions: "Judge the work", criteria: { true: "The work meets the rubric", false: "The work fails the rubric" } },
    move: { type: "choice" as const, instructions: "Classify tutor move", criteria: { explain: null, ask: null } },
  };
  await backend.call({ state: { topic: { name: "calculus" } }, questions });
  expect(sentQuestions).toEqual(questions);
});

test("an endpoint without a credential is the gateway shape: no bearer sent", async () => {
  const gateway = "https://gateway.example/api/notorganic/judgement";
  const { calls } = await callOnce({ [JUDGEMENT_ENDPOINT_ENV]: gateway });
  expect(calls.length).toBeGreaterThan(0);
  expect(calls[0]?.input).toBe(gateway);
  expect(calls[0]?.authorization).toBeNull();
});

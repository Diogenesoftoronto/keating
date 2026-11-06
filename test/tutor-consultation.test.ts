import { expect, test } from "bun:test";
import type { ApiKeyCredential } from "@earendil-works/pi-coding-agent";
import { consultTutorFromCli } from "../src/pi/hyper-teacher/tools/tutor.js";
import { NOTORGANIC_AUTH_ENV } from "../src/core/notorganic-auth.js";
import { TUTOR_CONSULTATION_MODEL, TUTOR_CONSULTATION_SCOPE } from "../shared/tutor-consultation.js";

async function credential(scope = TUTOR_CONSULTATION_SCOPE): Promise<ApiKeyCredential> {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return { type: "api_key", key: "test-account-capability", env: {
    [NOTORGANIC_AUTH_ENV.issuer]: "https://api.notorganic.test",
    [NOTORGANIC_AUTH_ENV.scope]: scope,
    [NOTORGANIC_AUTH_ENV.tokenType]: "DPoP",
    [NOTORGANIC_AUTH_ENV.expiresAt]: String(Date.now() + 300000),
    [NOTORGANIC_AUTH_ENV.privateJwk]: JSON.stringify(await crypto.subtle.exportKey("jwk", keys.privateKey)),
    [NOTORGANIC_AUTH_ENV.maxCostMicrousd]: "100000",
  } };
}

test("CLI consultation signs the exact route with stored scope and cost ceiling", async () => {
  const stored = await credential(); let outbound: Request | undefined;
  const result = await consultTutorFromCli("/unused", { question: "Help me choose a hint." }, undefined, { credential: stored, fetch: (async (input, init) => {
    outbound = new Request(input, init);
    return Response.json({ model: TUTOR_CONSULTATION_MODEL, advice: "Ask the learner to draw the quantities." });
  }) as typeof fetch });
  expect(result).toContain("AMPERSAND TUTOR ADVICE");
  expect(outbound!.url).toBe("https://api.notorganic.test/v1/tutor/consult");
  expect(outbound!.headers.get("authorization")).toBe("DPoP test-account-capability");
  expect(outbound!.headers.get("x-notorganic-max-cost-microusd")).toBe("100000");
  const proof = JSON.parse(Buffer.from(outbound!.headers.get("dpop")!.split(".")[1]!, "base64url").toString());
  expect(proof.htm).toBe("POST"); expect(proof.htu).toBe(outbound!.url); expect(proof.ath).toBeString();
});

test("CLI rejects absent tutor consent, expired capability and cancellation without dispatch", async () => {
  let calls = 0; const fetcher = (async () => { calls++; return Response.json({}); }) as typeof fetch;
  await expect(consultTutorFromCli("/unused", { question: "Hint?" }, undefined, { credential: await credential("infer:balanced"), fetch: fetcher })).rejects.toThrow("consent");
  const expired = await credential(); expired.env![NOTORGANIC_AUTH_ENV.expiresAt] = "1";
  await expect(consultTutorFromCli("/unused", { question: "Hint?" }, undefined, { credential: expired, fetch: fetcher })).rejects.toThrow("expired");
  const signal = AbortSignal.abort();
  await expect(consultTutorFromCli("/unused", { question: "Hint?" }, signal, { credential: await credential(), fetch: fetcher })).rejects.toThrow();
  expect(calls).toBe(0);
});

test("CLI makes one attempt when the gateway fails", async () => {
  let calls = 0;
  await expect(consultTutorFromCli("/unused", { question: "Hint?" }, undefined, { credential: await credential(), fetch: (async () => { calls++; return Response.json({}, { status: 503 }); }) as typeof fetch })).rejects.toThrow("not retried");
  expect(calls).toBe(1);
});

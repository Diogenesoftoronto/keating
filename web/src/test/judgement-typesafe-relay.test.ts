import { afterEach, expect, test } from "bun:test";
import { H3 } from "h3";
import route from "../../server/api/judgement/typesafe.post";
import { createCustomJudgementBackend } from "../keating/judgement/custom-backend";
import { MemoryPublicAbuseStore, setPublicAbuseStoreForTests } from "../../server/utils/public-abuse";

const originalFetch = globalThis.fetch;
const originalRailway = process.env.RAILWAY_ENVIRONMENT_ID;
afterEach(() => {
  globalThis.fetch = originalFetch;
  setPublicAbuseStoreForTests();
  if (originalRailway === undefined) delete process.env.RAILWAY_ENVIRONMENT_ID;
  else process.env.RAILWAY_ENVIRONMENT_ID = originalRailway;
});
const body = { state: { learner: { answer: "2x" } }, model: "jev-latest", questions: {
  correct: { type: "noul", instructions: "The answer is correct." },
} };
function app() { setPublicAbuseStoreForTests(new MemoryPublicAbuseStore()); return new H3().post("/api/judgement/typesafe", route); }
function call(server: H3, headers: Record<string, string> = {}, input: unknown = body, requestOrigin = "https://keating.test") {
  return server.fetch(new Request(new URL("/api/judgement/typesafe", requestOrigin), { method: "POST",
    headers: { "content-type": "application/json", origin: "https://keating.test", authorization: "Bearer private-user-key", ...headers },
    body: JSON.stringify(input),
  }));
}
test("relay forwards only the user's key to the fixed TypeSafe endpoint and preserves selected model", async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    seen = { url: String(url), init: init! };
    return Response.json({ model: "jev-1.13", answers: { correct: { noul: .9 } }, usage: { input_tokens: 10, output_tokens: 1 }, extra: "must-not-propagate" });
  }) as unknown as typeof fetch;
  const response = await call(app(), {}, { ...body, extra: "local-only" });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(seen!.url).toBe("https://api.typesafe.ai/v1/systemone");
  expect(new Headers(seen!.init.headers).get("authorization")).toBe("Bearer private-user-key");
  expect(seen!.init.redirect).toBe("error");
  const sent = JSON.parse(seen!.init.body as string);
  expect(sent).toEqual(body);
  const result = await response.json();
  expect(result.model).toBe("jev-1.13");
  expect(JSON.stringify(result)).not.toMatch(/private-user-key|must-not-propagate/);
});
test("TypeSafe receives original JSON arrays and plain strings, including strings that look like JSON", async () => {
  const states = [[{ attempt: 1, evidence: ["2x"] }], '{"learner":{"answer":"2x"}}'];
  const sent: unknown[] = [];
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    sent.push(JSON.parse(init!.body as string).state);
    return Response.json({ model: "jev-1.13", answers: {} });
  }) as unknown as typeof fetch;
  const server = app();
  for (const state of states) expect((await call(server, {}, { ...body, state })).status).toBe(200);
  expect(sent).toEqual(states);
});
test("cross-origin, missing credentials and invalid bodies never dispatch", async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({}); }) as unknown as typeof fetch;
  const server = app();
  const deniedOrigin = await call(server, { origin: "https://evil.test" });
  expect(deniedOrigin.status).toBe(403);
  expect(deniedOrigin.headers.get("x-keating-judgement-error")).toBe("relay-origin-denied");
  const missingKey = await call(server, { authorization: "" });
  expect(missingKey.status).toBe(401);
  expect(missingKey.headers.has("x-keating-judgement-error")).toBe(false);
  expect((await call(server, {}, { ...body, model: "bad\nmodel" })).status).toBe(422);
  expect((await call(server, {}, { ...body, questions: {} })).status).toBe(422);
  expect((await call(server, {}, { ...body, state: 42 })).status).toBe(422);
  expect((await call(server, {}, { ...body, state: { text: "x".repeat(96_001) } })).status).toBe(422);
  expect(calls).toBe(0);
});
test("Railway TLS termination preserves the public browser origin on production and staging", async () => {
  process.env.RAILWAY_ENVIRONMENT_ID = "test-environment";
  const server = app();
  let dispatches = 0;
  globalThis.fetch = (async () => {
    dispatches++;
    return Response.json({ model: "jev-1.13", answers: {} });
  }) as unknown as typeof fetch;

  for (const host of ["chat.keating.help", "keating-staging.up.railway.app"]) {
    const headers = { origin: `https://${host}`, "x-forwarded-proto": "https" };
    const internal = `http://${host}`;
    expect((await call(server, { ...headers, authorization: "" }, body, internal)).status).toBe(401);
    expect((await call(server, headers, body, internal)).status).toBe(200);
  }
  expect(dispatches).toBe(2);
});
test("the HTTPS edge indication cannot change the request authority or downgrade a direct HTTPS origin", async () => {
  process.env.RAILWAY_ENVIRONMENT_ID = "test-environment";
  const server = app();
  const internal = "http://keating.test";
  const publicOrigin = "https://keating.test";
  const headers = { origin: publicOrigin, "x-forwarded-proto": "https", authorization: "" };
  const invalidHeaders = [
    { ...headers, origin: "https://another.test", "x-forwarded-host": "another.test" },
    { ...headers, origin: "https://keating.test:8443", "x-forwarded-port": "8443" },
    { ...headers, origin: "null" },
    { ...headers, origin: internal },
    { ...headers, "x-forwarded-proto": "" },
    { ...headers, "x-forwarded-proto": "https, http" },
  ];
  for (const invalid of invalidHeaders) {
    expect((await call(server, invalid, body, internal)).status).toBe(403);
  }
  expect((await call(server, { ...headers, origin: internal, "x-forwarded-proto": "http" }, body, publicOrigin)).status).toBe(403);

  delete process.env.RAILWAY_ENVIRONMENT_ID;
  expect((await call(server, headers, body, internal)).status).toBe(403);
  expect((await call(server, { ...headers, origin: internal }, body, internal)).status).toBe(401);
});
test("payment and auth failures retain status without forwarding private upstream errors", async () => {
  const server = app();
  for (const status of [401, 402, 403, 429, 503]) {
    globalThis.fetch = (async () => new Response("secret raw key and learner text", {
      status, headers: { "x-keating-judgement-error": "relay-origin-denied" },
    })) as unknown as typeof fetch;
    const response = await call(server);
    expect(response.status).toBe(status);
    expect(response.headers.has("x-keating-judgement-error")).toBe(false);
    const result = await response.text();
    expect(result).not.toContain("secret raw key");
    if (status === 402) expect(result).toContain("backend-payment-required");
  }
});

test("the TypeSafe error reason crosses the actual BYOK relay and browser caller without echoing text", async () => {
  const server = app();
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return Response.json({ detail: { error_type: "max_tokens_exceeded", input: "private upstream echo" } }, { status: 400 });
  }) as unknown as typeof fetch;
  const tier = createCustomJudgementBackend({ model: body.model, apiKey: "private-user-key", fetch: async (url, init) => {
    const response = await server.fetch(new Request(new URL(url, "https://keating.test"), init));
    expect(response.status).toBe(400);
    expect(await response.clone().json()).toEqual({ error: { code: "context-limit-exceeded" } });
    return response;
  } })!;
  expect(await tier.call({ state: body.state, questions: { correct: { type: "noul", instructions: "Is it correct?" } } }))
    .toEqual({ ok: false, error: { code: "context-limit-exceeded", retryable: false } });
  expect(calls).toBe(1);
});

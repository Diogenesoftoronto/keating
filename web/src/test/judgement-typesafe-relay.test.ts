import { afterEach, expect, test } from "bun:test";
import { H3 } from "h3";
import route from "../../server/api/judgement/typesafe.post";
import { MemoryPublicAbuseStore, setPublicAbuseStoreForTests } from "../../server/utils/public-abuse";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; setPublicAbuseStoreForTests(); });
const body = { state: { learner: { answer: "2x" } }, model: "jev-latest", questions: {
  correct: { type: "noul", instructions: "The answer is correct." },
} };
function app() { setPublicAbuseStoreForTests(new MemoryPublicAbuseStore()); return new H3().post("/api/judgement/typesafe", route); }
function call(server: H3, headers: Record<string, string> = {}, input: unknown = body) {
  return server.fetch(new Request("https://keating.test/api/judgement/typesafe", { method: "POST",
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
  const response = await call(app());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(seen!.url).toBe("https://api.typesafe.ai/v1/systemone");
  expect(new Headers(seen!.init.headers).get("authorization")).toBe("Bearer private-user-key");
  expect(seen!.init.redirect).toBe("error");
  const sent = JSON.parse(seen!.init.body as string);
  expect(sent.model).toBe("jev-latest");
  expect(JSON.parse(sent.state)).toEqual(body.state);
  const result = await response.json();
  expect(result.model).toBe("jev-1.13");
  expect(JSON.stringify(result)).not.toMatch(/private-user-key|must-not-propagate/);
});
test("cross-origin, missing credentials and invalid bodies never dispatch", async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({}); }) as unknown as typeof fetch;
  const server = app();
  expect((await call(server, { origin: "https://evil.test" })).status).toBe(403);
  expect((await call(server, { authorization: "" })).status).toBe(401);
  expect((await call(server, {}, { ...body, model: "bad\nmodel" })).status).toBe(422);
  expect((await call(server, {}, { ...body, questions: {} })).status).toBe(422);
  expect(calls).toBe(0);
});
test("payment and auth failures retain status without forwarding private upstream errors", async () => {
  const server = app();
  for (const status of [401, 402, 429, 503]) {
    globalThis.fetch = (async () => new Response("secret raw key and learner text", { status })) as unknown as typeof fetch;
    const response = await call(server);
    expect(response.status).toBe(status);
    const result = await response.text();
    expect(result).not.toContain("secret raw key");
    if (status === 402) expect(result).toContain("backend-payment-required");
  }
});

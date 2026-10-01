import { afterEach, expect, test } from "bun:test";
import { H3 } from "h3";
import oauthLimits from "../../server/middleware/public-oauth-limits";
import { MemoryPublicAbuseStore, setPublicAbuseStoreForTests } from "../../server/utils/public-abuse";
import token from "../../server/api/oauth/token";
import refresh from "../../server/api/oauth/refresh";
import codexPoll from "../../server/api/oauth/openai-codex-poll";
import copilotPoll from "../../server/api/oauth/github-copilot-poll";

const originalTrust = process.env.KEATING_ABUSE_TRUST_PROXY_IP;
afterEach(() => {
  if (originalTrust === undefined) delete process.env.KEATING_ABUSE_TRUST_PROXY_IP;
  else process.env.KEATING_ABUSE_TRUST_PROXY_IP = originalTrust;
  setPublicAbuseStoreForTests();
});
function setup() {
  process.env.KEATING_ABUSE_TRUST_PROXY_IP = "true";
  setPublicAbuseStoreForTests(new MemoryPublicAbuseStore());
  return new H3().use(oauthLimits);
}
function call(app: H3, path: string, ip = "192.0.2.1", method = "POST", body?: string, extra?: Record<string, string>) {
  return app.fetch(new Request(`https://keating.test${path}`, { method, headers: { "x-real-ip": ip, "content-type": "application/json", ...extra }, ...(body === undefined ? {} : { body }) }));
}

test("OAuth allowance is aggregated across exact routes and independent per client", async () => {
  const app = setup().all("/**", () => ({ ok: true }));
  for (let index = 0; index < 120; index++) expect((await call(app, index % 2 ? "/api/oauth/token" : "/api/oauth/refresh")).status).toBe(200);
  const limited = await call(app, "/api/oauth/openai-codex/poll");
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  expect((await call(app, "/api/oauth/token", "192.0.2.2")).status).toBe(200);
  for (const path of ["/chat", "/assets/example.js", "/api/oauth/unknown", "/api/oauth/token/extra"]) expect((await call(app, path)).status).toBe(200);
  expect((await call(app, "/api/oauth/token", "192.0.2.1", "GET")).status).toBe(200);
});

test("legacy GitHub device GET work shares OAuth admission budget", async () => {
  const app = setup().all("/**", () => ({ ok: true }));
  for (let index = 0; index < 120; index++) expect((await call(app, "/api/oauth/github-copilot/device", "192.0.2.1", "GET")).status).toBe(200);
  expect((await call(app, "/api/oauth/github-copilot/poll", "192.0.2.1", "POST", "{}")).status).toBe(429);
});

test("global OAuth allowance cannot be multiplied by changing clients", async () => {
  const app = setup().all("/**", () => ({ ok: true }));
  for (let index = 0; index < 1200; index++) {
    const response = await call(app, "/api/oauth/token", `192.0.2.${Math.floor(index / 120) + 1}`);
    if (response.status !== 200) throw new Error(`Unexpected admission status ${response.status}`);
  }
  const response = await call(app, "/api/oauth/refresh", "192.0.2.11");
  expect(response.status).toBe(429);
  expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
});

test("middleware rejects oversized declarations without consuming normal bodies", async () => {
  const app = setup().post("/api/oauth/token", async event => ({ value: await event.req.json() }));
  const response = await call(app, "/api/oauth/token", "192.0.2.1", "POST", "{\"code\":\"retained\"}");
  expect(await response.json()).toEqual({ value: { code: "retained" } });
  expect((await call(app, "/api/oauth/token", "192.0.2.1", "POST", "{}", { "content-length": "32769" })).status).toBe(413);
});

test("OAuth body-reading handlers bound chunked bytes before provider operations", async () => {
  const app = setup()
    .post("/api/oauth/token", token)
    .post("/api/oauth/refresh", refresh)
    .post("/api/oauth/openai-codex/poll", codexPoll)
    .post("/api/oauth/github-copilot/poll", copilotPoll);
  for (const path of ["/api/oauth/token", "/api/oauth/refresh", "/api/oauth/openai-codex/poll", "/api/oauth/github-copilot/poll"]) {
    expect((await call(app, path, "192.0.2.1", "POST", "x".repeat(32769))).status).toBe(413);
    expect((await call(app, path, "192.0.2.1", "POST", "{}")).status).toBe(400);
  }
});

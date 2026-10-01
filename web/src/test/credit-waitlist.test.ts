import { expect, test } from "bun:test";
import { createWaitlistRateLimiter, joinCreditWaitlist } from "../../server/utils/credit-waitlist";
import { H3 } from "h3";
import waitlistRoute from "../../server/api/credit-waitlist/index.post";
import { MemoryPublicAbuseStore, setPublicAbuseStoreForTests } from "../../server/utils/public-abuse";
const body = { email: "Learner@example.com", packId: "keating_pack_25", consent: true, website: "" };
const request = (value: unknown = body, origin = "https://keating.test") => new Request("https://keating.test/api/credit-waitlist", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(value) });
function fixture(responses: Array<[number, unknown]>) {
  const calls: Array<{ path: string; method?: string; body: any; key: string | null }> = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => { calls.push({ path: String(input), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : null, key: new Headers(init?.headers).get("Idempotency-Key") }); const next = responses.shift(); if (!next) throw new Error("Unexpected provider request"); return Response.json(next[1], { status: next[0] }); }) as unknown as typeof fetch;
  return { calls, options: { apiKey: "test-only", segmentId: "waitlist", from: "Keating <hello@keating.test>", fetcher, sleep: async () => {} } };
}
test("saves contact and segment before sending confirmation", async () => {
  const f = fixture([[404, {}], [200, { id: "contact" }], [200, { data: [] }], [200, { id: "membership" }], [200, { id: "email" }]]);
  expect(await joinCreditWaitlist(request(), f.options)).toEqual({ joined: true, confirmation: "sent" });
  expect(f.calls.map(c => c.path.replace("https://api.resend.com", ""))).toEqual(["/contacts/learner%40example.com", "/contacts", "/contacts/contact/segments?limit=100", "/contacts/contact/segments/waitlist", "/emails"]);
  expect(f.calls[1].body.email).toBe("learner@example.com");
  expect(f.calls[4].key).toMatch(/^credit-waitlist\/[a-f0-9]{64}$/);
});
test("existing member does not send another confirmation", async () => {
  const f = fixture([[200, { id: "contact", unsubscribed: false }], [200, { data: [{ id: "waitlist" }] }]]);
  expect(await joinCreditWaitlist(request(), f.options)).toEqual({ joined: true, confirmation: "already_registered" }); expect(f.calls).toHaveLength(2);
});
test("provider persistence failure never claims joined or sends email", async () => {
  const f = fixture([[200, { id: "contact" }], [200, { data: [] }], [400, {}]]);
  await expect(joinCreditWaitlist(request(), f.options)).rejects.toMatchObject({ statusCode: 503 }); expect(f.calls).toHaveLength(3);
});
test("confirmation outage retains saved signup and retries with same key", async () => {
  const f = fixture([[200, { id: "contact" }], [200, { data: [] }], [200, {}], [500, {}], [429, {}], [500, {}]]);
  expect(await joinCreditWaitlist(request(), f.options)).toEqual({ joined: true, confirmation: "unavailable" });
  expect(new Set(f.calls.slice(3).map(c => c.key)).size).toBe(1);
});
test("validation, consent, honeypot, origin and missing config fail before provider", async () => {
  const f = fixture([]);
  for (const invalid of [{ ...body, email: "bad" }, { ...body, consent: false }, { ...body, website: "bot" }, { ...body, packId: "fake" }]) await expect(joinCreditWaitlist(request(invalid), f.options)).rejects.toMatchObject({ statusCode: 400 });
  await expect(joinCreditWaitlist(request(body, "https://other.test"), f.options)).rejects.toMatchObject({ statusCode: 403 });
  await expect(joinCreditWaitlist(request(), {})).rejects.toMatchObject({ statusCode: 503 }); expect(f.calls).toHaveLength(0);
});
test("existing email opt-out is preserved", async () => { const f = fixture([[200, { id: "contact", unsubscribed: true }]]); await expect(joinCreditWaitlist(request(), f.options)).rejects.toMatchObject({ statusCode: 409 }); expect(f.calls).toHaveLength(1); });
test("oversized stream is rejected before provider", async () => { const f = fixture([]); await expect(joinCreditWaitlist(request({ ...body, email: "x".repeat(3000) }), f.options)).rejects.toMatchObject({ statusCode: 413 }); });
test("limiter allows five requests per identity and resets after window", () => { let now = 0; const limit = createWaitlistRateLimiter(() => now); for (let i = 0; i < 5; i++) limit("ip"); expect(() => limit("ip")).toThrow("Too many attempts"); expect(() => limit("other")).not.toThrow(); now += 900_001; expect(() => limit("ip")).not.toThrow(); });

test("rate limiting uses the validated normalized email before provider access", async () => {
  const identities: string[] = [];
  const f = fixture([]);
  await expect(joinCreditWaitlist(request(), { ...f.options, limitEmail: identity => { identities.push(identity); throw new Error("limited"); } })).rejects.toThrow("limited");
  expect(identities).toEqual(["learner@example.com"]);
  expect(f.calls).toHaveLength(0);
});

test("daily send ceiling preserves signup without calling the email provider", async () => {
  const f = fixture([[200, { id: "contact" }], [200, { data: [] }], [200, {}]]);
  let reservations = 0;
  const result = await joinCreditWaitlist(request(), { ...f.options, reserveConfirmationSend: async () => { reservations++; throw Object.assign(new Error("Daily ceiling"), { statusCode: 429 }); } });
  expect(result).toEqual({ joined: true, confirmation: "unavailable" });
  expect(reservations).toBe(1);
  expect(f.calls.map(call => call.path)).not.toContain("https://api.resend.com/emails");
  expect(f.calls.at(-1)?.path).toEndWith("/segments/waitlist");
});

test("existing membership does not reserve daily email quota", async () => {
  const f = fixture([[200, { id: "contact" }], [200, { data: [{ id: "waitlist" }] }]]);
  expect(await joinCreditWaitlist(request(), { ...f.options, reserveConfirmationSend: async () => { throw new Error("Must not reserve"); } })).toEqual({ joined: true, confirmation: "already_registered" });
});

test("async email admission is awaited before accessing provider", async () => {
  const f = fixture([]);
  await expect(joinCreditWaitlist(request(), { ...f.options, limitEmail: async () => { await Promise.resolve(); throw Object.assign(new Error("limited"), { statusCode: 429 }); } })).rejects.toMatchObject({ statusCode: 429 });
  expect(f.calls).toHaveLength(0);
});

test("email operation lease is released on provider failure", async () => {
  const f = fixture([[200, { id: "contact" }], [200, { data: [] }], [400, {}]]);
  let releases = 0;
  await expect(joinCreditWaitlist(request(), { ...f.options, acquireEmail: async email => { expect(email).toBe("learner@example.com"); return async () => { releases++; }; } })).rejects.toMatchObject({ statusCode: 503 });
  expect(releases).toBe(1);
});

test("send reservation happens after membership and is retained across retries", async () => {
  const f = fixture([[200, { id: "contact" }], [200, { data: [] }], [200, {}], [500, {}], [200, { id: "email" }]]);
  let reservations = 0;
  expect(await joinCreditWaitlist(request(), { ...f.options, reserveConfirmationSend: async () => { expect(f.calls).toHaveLength(3); reservations++; } })).toEqual({ joined: true, confirmation: "sent" });
  expect(reservations).toBe(1);
});

test("HTTP waitlist rate limits clients independently and preserves body errors", async () => {
  const oldTrust = process.env.KEATING_ABUSE_TRUST_PROXY_IP;
  process.env.KEATING_ABUSE_TRUST_PROXY_IP = "true";
  setPublicAbuseStoreForTests(new MemoryPublicAbuseStore());
  const app = new H3().post("/api/credit-waitlist", waitlistRoute);
  const call = (ip: string, value = "{}") => app.fetch(new Request("https://keating.test/api/credit-waitlist", { method: "POST", headers: { origin: "https://keating.test", "content-type": "application/json", "x-real-ip": ip }, body: value }));
  try {
    for (let attempt = 0; attempt < 10; attempt++) expect((await call("192.0.2.1")).status).toBe(400);
    const limited = await call("192.0.2.1");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await call("192.0.2.2")).status).toBe(400);
    expect((await call("192.0.2.3", "x".repeat(2049))).status).toBe(413);
  } finally {
    if (oldTrust === undefined) delete process.env.KEATING_ABUSE_TRUST_PROXY_IP;
    else process.env.KEATING_ABUSE_TRUST_PROXY_IP = oldTrust;
    setPublicAbuseStoreForTests();
  }
});

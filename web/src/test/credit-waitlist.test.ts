import { expect, test } from "bun:test";
import { createWaitlistRateLimiter, joinCreditWaitlist } from "../../server/utils/credit-waitlist";
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

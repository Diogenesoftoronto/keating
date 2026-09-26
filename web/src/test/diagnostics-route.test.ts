import { expect, test } from "bun:test";
import { H3 } from "h3";
import diagnostics from "../../server/api/diagnostics/report.post";
import { createWaitlistRateLimiter } from "../../server/utils/credit-waitlist";

test("public diagnostics throttles email and log delivery before accepting more reports", async () => {
 const app = new H3().post("/api/diagnostics/report", diagnostics);
 const originalFetch = globalThis.fetch;
 const originalWarn = console.warn;
 const names = ["RESEND_API_KEY", "KEATING_DIAGNOSTICS_FROM", "KEATING_DIAGNOSTICS_TO"] as const;
 const previous = names.map(name => process.env[name]);
 let emails = 0;
 let logs = 0;
 try {
  process.env.RESEND_API_KEY = "test-only";
  process.env.KEATING_DIAGNOSTICS_FROM = "support@example.test";
  process.env.KEATING_DIAGNOSTICS_TO = "support@example.test";
  globalThis.fetch = Object.assign(
   async () => { emails++; return Response.json({ id: "test" }); },
   { preconnect: originalFetch.preconnect },
  ) as typeof fetch;
  console.warn = () => { logs++; };
  const send = () => app.request("https://keating.test/api/diagnostics/report", {
   method: "POST", headers: { "content-type": "application/json" },
   body: JSON.stringify({ summary: "Failure", report: "sanitized report" }),
  });
  for (let i = 0; i < 15; i++) expect((await send()).status).toBe(200);
  delete process.env.RESEND_API_KEY;
  for (let i = 0; i < 15; i++) expect((await send()).status).toBe(200);
  const rejected = await Promise.all(Array.from({ length: 5 }, send));
  for (const response of rejected) {
   expect(response.status).toBe(429);
   expect(response.headers.get("retry-after")).toBe("900");
  }
  expect(emails).toBe(15);
  expect(logs).toBe(15);
 } finally {
  globalThis.fetch = originalFetch;
  console.warn = originalWarn;
  names.forEach((name, index) => {
   if (previous[index] === undefined) delete process.env[name];
   else process.env[name] = previous[index];
  });
 }
});

test("diagnostics budget becomes available after the throttle window", () => {
 let now = 0;
 const limit = createWaitlistRateLimiter(() => now, 30);
 for (let i = 0; i < 30; i++) limit("public-diagnostics");
 expect(() => limit("public-diagnostics")).toThrow("Too many attempts");
 now = 15 * 60_000;
 expect(() => limit("public-diagnostics")).not.toThrow();
});

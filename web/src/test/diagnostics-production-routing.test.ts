import { expect, test } from "bun:test";
import { H3 } from "h3";
import config from "../../nitro.config";
import diagnostics from "../../server/api/diagnostics/report.post";
import notFound from "../../server/api-not-found";
import { MemoryPublicAbuseStore, setPublicAbuseStoreForTests } from "../../server/utils/public-abuse";

// Mount from production declarations, including the competing API fallback.
// Importing the handler directly without this mapping hid the missing route.
const app = new H3();
for (const route of config.handlers ?? []) {
  if (route.handler === "server/api-not-found.ts" && route.route) {
    app.all(route.route, notFound);
  }
  if (route.handler === "server/api/diagnostics/report.post.ts" && route.route) {
    expect(route.method).toBe("POST");
    app.post(route.route, diagnostics);
  }
}

test("production diagnostics POST reaches validation ahead of the API fallback without sending mail", async () => {
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  try {
    setPublicAbuseStoreForTests(new MemoryPublicAbuseStore());
    globalThis.fetch = Object.assign(async () => {
      fetches++;
      throw new Error("Invalid diagnostics must not contact an email provider");
    }, { preconnect: originalFetch.preconnect }) as typeof fetch;
    const response = await app.request("http://keating.test/api/diagnostics/report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(fetches).toBe(0);
  } finally {
    setPublicAbuseStoreForTests();
    globalThis.fetch = originalFetch;
  }
});

test("production diagnostics does not accept GET or unknown API paths", async () => {
  for (const path of ["/api/diagnostics/report", "/api/diagnostics/missing"]) {
    const response = await app.request(`http://keating.test${path}`);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
  }
});

import { expect, test } from "bun:test";
import { probeDecisionRelay } from "../scripts/openui-diagnostics/probe-decision-relay.js";

test("the readiness probe sends an empty same-origin request without a learner or key", async () => {
  const result = await probeDecisionRelay("https://chat.example.org/chat", async (url, init) => {
    expect(url.href).toBe("https://chat.example.org/api/judgement/typesafe");
    expect(new Headers(init.headers).get("origin")).toBe("https://chat.example.org");
    expect(new Headers(init.headers).has("authorization")).toBe(false);
    expect(init.credentials).toBe("omit");
    expect(init.redirect).toBe("manual");
    expect(init.body).toBe("{}");
    return new Response(null, { status: 401 });
  });
  expect(result).toEqual({ origin: "https://chat.example.org", status: 401, reachedKeyCheck: true });
});

test.each([200, 302, 403, 503])("HTTP %d does not verify the relay's key check", async status => {
  const result = await probeDecisionRelay("https://staging.example.org", async () => new Response(null, { status }));
  expect(result.reachedKeyCheck).toBe(false);
  expect(result.status).toBe(status);
});

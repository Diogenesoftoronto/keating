import { describe, expect, test } from "bun:test";
import { mockEvent } from "h3";
import handler, { checkoutReturnUrl } from "../../server/api/notorganic/provider/[resource]";

describe("checkout return origins", () => {
  test("retains the signed-in apex, chat, or explicitly configured staging origin", () => {
    for (const origin of ["https://keating.help", "https://chat.keating.help"]) {
      const url = `${origin}/pricing?checkout=returned`;
      expect(checkoutReturnUrl(url, "")).toBe(url);
    }
    const staging = "https://keating-staging.up.railway.app";
    expect(checkoutReturnUrl(`${staging}/pricing?checkout=returned`, ` ${staging},https://preview.example `))
      .toBe(`${staging}/pricing?checkout=returned`);
  });

  test("rejects unapproved hosts, schemes, credentials, ports, and malformed URLs", () => {
    for (const url of [
      "https://unapproved.up.railway.app/pricing",
      "https://chat.keating.help.evil.test/pricing",
      "https://keating.help@evil.test/pricing",
      "https://user:password@keating.help/pricing",
      "http://chat.keating.help/pricing",
      "javascript:alert(1)",
      "https://chat.keating.help:444/pricing",
      "/pricing?checkout=returned",
    ]) {
      expect(() => checkoutReturnUrl(url, "")).toThrow();
    }
  });

  test("invalid deployment configuration never broadens the allowlist", () => {
    for (const configured of [
      "https://*.up.railway.app",
      "https://staging.example/path",
      "https://staging.example/",
      "https://user:password@staging.example",
      "http://staging.example",
      "not a URL",
    ]) {
      expect(() => checkoutReturnUrl("https://staging.example/pricing", configured)).toThrow();
    }
  });

  test("the server validates before posting checkout and ignores forged request hosts", async () => {
    const names = ["NOTORGANIC_ENABLED", "NOTORGANIC_ISSUER", "NOTORGANIC_MAX_COST_MICROUSD", "NOTORGANIC_CHECKOUT_RETURN_ORIGINS"] as const;
    const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
    const originalFetch = globalThis.fetch;
    const bodies: unknown[] = [];
    process.env.NOTORGANIC_ENABLED = "true";
    process.env.NOTORGANIC_ISSUER = "https://provider.test";
    process.env.NOTORGANIC_MAX_COST_MICROUSD = "75000";
    process.env.NOTORGANIC_CHECKOUT_RETURN_ORIGINS = "https://staging.example";
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ url: "https://checkout.test/session" });
    }) as typeof fetch;
    const request = (returnUrl: string) => {
      const event = mockEvent(new Request("https://evil.test/api/notorganic/provider/checkout", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-host": "evil.test" },
        body: JSON.stringify({ pack_id: "keating_pack_25", return_url: returnUrl }),
      }));
      event.context.params = { resource: "checkout" };
      event.context.notOrganicSessionAdapter = {
        getProductSession: async () => ({ accountId: "did:plc:test", accessToken: "test-capability", createDpopProof: async () => "test-proof" }),
      };
      return handler(event);
    };
    try {
      await expect(request("https://evil.test/pricing")).rejects.toMatchObject({ statusCode: 400 });
      await expect(request("not a URL")).rejects.toMatchObject({ statusCode: 400 });
      expect(bodies).toHaveLength(0);
      for (const origin of ["https://chat.keating.help", "https://staging.example"]) {
        await request(`${origin}/pricing?checkout=returned`);
        expect(bodies.at(-1)).toEqual({ pack_id: "keating_pack_25", return_url: `${origin}/pricing?checkout=returned` });
      }
    } finally {
      globalThis.fetch = originalFetch;
      for (const name of names) {
        if (previous[name] === undefined) delete process.env[name];
        else process.env[name] = previous[name];
      }
    }
  });
});

import { describe, expect, test } from "bun:test";
import { checkoutSelection, KEATING_PERSONAL_PLAN, subscriptionAvailable, subscriptionCheckoutEnabled } from "../notorganic-provider/plans";
import { normalizeCreditWallet } from "../notorganic-provider/credit-wallet";
import { createNotOrganicSubscriptionCheckout } from "../notorganic-provider";

const enabled = { VITE_NOTORGANIC_CHECKOUT_ENABLED: "true", VITE_NOTORGANIC_SUBSCRIPTION_CATALOG: "keating_v2" };
describe("Keating subscription checkout", () => {
  test("only permits the new retail plan with explicit launch configuration", () => {
    expect(KEATING_PERSONAL_PLAN).toMatchObject({ id: "keating_personal_v2", priceUsdMonthly: 25, monthlyCreditUsd: 5, creditRolloverMonths: 1 });
    expect(subscriptionCheckoutEnabled({})).toBe(false);
    expect(subscriptionCheckoutEnabled({ VITE_NOTORGANIC_CHECKOUT_ENABLED: "true" })).toBe(false);
    expect(subscriptionCheckoutEnabled(enabled)).toBe(true);
    expect(() => checkoutSelection({ plan_id: "keating_personal_v2" }, false)).toThrow();
    expect(() => checkoutSelection({ plan_id: "keating_personal" }, true)).toThrow();
    expect(() => checkoutSelection({ plan_id: KEATING_PERSONAL_PLAN.id, pack_id: "keating_pack_25" }, true)).toThrow();
    expect(checkoutSelection({ pack_id: "keating_pack_25" }, false)).toEqual({ pack_id: "keating_pack_25" });
  });
  test("does not treat a pack mapping as a subscription mapping", () => {
    const wallet = normalizeCreditWallet({ availableMicros: 0, checkout: { available: true, packIds: [KEATING_PERSONAL_PLAN.id] } });
    expect(subscriptionAvailable(wallet, true)).toBe(false);
    expect(subscriptionAvailable(undefined, true)).toBe(false);
  });
  test("verifies the wallet before posting plan_id and never sends pack_id", async () => {
    const bodies: unknown[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("wallet")) return Response.json({ availableMicros: 0, checkout: { available: true, planIds: [KEATING_PERSONAL_PLAN.id] } });
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ url: "https://checkout.test/subscription" });
    }) as typeof fetch;
    await createNotOrganicSubscriptionCheckout(KEATING_PERSONAL_PLAN.id, "https://keating.help/pricing", fetcher, enabled);
    expect(bodies).toEqual([{ plan_id: KEATING_PERSONAL_PLAN.id, return_url: "https://keating.help/pricing" }]);
    await expect(createNotOrganicSubscriptionCheckout(KEATING_PERSONAL_PLAN.id, "https://keating.help/pricing", fetcher, {})).rejects.toThrow();
    await expect(createNotOrganicSubscriptionCheckout(KEATING_PERSONAL_PLAN.id, "http://keating.help/pricing", fetcher, enabled)).rejects.toThrow();
    const unmapped = (async (_input: RequestInfo | URL) => Response.json({ availableMicros: 0, checkout: { available: true, packIds: [KEATING_PERSONAL_PLAN.id] } })) as typeof fetch;
    await expect(createNotOrganicSubscriptionCheckout(KEATING_PERSONAL_PLAN.id, "https://keating.help/pricing", unmapped, enabled)).rejects.toThrow();
  });
});

test("Nitro independently requires the plan flag and provider mapping", async () => {
  const { mockEvent } = await import("h3");
  const handler = (await import("../../server/api/notorganic/provider/[resource]")).default;
  const previous = { enabled: process.env.NOTORGANIC_ENABLED, issuer: process.env.NOTORGANIC_ISSUER, plans: process.env.NOTORGANIC_SUBSCRIPTION_CATALOG, cost: process.env.NOTORGANIC_MAX_COST_MICROUSD };
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: unknown }> = [];
  let mapped = true;
  process.env.NOTORGANIC_MAX_COST_MICROUSD = "75000";
  process.env.NOTORGANIC_ENABLED = "true";
  process.env.NOTORGANIC_ISSUER = "https://provider.test";
  process.env.NOTORGANIC_SUBSCRIPTION_CATALOG = "keating_v2";
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return String(url).endsWith("wallet")
      ? Response.json({ checkout: { available: true, planIds: mapped ? [KEATING_PERSONAL_PLAN.id] : [] } })
      : Response.json({ url: "https://checkout.test/subscription" });
  }) as typeof fetch;
  const request = (selector: Record<string, string>) => {
    const event = mockEvent(new Request("https://keating.test/api/notorganic/provider/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...selector, return_url: "https://keating.help/pricing" }) }));
    event.context.params = { resource: "checkout" };
    event.context.notOrganicSessionAdapter = { getProductSession: async () => ({ accountId: "did:plc:test", accessToken: "test-capability", createDpopProof: async () => "test-proof" }) };
    return handler(event);
  };
  try {
    await request({ plan_id: KEATING_PERSONAL_PLAN.id });
    expect(calls.at(-1)?.body).toEqual({ plan_id: KEATING_PERSONAL_PLAN.id, return_url: "https://keating.help/pricing" });
    calls.length = 0;
    await expect(request({ plan_id: KEATING_PERSONAL_PLAN.id, pack_id: "keating_pack_25" })).rejects.toThrow();
    expect(calls).toHaveLength(0);
    mapped = false;
    await expect(request({ plan_id: KEATING_PERSONAL_PLAN.id })).rejects.toThrow();
    expect(calls.every(call => call.url.endsWith("wallet"))).toBe(true);
    calls.length = 0;
    delete process.env.NOTORGANIC_SUBSCRIPTION_CATALOG;
    await expect(request({ plan_id: KEATING_PERSONAL_PLAN.id })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries({ NOTORGANIC_ENABLED: previous.enabled, NOTORGANIC_ISSUER: previous.issuer, NOTORGANIC_SUBSCRIPTION_CATALOG: previous.plans, NOTORGANIC_MAX_COST_MICROUSD: previous.cost })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

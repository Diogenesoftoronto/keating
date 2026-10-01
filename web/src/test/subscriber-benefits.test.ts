import { describe, expect, test } from "bun:test";
import { mockEvent } from "h3";
import { hasKeatingPaidSubscription } from "../notorganic-provider/subscriber-benefits";
import { requireKeatingSubscriberBenefit } from "../../server/utils/subscriber-benefits";

const did = "did:plc:alice";
const now = 1_800_000_000_000;
const subscription = { did, product: "keating", plan: "keating_personal_v2", status: "active", currentPeriodStart: now - 1000, currentPeriodEnd: now + 1000 };
const account = (overrides: Record<string, unknown> = {}) => ({ account: { did }, subscriptions: [{ ...subscription, ...overrides }] });

describe("paid subscriber authority", () => {
  test("requires the same account, product, current retail plan, and paid period", () => {
    expect(hasKeatingPaidSubscription(account(), did, now)).toBe(true);
    for (const overrides of [
      { did: "did:plc:bob" }, { product: "twyne" }, { plan: "keating_pack_25" },
      { plan: "keating_personal" }, { currentPeriodEnd: now }, { currentPeriodStart: now + 1 },
      { currentPeriodEnd: undefined }, { currentPeriodEnd: String(now + 1000) },
      { currentPeriodStart: NaN },
    ]) expect(hasKeatingPaidSubscription(account(overrides), did, now)).toBe(false);
    expect(hasKeatingPaidSubscription(account(), "did:plc:bob", now)).toBe(false);
    expect(hasKeatingPaidSubscription({ ...account(), account: null }, did, now)).toBe(false);
  });

  test("does not turn trials, credit, or checkout availability into subscription access", () => {
    for (const status of ["trialing", "past_due", "unpaid", "expired", "paused", "refunded", "incomplete"]) {
      expect(hasKeatingPaidSubscription(account({ status }), did, now)).toBe(false);
    }
    expect(hasKeatingPaidSubscription({ account: { did }, availableMicros: 50_000_000, checkout: { available: true, planIds: [subscription.plan] } }, did, now)).toBe(false);
    for (const input of [null, [], true, {}, { account: { did }, subscriptions: "active" }]) {
      expect(hasKeatingPaidSubscription(input, did, now)).toBe(false);
    }
  });

  test("keeps a cancelled paid period until its boundary and recognizes a renewal", () => {
    expect(hasKeatingPaidSubscription(account({ status: "canceled" }), did, now)).toBe(true);
    expect(hasKeatingPaidSubscription(account({ status: "canceled" }), did, now + 1000)).toBe(false);
    expect(hasKeatingPaidSubscription(account({ currentPeriodEnd: now + 2000 }), did, now + 1000)).toBe(true);
  });
});

test("managed cloud checks server authority and never dispatches before a compute allowance exists", async () => {
  const remote = (await import("../../server/api/agent-runtime/remote/[...path]")).default;
  const config = (await import("../../server/api/agent-runtime/config")).default;
  const env = {
    NOTORGANIC_ENABLED: "true", NOTORGANIC_ISSUER: "https://provider.test",
    NOTORGANIC_MAX_COST_MICROUSD: "75000", KEATING_WEB_AGENT_MODE: "cloud",
  };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  const fetcher = globalThis.fetch;
  let response: unknown = account({ currentPeriodStart: Date.now() - 60_000, currentPeriodEnd: Date.now() + 60_000 });
  let ok = true;
  const calls: string[] = [];
  const event = () => {
    const value = mockEvent(new Request("https://keating.test/api/agent-runtime/remote/execute", { method: "POST" }));
    value.context.notOrganicSessionAdapter = { getProductSession: async () => ({ accountId: did, accessToken: "server-capability", createDpopProof: async () => "proof" }) };
    return value;
  };
  try {
    Object.assign(process.env, env);
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return Response.json(response, { status: ok ? 200 : 503 });
    }) as typeof fetch;
    await expect(requireKeatingSubscriberBenefit(event(), "hosted-sync")).resolves.toBe(did);
    await expect(remote(event())).rejects.toMatchObject({ statusCode: 503 });
    expect(calls.every(url => url === "https://provider.test/v1/account")).toBe(true);
    expect(config(event()).mode).toBe("browser-only");
    response = account({ status: "trialing" });
    await expect(remote(event())).rejects.toMatchObject({ statusCode: 403 });
    ok = false;
    await expect(requireKeatingSubscriberBenefit(event(), "hosted-sync")).rejects.toMatchObject({ statusCode: 503 });
    const unsigned = mockEvent(new Request("https://keating.test/api/agent-runtime/remote/execute"));
    await expect(remote(unsigned)).rejects.toThrow();
  } finally {
    globalThis.fetch = fetcher;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

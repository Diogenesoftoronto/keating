import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CreditRecoveryCard } from "../components/NotOrganicCreditRecovery";
import { normalizeCreditWallet, canRetryWithWallet, availableCreditPacks } from "../notorganic-provider/credit-wallet";
import { createNotOrganicCheckout } from "../notorganic-provider";
import { mergeConsecutiveAssistantMessages } from "../components/assistant-chat-messages";

const empty = () => normalizeCreditWallet({ availableMicros: 0, checkout: { available: false, packIds: [] } });
const actions = { onRefresh() {}, onRetry() {}, onCheckout() {} };

describe("verified credit recovery", () => {
  it("uses only product-scoped available credit, subtracts legacy holds, and does not add unscoped grants", () => {
    expect(normalizeCreditWallet({ availableMicros: 2_500_000, balanceMicros: 0 }).availableMicros).toBe(2_500_000);
    expect(normalizeCreditWallet({ balanceMicros: 100_000, reservedMicros: 90_000, availableGrantMicros: 9_000_000 }).availableMicros).toBe(10_000);
    expect(normalizeCreditWallet({ balance_microusd: 2_000_000 }).availableMicros).toBe(2_000_000);
    expect(() => normalizeCreditWallet({ balanceMicros: 2_000_000, availableMicros: -1 })).toThrow();
    expect(() => normalizeCreditWallet({})).toThrow();
  });

  it("requires enough verified spendable balance for the response reservation", () => {
    expect(canRetryWithWallet(undefined, 100_000)).toBe(false);
    expect(canRetryWithWallet(empty(), 100_000)).toBe(false);
    expect(canRetryWithWallet(normalizeCreditWallet({ availableMicros: 99_999 }), 100_000)).toBe(false);
    expect(canRetryWithWallet(normalizeCreditWallet({ availableMicros: 100_000 }), 100_000)).toBe(true);
    expect(canRetryWithWallet(normalizeCreditWallet({ availableMicros: 2_500_000, hostedInferenceBlocked: true }), 100_000)).toBe(false);
  });

  it("exposes only locally enabled and server-configured packs", () => {
    const wallet = normalizeCreditWallet({ availableMicros: 0, checkout: { available: true, packIds: ["keating_pack_25", "unrecognized"] } });
    expect(availableCreditPacks(wallet, false)).toEqual([]);
    expect(availableCreditPacks(empty(), true)).toEqual([]);
    expect(availableCreditPacks(wallet, true).map(pack => pack.priceUsd)).toEqual([25]);
  });

  it("cannot reach checkout when readiness is false, the pack is unavailable, or the return address is loopback", async () => {
    for (const checkout of [{ available: false, packIds: ["keating_pack_10"] }, { available: true, packIds: ["keating_pack_25"] }]) {
      const calls: string[] = [];
      const fetcher = (async (url) => { calls.push(String(url)); return Response.json({ availableMicros: 0, checkout }); }) as typeof fetch;
      await expect(createNotOrganicCheckout("keating_pack_10", "https://keating.help/pricing?checkout=returned", fetcher)).rejects.toThrow("not available");
      expect(calls).toEqual(["/api/notorganic/provider/wallet"]);
    }
    const fetcher = (() => { throw new Error("Must not send a request"); }) as unknown as typeof fetch;
    await expect(createNotOrganicCheckout("keating_pack_10", "http://127.0.0.1:3210/chat", fetcher)).rejects.toThrow("secure return");
  });

  it("keeps the failed turn recoverable and does not claim payment from a checkout URL", () => {
    const html = renderToStaticMarkup(<CreditRecoveryCard {...actions} wallet={empty()} checkoutUrl="https://checkout.example.test/txn" initialPackId="keating_pack_10" />);
    expect(html).toContain("Your message is safe");
    expect(html).toContain("Add credits");
    expect(html).toContain("Refresh balance");
    expect(html).toContain("purchases aren’t available");
    expect(html).not.toContain("Retry response");
    expect(html).not.toContain("Payment successful");
    expect(html).toContain("keatingbot-insufficient-funds-v2.png");
  });

  it("shows the new refresh animation only while checking the wallet, and starter credit only when granted", () => {
    const refreshing = renderToStaticMarkup(<CreditRecoveryCard {...actions} wallet={empty()} refreshing />);
    expect(refreshing).toContain("keatingbot-wallet-refresh-v1.png");
    expect(refreshing).toContain("Checking your wallet");
    const wallet = normalizeCreditWallet({ availableMicros: 2_500_000, welcomeCredit: { eligible: false, granted: true, amountMicros: 2_500_000, remainingMicros: 2_500_000 } });
    const ready = renderToStaticMarkup(<CreditRecoveryCard {...actions} wallet={wallet} />);
    expect(ready).toContain("Retry response");
    expect(ready).toContain("Top up");
    expect(ready).toContain("keatingbot-credits-ready-v1.png");
    expect(ready).toContain("$2.50");
    expect(ready).toContain("one-time free starter credit");
    expect(ready).not.toContain("wallet-refresh-v1");
    const spent = renderToStaticMarkup(<CreditRecoveryCard {...actions} wallet={normalizeCreditWallet({ availableMicros: 0, welcomeCredit: { eligible: false, granted: true, amountMicros: 2_500_000, remainingMicros: 0 } })} />);
    expect(spent).not.toContain("Your starter credit is ready");
    expect(spent).not.toContain("one-time free starter credit");
  });
});

describe("chat display projection", () => {
  it("does not append duplicate error content or mutate preserved messages on repeated renders", () => {
    const messages = [{ role: "assistant", content: [{ type: "text", text: "Partial response" }], timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "Insufficient credits" }], stopReason: "error", errorMessage: "402 insufficient credits", timestamp: 2 }] as any[];
    const before = structuredClone(messages);
    const first = mergeConsecutiveAssistantMessages(messages);
    const second = mergeConsecutiveAssistantMessages(messages);
    expect(first).toEqual(second);
    expect(messages).toEqual(before);
    expect((first[0] as any).content).toHaveLength(2);
    expect(first[0]).toMatchObject({ stopReason: "error", errorMessage: "402 insufficient credits" });
  });
});

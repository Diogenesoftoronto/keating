import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { notOrganicCheckoutReturn, notOrganicCheckoutReturnUrl } from "../notorganic-provider/checkout-return";
import { hostedNavigationHref } from "../lib/hosted-navigation";
import { CreditRecoveryCard } from "../components/NotOrganicCreditRecovery";
import { normalizeCreditWallet } from "../notorganic-provider/credit-wallet";

describe("checkout return navigation", () => {
  it("returns to the signed-in chat session without routing to the website", () => {
    const target = new URL(notOrganicCheckoutReturnUrl("https://chat.keating.help/?session=lesson-1&course=math&ask=private-prompt", "keating_pack_25"));
    expect(target.origin).toBe("https://chat.keating.help");
    expect(target.pathname).toBe("/");
    expect(target.searchParams.get("session")).toBe("lesson-1");
    expect(target.searchParams.get("course")).toBe("math");
    expect(target.searchParams.has("ask")).toBe(false);
    expect(hostedNavigationHref(`${target.pathname}${target.search}`, target.hostname, true)).toBe(`${target.pathname}${target.search}`);
    expect(notOrganicCheckoutReturn(target.href)).toEqual({ packId: "keating_pack_25", cleanHref: "/?session=lesson-1&course=math" });
  });

  it("keeps custom secure deployments local and desktop returns secure", () => {
    expect(notOrganicCheckoutReturnUrl("https://preview.example/chat?session=lesson-2", "keating_pack_10"))
      .toBe("https://preview.example/chat?session=lesson-2&checkout=returned&credit_pack=keating_pack_10");
    expect(notOrganicCheckoutReturnUrl("http://127.0.0.1:53693/chat?session=private-local", "keating_pack_10"))
      .toBe("https://keating.help/pricing?checkout=returned&credit_pack=keating_pack_10");
    expect(notOrganicCheckoutReturn("https://chat.keating.help/?session=lesson-2")).toBeNull();
  });

  it("treats checkout return as pending until wallet credit is verified", () => {
    const html = renderToStaticMarkup(<CreditRecoveryCard checkoutReturned preserveMessage={false}
      wallet={normalizeCreditWallet({ availableMicros: 0 })} onRefresh={() => {}} onCheckout={() => {}} />);
    expect(html).toContain("Payment may still be processing");
    expect(html).toContain("Refresh balance");
    expect(html).not.toContain("Payment successful");
    expect(html).not.toContain("Retry response");
  });
});

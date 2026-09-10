import { isNotOrganicPackId } from "./packs";

/** Retail subscription catalog; provider mappings remain authoritative. */
export const KEATING_PERSONAL_PLAN = {
  id: "keating_personal_v2",
  name: "Personal",
  priceUsdMonthly: 25,
  monthlyCreditUsd: 5,
  creditRolloverMonths: 1,
} as const;

export function subscriptionCheckoutEnabled(env: Record<string, string | undefined>): boolean {
  return env.VITE_NOTORGANIC_CHECKOUT_ENABLED === "true"
    && env.VITE_NOTORGANIC_SUBSCRIPTION_CATALOG === "keating_v2";
}

export function subscriptionAvailable(wallet: { checkout: { available: boolean; planIds?: string[] } } | undefined, enabled: boolean): boolean {
  return enabled && wallet?.checkout?.available === true
    && wallet.checkout.planIds?.includes(KEATING_PERSONAL_PLAN.id) === true;
}

/** Reject ambiguous selectors; never reinterpret a subscription as a top-up. */
export function checkoutSelection(input: { plan_id?: unknown; pack_id?: unknown }, plansEnabled: boolean): { plan_id: string } | { pack_id: string } {
  if (input.plan_id !== undefined && input.pack_id !== undefined) throw new Error("Choose one plan or credit pack.");
  if (input.plan_id !== undefined) {
    if (!plansEnabled || input.plan_id !== KEATING_PERSONAL_PLAN.id) throw new Error("This subscription is not available yet.");
    return { plan_id: KEATING_PERSONAL_PLAN.id };
  }
  if (typeof input.pack_id !== "string" || !isNotOrganicPackId(input.pack_id)) throw new Error("Choose a valid Keating credit pack.");
  return { pack_id: input.pack_id };
}

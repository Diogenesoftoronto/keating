import { KEATING_PERSONAL_PLAN } from "./plans";

/** Hosted services are paid benefits; local learning and backups remain free. */
export const KEATING_SUBSCRIBER_BENEFITS = [
  { id: "hosted-sync", label: "Encrypted cross-device sync and hosted recovery" },
  { id: "cloud-sandbox", label: "Cloud sandbox with a metered compute allowance" },
] as const;

export type KeatingSubscriberBenefit = typeof KEATING_SUBSCRIBER_BENEFITS[number]["id"];

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/**
 * Consume only an authenticated provider response. This function does not
 * authenticate browser claims. Credits and checkout availability never grant
 * access to subscription benefits.
 */
export function hasKeatingPaidSubscription(input: unknown, accountId: string, now = Date.now()): boolean {
  const body = record(input);
  const account = record(body?.account);
  if (!accountId || account?.did !== accountId || !Number.isFinite(now)) return false;
  if (!Array.isArray(body?.subscriptions)) return false;
  return body.subscriptions.some((value: unknown) => {
    const subscription = record(value);
    if (!subscription || subscription.did !== accountId || subscription.product !== "keating"
      || subscription.plan !== KEATING_PERSONAL_PLAN.id) return false;
    // Cancellation at the end of a paid period keeps access until that period
    // expires. Trials, debt, refunds, and incomplete checkouts do not grant it.
    if (!["active", "paid", "completed", "canceled", "cancelled"].includes(String(subscription.status))) return false;
    const start = subscription.currentPeriodStart;
    const end = subscription.currentPeriodEnd;
    return typeof start === "number" && Number.isSafeInteger(start)
      && typeof end === "number" && Number.isSafeInteger(end)
      && start <= now && now < end && start < end;
  });
}

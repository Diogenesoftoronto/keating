export const hostedInklingBillingCode = "keating_hosted_inkling_billing";

export function isTinkerBillingBlock(detail: string): boolean {
  return detail.includes("Access is blocked due to billing status")
    && detail.includes("https://tinker.thinkingmachines.ai/billing/");
}

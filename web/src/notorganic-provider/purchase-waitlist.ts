import { SERVICE_ENDPOINTS } from "@keating/runtime-config";
export function purchaseWaitlistUrl(intent: "setup" | "subscription" | "credits", offerId = "") {
  const query = new URLSearchParams({ product: "keating", intent });
  if (offerId) query.set("offerId", offerId);
  return `${SERVICE_ENDPOINTS.notorganic.waitlist}?${query}`;
}

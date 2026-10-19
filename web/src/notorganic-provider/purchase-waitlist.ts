export function purchaseWaitlistUrl(intent: "setup" | "subscription" | "credits", offerId = "") {
  const query = new URLSearchParams({ product: "keating", intent });
  if (offerId) query.set("offerId", offerId);
  return `https://id.notorganic.info/waitlist?${query}`;
}

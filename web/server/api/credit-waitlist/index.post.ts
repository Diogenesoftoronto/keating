import { createHash } from "node:crypto";
import { createError, defineEventHandler, setHeader } from "h3";
import { CreditWaitlistError, joinCreditWaitlist } from "../../utils/credit-waitlist";
import { acquirePublicConcurrency, consumePublicRateLimit, publicClientIdentity, reservePublicQuota } from "../../utils/public-abuse";

function threshold(name: string, fallback: number, maximum: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : fallback;
}

export default defineEventHandler(async event => {
  setHeader(event, "Cache-Control", "no-store");
  const releases: Array<() => Promise<void>> = [];
  try {
    if (event.method !== "POST") throw createError({ statusCode: 405, statusMessage: "Use POST for the email waitlist." });
    const client = publicClientIdentity(event);
    await consumePublicRateLimit(event, { bucket: "waitlist-global", key: "global", limit: threshold("KEATING_WAITLIST_GLOBAL_LIMIT", 100, 1000), windowSeconds: 900 });
    await consumePublicRateLimit(event, { bucket: "waitlist-client", key: client, limit: threshold("KEATING_WAITLIST_IP_LIMIT", 10, 100), windowSeconds: 900 });
    releases.push(await acquirePublicConcurrency(event, { bucket: "waitlist-client", key: client, limit: 2, leaseSeconds: 300 }));
    releases.push(await acquirePublicConcurrency(event, { bucket: "waitlist-global", key: "global", limit: 8, leaseSeconds: 300 }));
    return await joinCreditWaitlist(event.req, {
      apiKey: process.env.RESEND_API_KEY,
      segmentId: process.env.KEATING_WAITLIST_SEGMENT_ID,
      from: process.env.KEATING_WAITLIST_FROM,
      origin: process.env.KEATING_WAITLIST_ORIGIN,
      limitEmail: async email => {
        const key = createHash("sha256").update(email).digest("hex");
        await consumePublicRateLimit(event, { bucket: "waitlist-email", key, limit: 5, windowSeconds: 900 });
      },
      acquireEmail: email => acquirePublicConcurrency(event, { bucket: "waitlist-email", key: createHash("sha256").update(email).digest("hex"), limit: 1, leaseSeconds: 300 }),
      reserveConfirmationSend: async () => {
        await reservePublicQuota({ bucket: "waitlist-confirmations", key: "global", amount: 1, limit: threshold("KEATING_WAITLIST_DAILY_EMAIL_LIMIT", 200, 1000), windowSeconds: 86400 });
      },
    });
  } catch (error) {
    const status = error instanceof CreditWaitlistError ? error.statusCode : error && typeof error === "object" && "statusCode" in error ? Number(error.statusCode) : undefined;
    if (status === 429) {
      const headers = error && typeof error === "object" && "headers" in error ? error.headers as HeadersInit : undefined;
      setHeader(event, "Retry-After", headers ? new Headers(headers).get("Retry-After") ?? "900" : "900");
    }
    if (error instanceof CreditWaitlistError) throw createError({ statusCode: error.statusCode, statusMessage: error.message });
    if (status && status >= 400 && status <= 599) throw error;
    throw createError({ statusCode: 503, statusMessage: "The email waitlist is temporarily unavailable. Please try again." });
  } finally {
    await Promise.allSettled(releases.map(release => release()));
  }
});

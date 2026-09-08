import { createError, defineEventHandler, setHeader } from "h3";
import { CreditWaitlistError, createWaitlistRateLimiter, joinCreditWaitlist } from "../../utils/credit-waitlist";
const limitEmail = createWaitlistRateLimiter();
const limitGlobal = createWaitlistRateLimiter(Date.now, 1000);
export default defineEventHandler(async event => {
  setHeader(event, "Cache-Control", "no-store");
  try {
    limitGlobal("public-waitlist");
    return await joinCreditWaitlist(event.req, { apiKey: process.env.RESEND_API_KEY, segmentId: process.env.KEATING_WAITLIST_SEGMENT_ID, from: process.env.KEATING_WAITLIST_FROM, limitEmail, origin: process.env.KEATING_WAITLIST_ORIGIN });
  } catch (error) {
    if (error instanceof CreditWaitlistError) { if (error.statusCode === 429) setHeader(event, "Retry-After", "900"); throw createError({ statusCode: error.statusCode, statusMessage: error.message }); }
    throw createError({ statusCode: 503, statusMessage: "The email waitlist is temporarily unavailable. Please try again." });
  }
});

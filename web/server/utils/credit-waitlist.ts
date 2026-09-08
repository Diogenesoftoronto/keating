import { createHash } from "node:crypto";
import { getNotOrganicPack } from "../../src/notorganic-provider/packs";

export class CreditWaitlistError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}
export type WaitlistResult = { joined: true; confirmation: "sent" | "unavailable" | "already_registered" };
type Options = { apiKey?: string; segmentId?: string; from?: string; origin?: string; fetcher?: typeof fetch; sleep?: (ms: number) => Promise<void>; limitEmail?: (identity: string) => void };
export function createWaitlistRateLimiter(now = Date.now, maxAttempts = 5) {
  const buckets = new Map<string, { count: number; until: number }>();
  return (identity: string) => {
    const time = now();
    for (const [key, entry] of buckets) if (entry.until <= time) buckets.delete(key);
    const key = createHash("sha256").update(identity).digest("hex");
    const entry = buckets.get(key) ?? { count: 0, until: time + 15 * 60_000 };
    if (entry.count >= maxAttempts || buckets.size >= 10_000 && !buckets.has(key)) throw new CreditWaitlistError(429, "Too many attempts. Please try again in 15 minutes.");
    entry.count++; buckets.set(key, entry);
  };
}

export async function joinCreditWaitlist(request: Request, options: Options): Promise<WaitlistResult> {
  const expectedOrigin = options.origin ?? new URL(request.url).origin;
  if (request.headers.get("origin") !== expectedOrigin) throw new CreditWaitlistError(403, "Please submit the form from the Keating website.");
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new CreditWaitlistError(415, "Expected a JSON form.");
  const reader = request.body?.getReader();
  if (!reader) throw new CreditWaitlistError(400, "Complete the email form.");
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > 2048) { await reader.cancel(); throw new CreditWaitlistError(413, "The form is too large."); } chunks.push(chunk.value); } } finally { reader.releaseLock(); }
  let body: Record<string, unknown>;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new CreditWaitlistError(400, "Complete the email form."); }
  if (!body || typeof body !== "object" || body.consent !== true || typeof body.email !== "string" || typeof body.packId !== "string" || body.website) throw new CreditWaitlistError(400, "Enter your email and agree to the launch notification.");
  const email = body.email.trim().toLowerCase();
  const pack = getNotOrganicPack(body.packId);
  if (!pack || email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new CreditWaitlistError(400, "Enter a valid email address and credit pack.");
  options.limitEmail?.(email);
  if (!options.apiKey || !options.segmentId || !options.from) throw new CreditWaitlistError(503, "The email waitlist is temporarily unavailable. Please try again later.");
  const fetcher = options.fetcher ?? fetch;
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  async function api(path: string, method = "GET", value?: unknown, key?: string): Promise<{ status: number; data: any }> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetcher(`https://api.resend.com${path}`, { method, headers: { Authorization: `Bearer ${options.apiKey}`, "User-Agent": "Keating-waitlist/1.0", "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, body: value === undefined ? undefined : JSON.stringify(value), signal: AbortSignal.timeout(8000) });
        if ((response.status === 429 || response.status >= 500) && attempt < 2) { await sleep(600 * (attempt + 1)); continue; }
        const data = await response.json().catch(() => null);
        return { status: response.status, data };
      } catch { if (attempt === 2) throw new CreditWaitlistError(503, "The email waitlist could not be reached. Please try again."); await sleep(600 * (attempt + 1)); }
    }
    throw new CreditWaitlistError(503, "The email waitlist could not be reached.");
  }
  const ok = (result: { status: number; data: any }) => result.status >= 200 && result.status < 300;
  let contact = await api(`/contacts/${encodeURIComponent(email)}`);
  if (contact.status === 404) {
    contact = await api("/contacts", "POST", { email, unsubscribed: false });
    // A concurrent signup may have created it while our request was in flight.
    if (!ok(contact)) contact = await api(`/contacts/${encodeURIComponent(email)}`);
  }
  if (!ok(contact) || typeof contact.data?.id !== "string") throw new CreditWaitlistError(503, "Your email could not be saved. Please try again.");
  if (contact.data.unsubscribed === true) throw new CreditWaitlistError(409, "This address has opted out of Keating emails. Please use another address or update your email preferences.");
  const id = encodeURIComponent(contact.data.id);
  let after = ""; let registered = false;
  for (let page = 0; page < 20; page++) {
    const memberships = await api(`/contacts/${id}/segments?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`);
    if (!ok(memberships) || !Array.isArray(memberships.data?.data)) throw new CreditWaitlistError(503, "Your waitlist registration could not be checked. Please try again.");
    if (memberships.data.data.some((segment: { id?: string }) => segment.id === options.segmentId)) { registered = true; break; }
    if (!memberships.data.has_more) break;
    after = memberships.data.data.at(-1)?.id;
    if (!after || page === 19) throw new CreditWaitlistError(503, "Your waitlist registration could not be checked.");
  }
  if (registered) return { joined: true, confirmation: "already_registered" };
  const membership = await api(`/contacts/${id}/segments/${encodeURIComponent(options.segmentId)}`, "POST");
  if (!ok(membership)) throw new CreditWaitlistError(503, "Your email was saved, but waitlist registration failed. Please try again.");
  // Membership is durable before confirmation; an email outage never loses signup.
  const key = createHash("sha256").update(`keating-credit-waitlist-v1:${email}:${options.segmentId}`).digest("hex");
  try {
    const sent = await api("/emails", "POST", { from: options.from, to: [email], subject: "You're on the Keating credits waitlist", text: `You're on the Keating hosted credits waitlist.\n\nYou asked to hear when hosted credit packs become available, starting with the ${pack.label} pack. Nothing has been purchased or charged. We'll email you when they're ready.\n\nKeating is available today with your own provider keys.\n\nIf you didn't request this, reply to this email to let us know.`, tags: [{ name: "purpose", value: "credits_waitlist_v1" }, { name: "pack", value: pack.id }] }, `credit-waitlist/${key}`);
    return { joined: true, confirmation: ok(sent) && typeof sent.data?.id === "string" ? "sent" : "unavailable" };
  } catch { return { joined: true, confirmation: "unavailable" }; }
}

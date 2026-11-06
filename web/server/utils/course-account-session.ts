import { createError, deleteCookie, getCookie, getHeader, getRequestURL, setCookie, type H3Event } from "h3";
import { adoptLocalCourses, adoptedLocalCourseAccounts } from "./course-repository";

import { COURSE_ACCOUNT_COOKIE, CourseAccountSessions, courseAccountToken } from "./course-linked-session";
export { COURSE_ACCOUNT_COOKIE, CourseAccountSessions } from "./course-linked-session";

function unauthorized(message = "Sign in again to continue with your course account."): never {
  throw createError({ statusCode: 401, statusMessage: message });
}

/** Forward a proof for this exact provider endpoint; never decode browser claims. */
export async function verifyCourseAccount(
  authorization: string | undefined,
  proof: string | undefined,
  issuer = process.env.NOTORGANIC_ISSUER,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  if (!authorization?.startsWith("DPoP ") || authorization.length > 16_384 || !proof || proof.length > 16_384) unauthorized();
  let origin: URL;
  try { origin = new URL(issuer ?? ""); } catch { throw createError({ statusCode: 503, statusMessage: "Course account verification is not configured." }); }
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw createError({ statusCode: 503, statusMessage: "Course account verification requires an HTTPS gateway origin." });
  }
  const response = await fetcher(`${origin.origin}/v1/account`, {
    method: "GET", headers: { authorization, dpop: proof }, redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) unauthorized("Your Not Organic account could not be verified.");
  const body = await response.json() as { account?: { did?: unknown } };
  const did = body?.account?.did;
  if (typeof did !== "string" || !/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/.test(did) || did.length > 256) unauthorized();
  return did;
}

export function assertCourseBridgeOrigin(event: H3Event): boolean {
  const origin = getHeader(event, "origin");
  const native = getHeader(event, "x-keating-client") === "native" && !origin;
  if (!native && origin !== getRequestURL(event, { xForwardedProto: true, xForwardedHost: false }).origin) {
    throw createError({ statusCode: 403, statusMessage: "Course account linking requires a same-origin request." });
  }
  return native;
}

export async function handleCourseAccountSession(event: H3Event) {
  const native = assertCourseBridgeOrigin(event);
  const sessions = new CourseAccountSessions();
  const prior = courseAccountToken(event);
  if (event.method === "DELETE") {
    if (prior) await sessions.revoke(prior);
    if (!native) deleteCookie(event, COURSE_ACCOUNT_COOKIE, { path: "/" });
    return { cleared: true };
  }
  if (event.method !== "POST") throw createError({ statusCode: 405, statusMessage: "Method not allowed." });
  const accountId = await verifyCourseAccount(getHeader(event, "authorization"), getHeader(event, "dpop"));
  {
    const localSecret = getCookie(event, "keating_course_account");
    if (localSecret && /^[0-9a-f]{32}$/.test(localSecret)) {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(localSecret));
      await adoptLocalCourses(`local_${Buffer.from(digest).toString("hex")}`, accountId);
      if (!native) deleteCookie(event, "keating_course_account", { path: "/" });
    }
  }
  const session = await sessions.issue(accountId, prior);
  if (!native) setCookie(event, COURSE_ACCOUNT_COOKIE, session.token, {
    httpOnly: true, secure: getRequestURL(event, { xForwardedProto: true, xForwardedHost: false }).protocol === "https:", sameSite: "lax", path: "/",
    // Keep the expired marker so an expired login never falls back to a local account.
    maxAge: 60 * 60 * 24 * 365,
  });
  return { account: { id: accountId, mode: "hosted" as const }, expiresAt: session.expiresAt,
    adoptedLocalAccountIds: await adoptedLocalCourseAccounts(accountId), ...(native ? { sessionToken: session.token } : {}) };
}

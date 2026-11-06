import { notOrganicAccountCapabilityHeaders } from "../notorganic-account/client";
import { deviceSessionGeneration, loadDeviceSession } from "../notorganic-account/credentials";
import { KEATING_WEB_ORIGIN } from "../product-links";
import { getCourseCredentialStore } from "./credentials";

const KEY = "keating.mobile.course-linked-session.v1";
type LinkedSession = { accountId: string; token: string; expiresAt: number };
let cached: LinkedSession | undefined;
let tail: Promise<unknown> = Promise.resolve();

export function nativeCourseAccountHeaders(fetcher: typeof fetch = fetch, localCookie?: string, signal?: AbortSignal): Promise<{ headers: Record<string, string>; current: () => boolean; linked: boolean }> {
  const next = tail.catch(() => {}).then(async () => {
    const checkAbort = () => { if (signal?.aborted) throw Object.assign(new Error("Course request cancelled."), { name: "AbortError" }); };
    checkAbort();
    const account = await loadDeviceSession();
    const generation = deviceSessionGeneration();
    const current = () => generation === deviceSessionGeneration();
    if (!account) {
      cached = undefined;
      await getCourseCredentialStore().deleteItem(KEY);
      return { headers: {} as Record<string, string>, current, linked: false };
    }
    if (!account.accountId) throw new Error("Load your Not Organic account before opening Courses.");
    if (cached?.accountId === account.accountId && cached.expiresAt > Date.now() + 15_000 && current()) {
      return { headers: { "x-keating-course-session": cached.token }, current, linked: true };
    }
    const proofHeaders = await notOrganicAccountCapabilityHeaders("/v1/account", "GET");
    checkAbort();
    // A token refresh can change generation; distinguish it from an account switch.
    const active = await loadDeviceSession();
    if (active?.accountId !== account.accountId || active.issuer !== account.issuer) throw new Error("The course account changed.");
    const proofGeneration = deviceSessionGeneration();
    const stillCurrent = () => proofGeneration === deviceSessionGeneration();
    proofHeaders.set("dpop", proofHeaders.get("x-notorganic-dpop")!);
    proofHeaders.delete("x-notorganic-dpop");
    proofHeaders.set("x-keating-client", "native");
    if (cached) proofHeaders.set("x-keating-course-session", cached.token);
    if (localCookie) proofHeaders.set("cookie", localCookie);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, 20_000);
    let response: Response;
    try {
      checkAbort();
      response = await fetcher(`${KEATING_WEB_ORIGIN}/api/courses/account-session`, {
        method: "POST", headers: proofHeaders, redirect: "error", signal: controller.signal,
      });
    } finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); }
    checkAbort();
    if (!stillCurrent()) throw new Error("The course account changed.");
    if (!response.ok) throw new Error("Your Not Organic course account could not be verified.");
    const body = await response.json() as { account?: { id?: string }; sessionToken?: string; expiresAt?: number };
    if (!stillCurrent() || body.account?.id !== account.accountId || !/^[0-9a-f]{64}$/.test(body.sessionToken ?? "")
      || !Number.isFinite(body.expiresAt) || body.expiresAt! <= Date.now()) throw new Error("Invalid course account session.");
    const session = { accountId: account.accountId, token: body.sessionToken!, expiresAt: body.expiresAt! };
    await getCourseCredentialStore().setItem(KEY, JSON.stringify(session));
    if (!stillCurrent()) {
      await getCourseCredentialStore().deleteItem(KEY);
      throw new Error("The course account changed.");
    }
    cached = session;
    return { headers: { "x-keating-course-session": session.token }, current: stillCurrent, linked: true };
  });
  tail = next;
  return next;
}

export async function forgetNativeCourseAccount(): Promise<void> {
  cached = undefined;
  await getCourseCredentialStore().deleteItem(KEY);
}

import type * as WebBrowserModule from "expo-web-browser";
import type { NotOrganicAccountConfig, NotOrganicDeviceSession } from "./contracts";
import { defaultNotOrganicAccountConfig } from "./contracts";
import { clearPendingAuthorization, loadDeviceSession, loadPendingAuthorization, savePendingAuthorization } from "./credentials";
import { randomBase64Url, sha256Base64Url } from "./crypto";
import { exchangeAuthorizationCode } from "./client";

const PENDING_TTL_MS = 10 * 60_000;
const authorizationCompletions = new Map<string, Promise<NotOrganicDeviceSession>>();

function webBrowser(): typeof WebBrowserModule {
  return require("expo-web-browser") as typeof WebBrowserModule;
}

export async function createAuthorizationRequest(config = defaultNotOrganicAccountConfig()): Promise<{ url: string; state: string }> {
  const state = await randomBase64Url(24);
  const verifier = await randomBase64Url(48);
  const challenge = await sha256Base64Url(verifier);
  await savePendingAuthorization({ state, verifier, redirectUri: config.redirectUri, createdAt: Date.now() });
  const url = new URL(config.authorizationUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("scope", config.scope);
  url.searchParams.set("state", state);
  return { url: url.toString(), state };
}

export async function completeAuthorizationFromUrl(callbackUrl: string, config = defaultNotOrganicAccountConfig()): Promise<NotOrganicDeviceSession> {
  const callback = new URL(callbackUrl);
  const state = callback.searchParams.get("state");
  const inFlight = state ? authorizationCompletions.get(state) : undefined;
  if (inFlight) return inFlight;
  const pending = await loadPendingAuthorization();
  const racedInFlight = state ? authorizationCompletions.get(state) : undefined;
  if (racedInFlight) return racedInFlight;
  if (!pending || Date.now() - pending.createdAt > PENDING_TTL_MS) {
    const existing = await loadDeviceSession();
    if (existing) return existing;
    await clearPendingAuthorization();
    throw new Error("The sign-in request expired. Start again.");
  }
  const code = callback.searchParams.get("code");
  const error = callback.searchParams.get("error");
  if (state !== pending.state) {
    throw new Error("The sign-in response did not match this device.");
  }
  if (error) {
    await clearPendingAuthorization();
    throw new Error(callback.searchParams.get("error_description") ?? "Not Organic sign-in was denied.");
  }
  if (!code) throw new Error("Not Organic did not return an authorization code.");
  const completion = exchangeAuthorizationCode({ code, verifier: pending.verifier, config })
    .then(async (session) => {
      // exchangeAuthorizationCode persists the device session first. Keeping
      // pending state until then lets a duplicate deep link join this flight.
      await clearPendingAuthorization();
      return session;
    });
  authorizationCompletions.set(state, completion);
  try {
    return await completion;
  } finally {
    if (authorizationCompletions.get(state) === completion) {
      authorizationCompletions.delete(state);
    }
  }
}

export async function beginNotOrganicLogin(config = defaultNotOrganicAccountConfig()): Promise<NotOrganicDeviceSession | null> {
  const request = await createAuthorizationRequest(config);
  const result = await webBrowser().openAuthSessionAsync(request.url, config.redirectUri);
  if (result.type !== "success") return null;
  return completeAuthorizationFromUrl(result.url, config);
}

import type { BrowserOAuthClient, OAuthSession } from "@atproto/oauth-client-browser";
import { LEARNING_PROFILE_PATH, LEARNING_PROFILE_SCOPE } from "./public-learning-profile";
import metadata from "../../public/learning-profile-client-metadata.json";

let clientPromise: Promise<BrowserOAuthClient> | undefined;
let initPromise: Promise<OAuthSession | null> | undefined;

export function learningProfileOAuthErrorMessage(error: unknown): string {
  // The SDK can wrap token endpoint errors in callback errors. Only use
  // protocol codes here. Descriptions can contain private provider details.
  for (let depth = 0; depth < 4 && error && typeof error === "object"; depth++) {
    const failure = error as { error?: unknown; params?: unknown; cause?: unknown; name?: unknown };
    const code = (failure.params instanceof URLSearchParams ? failure.params.get("error") : null) ?? failure.error;
    switch (code) {
      case "access_denied":
        return "Connection was cancelled or permission was declined. Connect again when you’re ready to allow publishing.";
      case "invalid_client":
      case "invalid_client_metadata":
      case "unauthorized_client":
        return "Your account server couldn’t verify Keating’s sign-in setup. Try again later. If it keeps happening, contact Keating support.";
      case "invalid_scope":
        return "Your account server didn’t accept Keating’s publishing permission. Check with your account provider before trying again.";
      case "invalid_grant":
      case "login_required":
      case "interaction_required":
        return "Your connection expired. Connect your account again to continue.";
    }
    if (failure.name === "TimeoutError") return "Your account server took too long to respond. Try connecting again.";
    error = failure.cause;
  }
  return "Keating couldn’t finish connecting your account. Check your connection and try again.";
}

export function learningProfileOAuthLocation(origin: string) {
  const url = new URL(origin);
  if (url.hostname === "localhost") throw new Error("Open Keating at http://127.0.0.1 with the same port to connect your PDS during development.");
  const loopback = url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname);
  if (!loopback && url.origin !== "https://chat.keating.help") throw new Error("Open chat.keating.help to publish your learning profile.");
  const redirectUri = `${url.origin}${LEARNING_PROFILE_PATH}`;
  return { loopback, redirectUri, clientId: loopback ? `http://localhost?redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(LEARNING_PROFILE_SCOPE)}` : metadata.client_id };
}

async function client() {
  const location = learningProfileOAuthLocation(window.location.origin);
  return clientPromise ??= (async () => {
    const { BrowserOAuthClient } = await import("@atproto/oauth-client-browser");
    const { atprotoLoopbackClientMetadata, oauthClientMetadataSchema } = await import("@atproto/oauth-types");
    return new BrowserOAuthClient({
      clientMetadata: location.loopback ? atprotoLoopbackClientMetadata(location.clientId) : oauthClientMetadataSchema.parse(metadata),
      // Authorize by the verified account DID. The SDK uses its public handle
      // as the login hint only when it resolves back to the same DID.
      handleResolver: "https://public.api.bsky.app",
      responseMode: "fragment",
    });
  })().catch(error => {
    clientPromise = undefined;
    throw new Error(learningProfileOAuthErrorMessage(error));
  });
}

/** Called only on the dedicated editor/callback route, once per page lifetime. */
export function restoreLearningProfileSession(): Promise<OAuthSession | null> {
  return initPromise ??= (async () => {
    if (window.location.pathname !== LEARNING_PROFILE_PATH) throw new Error("Invalid learning-profile callback route.");
    const oauth = await client();
    const result = await oauth.init().catch(error => { throw new Error(learningProfileOAuthErrorMessage(error)); });
    return result?.session ?? null;
  })();
}

export async function connectLearningProfile(did: string): Promise<never> {
  if (!/^did:(plc|web):\S+$/u.test(did)) throw new Error("Sign in to a Not Organic account with a verified AT Protocol identity.");
  const oauth = await client();
  return oauth.signInRedirect(did, { scope: LEARNING_PROFILE_SCOPE, prompt: "consent" })
    .catch(error => { throw new Error(learningProfileOAuthErrorMessage(error)); });
}

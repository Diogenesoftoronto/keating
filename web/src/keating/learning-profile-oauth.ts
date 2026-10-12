import type { BrowserOAuthClient, OAuthSession } from "@atproto/oauth-client-browser";
import { LEARNING_PROFILE_PATH, LEARNING_PROFILE_SCOPE } from "./public-learning-profile";
import metadata from "../../public/learning-profile-client-metadata.json";

let clientPromise: Promise<BrowserOAuthClient> | undefined;
let initPromise: Promise<OAuthSession | null> | undefined;

export function learningProfileOAuthLocation(origin: string) {
  const url = new URL(origin);
  if (url.hostname === "localhost") throw new Error("Open Keating at http://127.0.0.1 with the same port to connect your PDS during development.");
  const loopback = url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname);
  if (!loopback && url.origin !== "https://chat.keating.help") throw new Error("Open chat.keating.help to publish your learning profile.");
  const redirectUri = `${url.origin}${LEARNING_PROFILE_PATH}`;
  return { loopback, redirectUri, clientId: loopback ? `http://localhost?redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(LEARNING_PROFILE_SCOPE)}` : metadata.client_id };
}

async function client() {
  return clientPromise ??= (async () => {
    const { BrowserOAuthClient } = await import("@atproto/oauth-client-browser");
    const { atprotoLoopbackClientMetadata, oauthClientMetadataSchema } = await import("@atproto/oauth-types");
    const location = learningProfileOAuthLocation(window.location.origin);
    return new BrowserOAuthClient({
      clientMetadata: location.loopback ? atprotoLoopbackClientMetadata(location.clientId) : oauthClientMetadataSchema.parse(metadata),
      // Sign-in accepts only the account's verified DID; no handles go to a third-party resolver.
      handleResolver: { resolve: async () => { throw new Error("Use the verified DID of your Not Organic account."); } },
      responseMode: "fragment",
    });
  })();
}

/** Called only on the dedicated editor/callback route, once per page lifetime. */
export function restoreLearningProfileSession(): Promise<OAuthSession | null> {
  return initPromise ??= (async () => {
    if (window.location.pathname !== LEARNING_PROFILE_PATH) throw new Error("Invalid learning-profile callback route.");
    const result = await (await client()).init();
    return result?.session ?? null;
  })();
}

export async function connectLearningProfile(did: string): Promise<never> {
  if (!/^did:(plc|web):\S+$/u.test(did)) throw new Error("Your account needs a verified AT Protocol DID.");
  return (await client()).signInRedirect(did, { scope: LEARNING_PROFILE_SCOPE, prompt: "consent" });
}

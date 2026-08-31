import { afterEach, describe, expect, test } from "bun:test";
import {
  completeAuthorizationFromUrl,
  createAuthorizationRequest,
} from "../src/lib/notorganic-account/auth";
import {
  activeDeviceSession,
  exchangeAuthorizationCode,
  loadAccountSnapshot,
  notOrganicAccountRequest,
  setAccountFetchForTests,
} from "../src/lib/notorganic-account/client";
import {
  accountCredentialKeysForTests,
  loadDeviceSession,
  loadPendingAuthorization,
  saveDeviceSession,
  setAccountCredentialStoreForTests,
} from "../src/lib/notorganic-account/credentials";
import { setAccountCryptoAdapterForTests } from "../src/lib/notorganic-account/crypto";
import { createDpopProof, setDeviceKeyAdapterForTests } from "../src/lib/notorganic-account/dpop";
import {
  NOTORGANIC_MOBILE_CLIENT_ID,
  NOTORGANIC_MOBILE_REDIRECT_URI,
  NOTORGANIC_MOBILE_SCOPE,
  type NotOrganicAccountConfig,
} from "../src/lib/notorganic-account/contracts";

const config: NotOrganicAccountConfig = {
  issuer: "https://gateway.test",
  authorizationUrl: "https://identity.test/authorize",
  clientId: NOTORGANIC_MOBILE_CLIENT_ID,
  redirectUri: NOTORGANIC_MOBILE_REDIRECT_URI,
  scope: "infer:balanced sync:key:read wallet:read",
};

function memoryCredentials() {
  const values = new Map<string, string>();
  return {
    values,
    store: {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => { values.set(key, value); },
      deleteItem: async (key: string) => { values.delete(key); },
    },
  };
}

const publicJwk = { kty: "EC" as const, crv: "P-256" as const, x: "x-coordinate", y: "y-coordinate" };

afterEach(() => {
  setAccountCredentialStoreForTests(null);
  setAccountCryptoAdapterForTests(null);
  setDeviceKeyAdapterForTests(null);
  setAccountFetchForTests(null);
});

describe("Not Organic mobile account", () => {
  test("requests the account evolution capabilities used for cross-device learning", () => {
    expect(new Set(NOTORGANIC_MOBILE_SCOPE.split(" "))).toEqual(new Set([
      "infer:balanced",
      "sync:key:read",
      "usage:read",
      "wallet:read",
      "evolution:read",
      "evolution:write",
      "evolution:execute",
    ]));
  });

  test("persists PKCE state and builds the exact registered native authorization request", async () => {
    const credentials = memoryCredentials();
    setAccountCredentialStoreForTests(credentials.store);
    let randomCall = 0;
    setAccountCryptoAdapterForTests({
      randomBytes: async (length) => new Uint8Array(length).fill(++randomCall),
      sha256Base64: async (value) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("base64"),
    });

    const request = await createAuthorizationRequest(config);
    const url = new URL(request.url);
    expect(url.origin + url.pathname).toBe(config.authorizationUrl);
    expect(url.searchParams.get("client_id")).toBe(NOTORGANIC_MOBILE_CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(NOTORGANIC_MOBILE_REDIRECT_URI);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(request.state);
    expect(await loadPendingAuthorization()).toMatchObject({ state: request.state, redirectUri: NOTORGANIC_MOBILE_REDIRECT_URI });
  });

  test("exchanges a matching callback for a durable device session and rejects mismatched state", async () => {
    const credentials = memoryCredentials();
    setAccountCredentialStoreForTests(credentials.store);
    setAccountCryptoAdapterForTests({
      randomBytes: async (length) => new Uint8Array(length).fill(7),
      sha256Base64: async (value) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("base64"),
    });
    setDeviceKeyAdapterForTests({
      getOrCreatePublicJwkAsync: async () => publicJwk,
      signAsync: async () => "native-signature",
      deleteKeyAsync: async () => {},
    });
    let exchangeBody: Record<string, unknown> | null = null;
    setAccountFetchForTests((async (_input, init) => {
      exchangeBody = JSON.parse(String(init?.body));
      return Response.json({
        access_token: "access-1",
        token_type: "DPoP",
        expires_in: 300,
        scope: config.scope,
        refresh_token: "nou_ds_00000000-0000-4000-8000-000000000000.secret",
        refresh_expires_in: 2_592_000,
      });
    }) as typeof fetch);

    const request = await createAuthorizationRequest(config);
    const session = await completeAuthorizationFromUrl(`${NOTORGANIC_MOBILE_REDIRECT_URI}?code=once&state=${request.state}`, config);
    expect(session.refreshToken).toStartWith("nou_ds_");
    expect(exchangeBody).toMatchObject({ client_id: NOTORGANIC_MOBILE_CLIENT_ID, redirect_uri: NOTORGANIC_MOBILE_REDIRECT_URI, device_session: true, dpop_jwk: publicJwk });
    expect(await loadDeviceSession()).toMatchObject({ accessToken: "access-1" });

    const keys = accountCredentialKeysForTests();
    expect(credentials.values.has(keys.pending)).toBe(false);
    credentials.values.delete(keys.session);
    const second = await createAuthorizationRequest(config);
    await expect(completeAuthorizationFromUrl(`${NOTORGANIC_MOBILE_REDIRECT_URI}?code=attacker&state=wrong`, config)).rejects.toThrow("did not match");
    expect(second.state).not.toBe("wrong");
    expect(credentials.values.has(keys.pending)).toBe(false);
  });

  test("deduplicates concurrent callback completion from the router and browser session", async () => {
    const credentials = memoryCredentials();
    setAccountCredentialStoreForTests(credentials.store);
    setAccountCryptoAdapterForTests({
      randomBytes: async (length) => new Uint8Array(length).fill(8),
      sha256Base64: async (value) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("base64"),
    });
    setDeviceKeyAdapterForTests({
      getOrCreatePublicJwkAsync: async () => publicJwk,
      signAsync: async () => "native-signature",
      deleteKeyAsync: async () => {},
    });
    let exchangeCalls = 0;
    let releaseExchange!: (response: Response) => void;
    const exchangeResponse = new Promise<Response>((resolve) => { releaseExchange = resolve; });
    setAccountFetchForTests((async () => {
      exchangeCalls += 1;
      return exchangeResponse;
    }) as typeof fetch);

    const request = await createAuthorizationRequest(config);
    const callback = `${NOTORGANIC_MOBILE_REDIRECT_URI}?code=once&state=${request.state}`;
    const fromRouter = completeAuthorizationFromUrl(callback, config);
    const fromBrowser = completeAuthorizationFromUrl(callback, config);
    await Promise.resolve();
    releaseExchange(Response.json({
      access_token: "access-concurrent",
      token_type: "DPoP",
      expires_in: 300,
      scope: config.scope,
      refresh_token: "refresh-concurrent",
      refresh_expires_in: 2_592_000,
    }));

    const [routerSession, browserSession] = await Promise.all([fromRouter, fromBrowser]);
    expect(exchangeCalls).toBe(1);
    expect(routerSession).toEqual(browserSession);
    expect(routerSession.accessToken).toBe("access-concurrent");
  });

  test("rotates an expired access capability and signs account requests with DPoP", async () => {
    const credentials = memoryCredentials();
    setAccountCredentialStoreForTests(credentials.store);
    setAccountCryptoAdapterForTests({
      randomBytes: async (length) => new Uint8Array(length).fill(9),
      sha256Base64: async (value) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("base64"),
    });
    setDeviceKeyAdapterForTests({
      getOrCreatePublicJwkAsync: async () => publicJwk,
      signAsync: async (_alias, payload) => `signature-${payload.length}`,
      deleteKeyAsync: async () => {},
    });
    await saveDeviceSession({ accessToken: "expired", accessExpiresAt: 0, refreshToken: "refresh-1", refreshExpiresAt: Date.now() + 60_000, scope: config.scope });
    const calls: Array<{ url: string; authorization: string | null; dpop: string | null }> = [];
    setAccountFetchForTests((async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({ url, authorization: headers.get("authorization"), dpop: headers.get("dpop") });
      if (url.endsWith("/v1/public/device/token")) return Response.json({ access_token: "access-2", token_type: "DPoP", expires_in: 300, scope: config.scope, refresh_token: "refresh-2", refresh_expires_in: 60_000 });
      return Response.json({ did: "did:plc:alice", handle: "alice.test" });
    }) as typeof fetch);

    expect((await activeDeviceSession(config)).refreshToken).toBe("refresh-2");
    const account = await notOrganicAccountRequest<{ did: string }>("/v1/account", {}, config);
    expect(account.did).toBe("did:plc:alice");
    expect(calls[0]).toMatchObject({ authorization: null });
    expect(calls[0]?.dpop).toStartWith("ey");
    expect(calls[1]).toMatchObject({ authorization: "DPoP access-2" });
    expect(calls[1]?.dpop).toStartWith("ey");
  });

  test("parses the nested account envelope returned by /v1/account", async () => {
    const credentials = memoryCredentials();
    setAccountCredentialStoreForTests(credentials.store);
    setAccountCryptoAdapterForTests({
      randomBytes: async (length) => new Uint8Array(length).fill(4),
      sha256Base64: async (value) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("base64"),
    });
    setDeviceKeyAdapterForTests({
      getOrCreatePublicJwkAsync: async () => publicJwk,
      signAsync: async () => "signature",
      deleteKeyAsync: async () => {},
    });
    await saveDeviceSession({ accessToken: "account-access", accessExpiresAt: Date.now() + 60_000, refreshToken: "account-refresh", refreshExpiresAt: Date.now() + 120_000, scope: config.scope });
    setAccountFetchForTests((async () => Response.json({
      account: { did: "did:plc:nested", handle: "nested.test", display_name: "Nested Learner" },
      products: [{ productId: "hosted" }],
      subscriptions: [{ status: "active" }],
    })) as typeof fetch);

    const account = await loadAccountSnapshot(config);
    expect(account).toMatchObject({ did: "did:plc:nested", handle: "nested.test" });
    expect(await loadDeviceSession()).toMatchObject({ accountId: "did:plc:nested" });
  });

  test("builds a proof whose payload is bound to the supplied token", async () => {
    setAccountCryptoAdapterForTests({
      randomBytes: async (length) => new Uint8Array(length).fill(1),
      sha256Base64: async (value) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("base64"),
    });
    setDeviceKeyAdapterForTests({
      getOrCreatePublicJwkAsync: async () => publicJwk,
      signAsync: async () => "signature",
      deleteKeyAsync: async () => {},
    });
    const proof = await createDpopProof({ url: "https://gateway.test/v1/account", method: "GET", boundToken: "access", now: 1_000, jti: "proof-1" });
    const payload = JSON.parse(Buffer.from(proof.split(".")[1]!, "base64url").toString("utf8"));
    expect(payload).toMatchObject({ htm: "GET", htu: "https://gateway.test/v1/account", iat: 1, jti: "proof-1" });
    expect(payload.ath).toBeTypeOf("string");
  });
});

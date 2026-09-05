import { afterEach, describe, expect, test } from "bun:test";
import {
  completeAuthorizationFromUrl,
  createAuthorizationRequest,
} from "../src/lib/notorganic-account/auth";
import {
  activeDeviceSession,
  refreshDeviceSession,
  exchangeAuthorizationCode,
	notOrganicAccountCapabilityHeaders,
  notOrganicAccountRequest,
  setAccountFetchForTests,
} from "../src/lib/notorganic-account/client";
import {
  accountCredentialKeysForTests,
  clearDeviceSession,
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
		expect(await loadPendingAuthorization()).toMatchObject({ state: second.state });
		await completeAuthorizationFromUrl(`${NOTORGANIC_MOBILE_REDIRECT_URI}?code=legitimate&state=${second.state}`, config);
		expect(credentials.values.has(keys.pending)).toBe(false);
  });

	test("deduplicates concurrent delivery of the same OAuth callback", async () => {
		const credentials = memoryCredentials();
		setAccountCredentialStoreForTests(credentials.store);
		setAccountCryptoAdapterForTests({
			randomBytes: async (length) => new Uint8Array(length).fill(6),
			sha256Base64: async (value) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("base64"),
		});
		setDeviceKeyAdapterForTests({
			getOrCreatePublicJwkAsync: async () => publicJwk,
			signAsync: async () => "native-signature",
			deleteKeyAsync: async () => {},
		});
		let exchangeCalls = 0;
		let signalExchangeStarted!: () => void;
		const exchangeStarted = new Promise<void>((resolve) => { signalExchangeStarted = resolve; });
		let releaseExchange!: () => void;
		const exchangeReleased = new Promise<void>((resolve) => { releaseExchange = resolve; });
		setAccountFetchForTests((async () => {
			exchangeCalls += 1;
			signalExchangeStarted();
			await exchangeReleased;
			return Response.json({
				access_token: "access-concurrent",
				token_type: "DPoP",
				expires_in: 300,
				scope: config.scope,
				refresh_token: "nou_ds_00000000-0000-4000-8000-000000000000.concurrent",
				refresh_expires_in: 2_592_000,
			});
		}) as unknown as typeof fetch);

		const request = await createAuthorizationRequest(config);
		const callback = `${NOTORGANIC_MOBILE_REDIRECT_URI}?code=single-code&state=${request.state}`;
		const first = completeAuthorizationFromUrl(callback, config);
		await exchangeStarted;
		const second = completeAuthorizationFromUrl(callback, config);
		releaseExchange();
		const [firstSession, secondSession] = await Promise.all([first, second]);
		expect(exchangeCalls).toBe(1);
		expect(secondSession).toEqual(firstSession);
		expect(await loadPendingAuthorization()).toBeNull();
		expect(await loadDeviceSession()).toMatchObject({ accessToken: "access-concurrent" });
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
		const capabilityHeaders = await notOrganicAccountCapabilityHeaders("/v1/tavus/conversations", "POST", config);
		expect(capabilityHeaders.get("authorization")).toBe("DPoP access-2");
		expect(capabilityHeaders.get("x-notorganic-dpop")).toStartWith("ey");
		const capabilityPayload = JSON.parse(Buffer.from(capabilityHeaders.get("x-notorganic-dpop")!.split(".")[1]!, "base64url").toString("utf8"));
		expect(capabilityPayload).toMatchObject({ htm: "POST", htu: "https://gateway.test/v1/tavus/conversations" });
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

for (const change of ["logout", "new login"] as const) {
  test(`a delayed refresh cannot overwrite ${change}`, async () => {
    const credentials = memoryCredentials();
    setAccountCredentialStoreForTests(credentials.store);
    setAccountCryptoAdapterForTests({ randomBytes: async (length) => new Uint8Array(length), sha256Base64: async () => "hash" });
    setDeviceKeyAdapterForTests({ getOrCreatePublicJwkAsync: async () => publicJwk, signAsync: async () => "signature", deleteKeyAsync: async () => undefined });
    const initial = { accessToken: "expired", accessExpiresAt: 0, refreshToken: "refresh-old", refreshExpiresAt: Date.now() + 60_000, scope: config.scope };
    await saveDeviceSession(initial);
    let reply!: (response: Response) => void;
    let started!: () => void;
    const sent = new Promise<void>((resolve) => { started = resolve; });
    setAccountFetchForTests((async () => {
      started();
      return new Promise<Response>((resolve) => { reply = resolve; });
    }) as typeof fetch);
    const refresh = refreshDeviceSession(config);
    await sent;
    if (change === "logout") await clearDeviceSession();
    else await saveDeviceSession({ ...initial, accessToken: "new-login", refreshToken: "new-login-refresh" });
    reply(Response.json({ access_token: "stale", token_type: "DPoP", expires_in: 300, refresh_token: "stale-refresh", refresh_expires_in: 600, scope: config.scope }));
    await expect(refresh).rejects.toThrow("account session changed");
    expect((await loadDeviceSession())?.accessToken ?? null).toBe(change === "logout" ? null : "new-login");
  });
}

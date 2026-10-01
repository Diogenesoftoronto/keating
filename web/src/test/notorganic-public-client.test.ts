import { describe, expect, it } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { NotOrganicPublicClient, publicClientConfig, publicClientMaxCostMicrousd, safeAuthorizationReturnTo } from "../notorganic-provider/public-client";

class MemoryStorage implements Storage {
	private readonly values = new Map<string, string>();
	get length() { return this.values.size; }
	clear() { this.values.clear(); }
	getItem(key: string) { return this.values.get(key) ?? null; }
	key(index: number) { return [...this.values.keys()][index] ?? null; }
	removeItem(key: string) { this.values.delete(key); }
	setItem(key: string, value: string) { this.values.set(key, value); }
}

function installBrowser(): void {
	Object.defineProperty(globalThis, "sessionStorage", { configurable: true, writable: true, value: new MemoryStorage() });
	Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: new MemoryStorage() });
	Object.defineProperty(globalThis, "indexedDB", { configurable: true, writable: true, value: new IDBFactory() });
}

const config = { issuer: "https://provider.test", authorizationUrl: "https://portal.test/authorize", clientId: "https://keating.test/client", redirectUri: "https://keating.test/notorganic/callback", scope: "wallet:read" };
const stubFetch = (handler: (...args: Parameters<typeof fetch>) => Promise<Response>): typeof fetch => Object.assign(handler, { preconnect: fetch.preconnect });
const successToken = () => Response.json({ access_token: "short-lived", token_type: "DPoP", expires_in: 300, scope: "wallet:read" });
const deviceToken = (access: string, refresh: string, expiresIn = 300) => Response.json({ access_token: access, token_type: "DPoP", expires_in: expiresIn, scope: "wallet:read", refresh_token: refresh, refresh_expires_in: 30 * 86_400 });
const proofClaims = (proof: string | null) => JSON.parse(atob(proof!.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")));
const sha256 = async (value: string) => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const expireAccess = () => {
	const session = JSON.parse(localStorage.getItem("keating.notorganic.session")!);
	localStorage.setItem("keating.notorganic.session", JSON.stringify({ ...session, expiresAt: Date.now() - 1 }));
};
const callback = (authorize: string, code = "one-time-code") => new URLSearchParams({ code, state: new URL(authorize).searchParams.get("state")! });

describe("Not Organic public client", () => {
	it("returns to the originating setup page without accepting external redirects", () => {
		expect(safeAuthorizationReturnTo("/")).toBe("/");
		expect(safeAuthorizationReturnTo("/?session=learner-session")).toBe("/?session=learner-session");
		expect(safeAuthorizationReturnTo("/live")).toBe("/live");
		expect(safeAuthorizationReturnTo("/courses/my-course?lesson=intro")).toBe("/courses/my-course?lesson=intro");
		expect(safeAuthorizationReturnTo("/chat")).toBe("/chat");
		expect(safeAuthorizationReturnTo("/pricing?pack=keating_pack_10")).toBe("/pricing?pack=keating_pack_10");
		for (const path of ["https://example.com", "//example.com", "/\\example.com", "/notorganic/callback", undefined]) expect(safeAuthorizationReturnTo(path)).toBe("/pricing");
	});
	it("requires explicit public-client deployment configuration", () => {
		expect(publicClientConfig({})).toBeNull();
		expect(publicClientConfig({ VITE_NOTORGANIC_PUBLIC_ISSUER: "https://provider.test/", VITE_NOTORGANIC_AUTHORIZATION_URL: "https://portal.test/authorize", VITE_NOTORGANIC_CLIENT_ID: "https://keating.test/client", VITE_NOTORGANIC_REDIRECT_URI: "https://keating.test/notorganic/callback" })).toMatchObject({
			issuer: "https://provider.test",
			scope: "wallet:read usage:read billing:checkout infer:balanced infer:image realtime:connect",
		});
		expect(publicClientMaxCostMicrousd({})).toBe(100_000);
		expect(() => publicClientMaxCostMicrousd({ VITE_NOTORGANIC_MAX_COST_MICROUSD: "0" })).toThrow("positive integer");
	});

	it("uses the actual browser origin for local and hosted public callbacks", () => {
		const env = {
			VITE_NOTORGANIC_ENABLED: "true",
			VITE_NOTORGANIC_PUBLIC_ISSUER: "https://api.notorganic.info",
			VITE_NOTORGANIC_AUTHORIZATION_URL: "https://id.notorganic.info/authorize",
			VITE_NOTORGANIC_CLIENT_ID: "",
			VITE_NOTORGANIC_REDIRECT_URI: "",
		};
		for (const origin of ["http://localhost:3000", "http://127.0.0.1:4321", "http://[::1]:3000", "https://keating.help", "https://chat.keating.help"]) {
			expect(publicClientConfig(env, origin)).toMatchObject({ clientId: origin, redirectUri: `${origin}/notorganic/callback` });
		}
		for (const origin of ["http://example.com", "file://", "null", "not a URL"]) {
			expect(publicClientConfig(env, origin)).toBeNull();
		}
		expect(publicClientConfig({ ...env, VITE_NOTORGANIC_ENABLED: "false" }, "http://localhost:3000")).toMatchObject({
			clientId: "http://localhost:3000",
			redirectUri: "http://localhost:3000/notorganic/callback",
		});
		expect(publicClientConfig({}, "http://localhost:3000")).toBeNull();
	});

	it("keeps first-party browser authorization on its origin despite legacy deployment pins", () => {
		for (const pinnedOrigin of ["https://keating.help", "https://chat.keating.help"]) {
			const env = {
				VITE_NOTORGANIC_PUBLIC_ISSUER: "https://api.notorganic.info",
				VITE_NOTORGANIC_AUTHORIZATION_URL: "https://id.notorganic.info/authorize",
				VITE_NOTORGANIC_CLIENT_ID: pinnedOrigin,
				VITE_NOTORGANIC_REDIRECT_URI: `${pinnedOrigin}/notorganic/callback`,
			};
			for (const origin of ["https://keating.help", "https://chat.keating.help"]) {
				expect(publicClientConfig(env, origin, false)).toMatchObject({ clientId: origin, redirectUri: `${origin}/notorganic/callback` });
			}
			expect(publicClientConfig(env, "http://127.0.0.1:5173", true)).toMatchObject({
				clientId: "http://127.0.0.1:53693", redirectUri: "http://127.0.0.1:53693/notorganic/callback",
			});
		}
	});

	it("returns a successful app-root sign-in to the same origin with its session intact", async () => {
		installBrowser();
		const origin = "https://chat.keating.help";
		const appConfig = publicClientConfig({
			VITE_NOTORGANIC_PUBLIC_ISSUER: "https://provider.test",
			VITE_NOTORGANIC_AUTHORIZATION_URL: "https://portal.test/authorize",
			VITE_NOTORGANIC_CLIENT_ID: "https://keating.help",
			VITE_NOTORGANIC_REDIRECT_URI: "https://keating.help/notorganic/callback",
		}, origin, false)!;
		const client = new NotOrganicPublicClient(appConfig, stubFetch(async (_input, init) => {
			expect(JSON.parse(String(init?.body))).toMatchObject({ client_id: origin, redirect_uri: `${origin}/notorganic/callback` });
			return deviceToken("app-access", "app-refresh");
		}));
		const authorize = new URL(await client.authorizationUrl("/?session=learner-session"));
		expect(new URL(authorize.searchParams.get("redirect_uri")!).origin).toBe(origin);
		const session = await client.completeAuthorization(callback(authorize.toString()));
		expect(new URL(safeAuthorizationReturnTo(session.returnTo), origin).href).toBe(`${origin}/?session=learner-session`);
		expect(new NotOrganicPublicClient(appConfig).getSession()).toMatchObject({ accessToken: "app-access", refreshToken: "app-refresh" });
	});

	it("uses a state-bound PKCE handoff and exchanges it with a DPoP public key", async () => {
		installBrowser();
		let exchange: Record<string, unknown> | undefined;
		let checkoutHeaders: Headers | undefined;
		const client = new NotOrganicPublicClient({ issuer: "https://provider.test", authorizationUrl: "https://portal.test/authorize", clientId: "https://keating.test/client", redirectUri: "https://keating.test/notorganic/callback", scope: "wallet:read" }, (async (input, init) => {
			if (String(input).endsWith("/v1/public/token")) {
				exchange = JSON.parse(String(init?.body));
				return Response.json({ access_token: "short-lived", token_type: "DPoP", expires_in: 300, scope: "wallet:read" });
			}
			const headers = new Headers(init?.headers);
			if (init?.method === "POST") checkoutHeaders = headers;
			expect(headers.get("authorization")).toBe("DPoP short-lived");
			expect(headers.get("dpop")).toContain(".");
			return Response.json({ balance_microusd: 500_000 });
		}) as typeof fetch);
		const authorize = new URL(await client.authorizationUrl("/chat"));
		expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
		expect(authorize.searchParams.get("code_challenge")).toBeTruthy();
		await expect(client.completeAuthorization(new URLSearchParams({ code: "one-time-code", state: "wrong" }))).rejects.toThrow("could not be verified");
		const session = await client.completeAuthorization(new URLSearchParams({ code: "one-time-code", state: authorize.searchParams.get("state")! }));
		expect(session.accessToken).toBe("short-lived");
		expect(session.returnTo).toBe("/chat");
		expect(exchange).toMatchObject({ code: "one-time-code", client_id: "https://keating.test/client", dpop_jwk: { kty: "EC", crv: "P-256" } });
		expect(exchange?.code_verifier).toBeTypeOf("string");
		const wallet = await client.request("/v1/wallet");
		expect(wallet.ok).toBe(true);
		const headers = await client.headersFor("POST", "https://provider.test/v1/chat/completions");
		expect(headers.get("authorization")).toBe("DPoP short-lived");
		expect(headers.get("dpop")).toContain(".");
		await client.request("/v1/billing/checkout", { method: "POST", body: "{}" });
		expect(checkoutHeaders?.get("idempotency-key")).toMatch(/^keating_/);
	});

	it("shares duplicate callbacks across remounted clients and reuses only a matching completed callback", async () => {
		installBrowser();
		let exchanges = 0;
		const fetcher = stubFetch(async () => { exchanges++; return successToken(); });
		const first = new NotOrganicPublicClient(config, fetcher);
		const search = callback(await first.authorizationUrl("/chat"));
		const second = new NotOrganicPublicClient(config, fetcher);
		const sessions = await Promise.all([first.completeAuthorization(search), second.completeAuthorization(search)]);
		expect(exchanges).toBe(1);
		expect(sessions[0]).toEqual(sessions[1]);
		const reloaded = new NotOrganicPublicClient(config, fetcher);
		expect(await reloaded.completeAuthorization(search)).toEqual(sessions[0]);
		expect(exchanges).toBe(1);
		await expect(reloaded.completeAuthorization(new URLSearchParams({ code: "different-code", state: search.get("state")! }))).rejects.toThrow("could not be verified");
		await expect(reloaded.completeAuthorization(new URLSearchParams({ code: search.get("code")!, state: "different-state" }))).rejects.toThrow("could not be verified");
	});

	it.each(["issuer", "clientId", "redirectUri"] as const)("binds the callback to its original %s without consuming the valid transaction", async (field) => {
		installBrowser();
		let exchanges = 0;
		const fetcher = stubFetch(async () => { exchanges++; return successToken(); });
		const client = new NotOrganicPublicClient(config, fetcher);
		const search = callback(await client.authorizationUrl());
		const changed = new NotOrganicPublicClient({ ...config, [field]: "https://different.test" }, fetcher);
		await expect(changed.completeAuthorization(search)).rejects.toThrow("could not be verified");
		expect(exchanges).toBe(0);
		await expect(client.completeAuthorization(search)).resolves.toMatchObject({ accessToken: "short-lived" });
		expect(exchanges).toBe(1);
	});

	it.each([Date.now() - 10 * 60_000, Date.now() + 60_000, "invalid", null])("rejects expired or invalid transaction timestamps: %j", async (createdAt) => {
		installBrowser();
		let exchanges = 0;
		const client = new NotOrganicPublicClient(config, stubFetch(async () => { exchanges++; return successToken(); }));
		const search = callback(await client.authorizationUrl());
		const transaction = JSON.parse(sessionStorage.getItem("keating.notorganic.authorization")!);
		sessionStorage.setItem("keating.notorganic.authorization", JSON.stringify({ ...transaction, createdAt }));
		await expect(client.completeAuthorization(search)).rejects.toThrow("could not be verified");
		expect(exchanges).toBe(0);
	});

	it("does not accept a callback in a new tab without a locally stored transaction", async () => {
		installBrowser();
		let exchanges = 0;
		const client = new NotOrganicPublicClient(config, stubFetch(async () => { exchanges++; return successToken(); }));
		const search = callback(await client.authorizationUrl());
		sessionStorage.clear();
		await expect(client.completeAuthorization(search)).rejects.toThrow("Return to the browser tab where you started signing in");
		expect(exchanges).toBe(0);
	});

	it("keeps the verified transaction for retry after a transient exchange failure", async () => {
		installBrowser();
		let exchanges = 0;
		const client = new NotOrganicPublicClient(config, stubFetch(async () => {
			if (++exchanges === 1) throw new Error("Network unavailable");
			return successToken();
		}));
		const search = callback(await client.authorizationUrl());
		await expect(client.completeAuthorization(search)).rejects.toThrow("Network unavailable");
		await expect(client.completeAuthorization(search)).resolves.toMatchObject({ accessToken: "short-lived" });
		expect(exchanges).toBe(2);
	});

	it("cannot restore a signed-out session using a completed callback", async () => {
		installBrowser();
		const client = new NotOrganicPublicClient(config, stubFetch(async () => successToken()));
		const search = callback(await client.authorizationUrl());
		await client.completeAuthorization(search);
		await client.signOut();
		await expect(client.completeAuthorization(search)).rejects.toThrow("could not be verified");
		expect(client.getSession()).toBeNull();
	});

	it("expires completion receipts even while the provider session remains valid", async () => {
		installBrowser();
		const client = new NotOrganicPublicClient(config, stubFetch(async () => successToken()));
		const search = callback(await client.authorizationUrl());
		await client.completeAuthorization(search);
		const receipt = JSON.parse(sessionStorage.getItem("keating.notorganic.authorization-completed")!);
		sessionStorage.setItem("keating.notorganic.authorization-completed", JSON.stringify({ ...receipt, createdAt: Date.now() - 10 * 60_000 }));
		await expect(client.completeAuthorization(search)).rejects.toThrow("could not be verified");
		expect(client.getSession()).not.toBeNull();
	});

	it("does not let an old exchange consume a newer login or establish its session", async () => {
		installBrowser();
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		let exchanges = 0;
		const client = new NotOrganicPublicClient(config, stubFetch(async () => {
			if (++exchanges === 1) { started.resolve(); await release.promise; }
			return successToken();
		}));
		const first = client.completeAuthorization(callback(await client.authorizationUrl()));
		await started.promise;
		const newer = callback(await client.authorizationUrl());
		release.resolve();
		await expect(first).rejects.toThrow("could not be verified");
		expect(client.getSession()).toBeNull();
		await expect(client.completeAuthorization(newer)).resolves.toMatchObject({ accessToken: "short-lived" });
		expect(exchanges).toBe(2);
	});

	it.each([false, true])("calls native fetch with its browser receiver, explicitly injected: %s", async (explicit) => {
		installBrowser();
		const originalFetch = globalThis.fetch;
		const calls: string[] = [];
		globalThis.fetch = Object.assign(async function(this: typeof globalThis, ...args: Parameters<typeof fetch>) {
			expect(this).toBe(globalThis);
			calls.push(String(args[0]));
			return String(args[0]).endsWith("/v1/public/token") ? successToken() : Response.json({ balance_microusd: 10 });
		}, { preconnect: originalFetch.preconnect });
		try {
			const client = explicit ? new NotOrganicPublicClient(config, globalThis.fetch) : new NotOrganicPublicClient(config);
			await client.completeAuthorization(callback(await client.authorizationUrl()));
			expect(await (await client.request("/v1/wallet")).json()).toEqual({ balance_microusd: 10 });
			expect(calls).toEqual(["https://provider.test/v1/public/token", "https://provider.test/v1/wallet"]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
	it("renews an expired access token through the device session instead of asking to sign in", async () => {
		installBrowser();
		const calls: { url: string; body: Record<string, unknown>; headers: Headers }[] = [];
		let refreshes = 0;
		const client = new NotOrganicPublicClient(config, stubFetch(async (input, init) => {
			const url = String(input);
			calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {}, headers: new Headers(init?.headers) });
			if (url.endsWith("/v1/public/token")) return deviceToken("access-1", "refresh-1");
			if (url.endsWith("/v1/public/device/token")) { refreshes++; return deviceToken("access-2", "refresh-2"); }
			return Response.json({ ok: true });
		}) as typeof fetch);
		const signedIn = await client.completeAuthorization(callback(await client.authorizationUrl("/chat")));
		expect(calls[0]!.body).toMatchObject({ device_session: true, device_name: "Keating web" });
		// The session outlives the tab that signed in.
		sessionStorage.clear();
		expireAccess();
		expect(client.getSession()).not.toBeNull();
		await Promise.all([client.request("/v1/wallet"), client.request("/v1/wallet")]);
		expect(refreshes).toBe(1);
		const refresh = calls.find(call => call.url.endsWith("/v1/public/device/token"))!;
		expect(refresh.body).toEqual({ grant_type: "refresh_token", refresh_token: "refresh-1" });
		expect(proofClaims(refresh.headers.get("dpop"))).toMatchObject({ htm: "POST", htu: "https://provider.test/v1/public/device/token", ath: await sha256("refresh-1") });
		expect(calls.filter(call => call.url.endsWith("/v1/wallet")).map(call => call.headers.get("authorization"))).toEqual(["DPoP access-2", "DPoP access-2"]);
		const renewed = client.getSession()!;
		expect(renewed).toMatchObject({ accessToken: "access-2", refreshToken: "refresh-2", id: signedIn.id, returnTo: "/chat" });
	});

	it("signs out when the provider rejects the device session", async () => {
		installBrowser();
		const client = new NotOrganicPublicClient(config, stubFetch(async (input) =>
			String(input).endsWith("/v1/public/token") ? deviceToken("access-1", "refresh-1") : Response.json({ error: { code: "invalid_device_session" } }, { status: 401 })) as typeof fetch);
		await client.completeAuthorization(callback(await client.authorizationUrl()));
		expireAccess();
		await expect(client.headersFor("GET", "https://provider.test/v1/wallet")).rejects.toThrow("Connect your Not Organic account");
		expect(client.getSession()).toBeNull();
	});

	it("keeps the session through a transient renewal failure", async () => {
		installBrowser();
		const client = new NotOrganicPublicClient(config, stubFetch(async (input) =>
			String(input).endsWith("/v1/public/token") ? deviceToken("access-1", "refresh-1") : new Response("unavailable", { status: 503 })) as typeof fetch);
		await client.completeAuthorization(callback(await client.authorizationUrl()));
		expireAccess();
		await expect(client.activeSession()).rejects.toThrow("could not renew");
		expect(client.getSession()?.refreshToken).toBe("refresh-1");
	});

	it("revokes the device session on sign-out", async () => {
		installBrowser();
		const calls: { url: string; body: unknown; dpop: string | null }[] = [];
		const client = new NotOrganicPublicClient(config, stubFetch(async (input, init) => {
			calls.push({ url: String(input), body: JSON.parse(String(init?.body)), dpop: new Headers(init?.headers).get("dpop") });
			return String(input).endsWith("/v1/public/token") ? deviceToken("access-1", "refresh-1") : new Response(null, { status: 204 });
		}) as typeof fetch);
		await client.completeAuthorization(callback(await client.authorizationUrl()));
		await client.signOut();
		expect(client.getSession()).toBeNull();
		const revoke = calls.at(-1)!;
		expect(revoke).toMatchObject({ url: "https://provider.test/v1/public/device/revoke", body: { refresh_token: "refresh-1" } });
		expect(proofClaims(revoke.dpop).ath).toBe(await sha256("refresh-1"));
	});

	it("cancels pending sign-in before waiting for device revocation", async () => {
		installBrowser();
		const revoking = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const client = new NotOrganicPublicClient(config, stubFetch(async (input) => {
			if (String(input).endsWith("/revoke")) {
				revoking.resolve();
				await release.promise;
				return new Response(null, { status: 204 });
			}
			return deviceToken("access-1", "refresh-1");
		}));
		await client.completeAuthorization(callback(await client.authorizationUrl()));
		const pendingCallback = callback(await client.authorizationUrl());
		const signingOut = client.signOut();
		await revoking.promise;
		try {
			await expect(client.completeAuthorization(pendingCallback)).rejects.toThrow("could not be verified");
			expect(client.getSession()).toBeNull();
		} finally {
			release.resolve();
			await signingOut;
		}
	});
});

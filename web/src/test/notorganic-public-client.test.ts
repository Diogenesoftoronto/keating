import { describe, expect, it } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { NotOrganicPublicClient, publicClientConfig, publicClientMaxCostMicrousd } from "../notorganic-provider/public-client";

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
	Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: new MemoryStorage() });
	Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
}

describe("Not Organic public client", () => {
	it("requires explicit public-client deployment configuration", () => {
		expect(publicClientConfig({})).toBeNull();
		expect(publicClientConfig({ VITE_NOTORGANIC_PUBLIC_ISSUER: "https://provider.test/", VITE_NOTORGANIC_AUTHORIZATION_URL: "https://portal.test/authorize", VITE_NOTORGANIC_CLIENT_ID: "https://keating.test/client", VITE_NOTORGANIC_REDIRECT_URI: "https://keating.test/notorganic/callback" })).toMatchObject({ issuer: "https://provider.test", scope: "wallet:read usage:read billing:checkout infer:balanced" });
		expect(publicClientMaxCostMicrousd({})).toBe(100_000);
		expect(() => publicClientMaxCostMicrousd({ VITE_NOTORGANIC_MAX_COST_MICROUSD: "0" })).toThrow("positive integer");
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
		const authorize = new URL(await client.authorizationUrl("/pricing"));
		expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
		expect(authorize.searchParams.get("code_challenge")).toBeTruthy();
		await expect(client.completeAuthorization(new URLSearchParams({ code: "one-time-code", state: "wrong" }))).rejects.toThrow("could not be verified");
		await expect(client.completeAuthorization(new URLSearchParams({ code: "one-time-code", state: authorize.searchParams.get("state")! }))).rejects.toThrow("could not be verified");
		const authorizeAgain = new URL(await client.authorizationUrl());
		const session = await client.completeAuthorization(new URLSearchParams({ code: "one-time-code", state: authorizeAgain.searchParams.get("state")! }));
		expect(session.accessToken).toBe("short-lived");
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
});

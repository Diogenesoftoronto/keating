import { describe, expect, it } from "bun:test";
import { mockEvent } from "h3";
import {
	NOTORGANIC_DEFAULT_MODEL,
	NOTORGANIC_MODEL_ALIAS,
	NOTORGANIC_PROVIDER_ID,
	createNotOrganicCheckout,
	getNotOrganicUsage,
	isNotOrganicProvider,
	notOrganicOpenAiBaseUrl,
} from "../notorganic-provider";
import {
	NOTORGANIC_IDEMPOTENCY_HEADER,
	NOTORGANIC_MAX_COST_HEADER,
	NotOrganicFetchAdapter,
} from "../notorganic-provider/fetch-adapter";
import {
	NOTORGANIC_AUTH_OPERATIONAL_BLOCKER,
	NotOrganicOperationalError,
	getNotOrganicServerConfig,
} from "../notorganic-provider/server";

describe("Not Organic provider definition", () => {
	it("uses the stable balanced alias and dedicated same-origin path", () => {
		expect(NOTORGANIC_DEFAULT_MODEL.id).toBe(NOTORGANIC_MODEL_ALIAS);
		expect(NOTORGANIC_DEFAULT_MODEL.provider).toBe(NOTORGANIC_PROVIDER_ID);
		expect(notOrganicOpenAiBaseUrl("https://keating.test/")).toBe(
			"https://keating.test/api/notorganic/openai/v1",
		);
		expect(isNotOrganicProvider("notorganic")).toBe(true);
		expect(isNotOrganicProvider("dio")).toBe(false);
	});
});

describe("Not Organic SDK-compatible fetch adapter", () => {
	it("keeps the capability server-side and supplies DPoP, cost, and idempotency headers", async () => {
		let observed: { url?: string; init?: RequestInit } = {};
		const adapter = new NotOrganicFetchAdapter({
			baseUrl: "https://provider.test",
			session: {
				accountId: "did:plc:alice",
				accessToken: "server-capability",
				createDpopProof: async ({ method, url, accessToken }) =>
					`${method}:${url}:${accessToken}`,
			},
			fetch: (async (url, init) => {
				observed = { url: String(url), init };
				return Response.json({ ok: true });
			}) as typeof fetch,
		});

		await adapter.request("/v1/chat/completions", {
			method: "POST",
			body: JSON.stringify({ model: "balanced" }),
			headers: { "content-type": "application/json" },
			maxCostMicrousd: 50_000,
			idempotencyKey: "idem-keating",
		});

		const headers = new Headers(observed.init?.headers);
		expect(observed.url).toBe("https://provider.test/v1/chat/completions");
		expect(headers.get("authorization")).toBe("DPoP server-capability");
		expect(headers.get("dpop")).toContain("server-capability");
		expect(headers.get(NOTORGANIC_MAX_COST_HEADER)).toBe("50000");
		expect(headers.get(NOTORGANIC_IDEMPOTENCY_HEADER)).toBe("idem-keating");
	});
});

describe("Not Organic browser resource client", () => {
	it("calls usage and checkout through same-origin product routes", async () => {
		const calls: string[] = [];
		const fetcher = (async (input, init) => {
			calls.push(`${init?.method ?? "GET"} ${String(input)}`);
			return Response.json({ object: "list", data: [] });
		}) as typeof fetch;

		await getNotOrganicUsage({ after: "cursor", limit: 10 }, fetcher);
		await createNotOrganicCheckout(
			"keating_pack_25",
			"https://keating.test/settings",
			fetcher,
		);

		expect(calls).toEqual([
			"GET /api/notorganic/provider/usage?after=cursor&limit=10",
			"POST /api/notorganic/provider/checkout",
		]);
	});
});

describe("Not Organic operational config", () => {
	it("does not invent a product session when auth deployment is absent", () => {
		expect(NOTORGANIC_AUTH_OPERATIONAL_BLOCKER).toContain("Better Auth");
		expect(() =>
			getNotOrganicServerConfig({
				NOTORGANIC_ENABLED: "true",
				NOTORGANIC_ISSUER: "https://provider.test",
			} as NodeJS.ProcessEnv),
		).toThrow(NotOrganicOperationalError);
	});

	it("requires the server-only gateway and a positive request cap", () => {
		expect(
			getNotOrganicServerConfig({
				NOTORGANIC_ENABLED: "true",
				NOTORGANIC_ISSUER: "https://provider.test",
				NOTORGANIC_MAX_COST_MICROUSD: "50000",
			} as NodeJS.ProcessEnv),
		).toEqual({
			enabled: true,
			gatewayBaseUrl: "https://provider.test",
			maxCostMicrousd: 50000,
		});
	});
});

describe("Not Organic Nitro routing", () => {
	it("unlocks account sync only through the server-held product session", async () => {
		const previous = {
			enabled: process.env.NOTORGANIC_ENABLED,
			url: process.env.NOTORGANIC_ISSUER,
			cost: process.env.NOTORGANIC_MAX_COST_MICROUSD,
		};
		const originalFetch = globalThis.fetch;
		let feature = "";
		let observed: { url?: string; body?: string; headers?: Headers } = {};
		process.env.NOTORGANIC_ENABLED = "true";
		process.env.NOTORGANIC_ISSUER = "https://provider.test";
		process.env.NOTORGANIC_MAX_COST_MICROUSD = "75000";
		globalThis.fetch = (async (input, init) => {
			observed = { url: String(input), body: String(init?.body), headers: new Headers(init?.headers) };
			return Response.json({ version: 1, key_id: "1".repeat(32) });
		}) as typeof fetch;
		try {
			const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
			const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
			const handler = (await import("../../server/api/notorganic/sync/account-key.post")).default;
			const event = mockEvent(new Request("https://keating.test/api/notorganic/sync/account-key", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ client_public_jwk: publicJwk }),
			}));
			event.context.notOrganicSessionAdapter = {
				getProductSession: async (_event: unknown, request: { feature: string }) => {
					feature = request.feature;
					return {
						accountId: "did:plc:alice",
						accessToken: "server-capability",
						createDpopProof: async () => "server-proof",
					};
				},
			};
			const response = await handler(event) as Response;
			expect(feature).toBe("keating:sync-key");
			expect(observed.url).toBe("https://provider.test/v1/sync/account-key");
			expect(observed.headers?.get("authorization")).toBe("DPoP server-capability");
			expect(observed.headers?.get("dpop")).toBe("server-proof");
			expect(observed.body).not.toContain("did:plc:alice");
			expect(JSON.parse(observed.body ?? "{}")).toEqual({ client_public_jwk: publicJwk });
			expect(response.headers.get("cache-control")).toBe("no-store");
		} finally {
			globalThis.fetch = originalFetch;
			restoreEnv("NOTORGANIC_ENABLED", previous.enabled);
			restoreEnv("NOTORGANIC_ISSUER", previous.url);
			restoreEnv("NOTORGANIC_MAX_COST_MICROUSD", previous.cost);
		}
	});

	it("replaces the browser marker with the server session capability", async () => {
		const previous = {
			enabled: process.env.NOTORGANIC_ENABLED,
			url: process.env.NOTORGANIC_ISSUER,
			cost: process.env.NOTORGANIC_MAX_COST_MICROUSD,
		};
		const originalFetch = globalThis.fetch;
		let observed: { url?: string; headers?: Headers } = {};
		let feature = "";
		process.env.NOTORGANIC_ENABLED = "true";
		process.env.NOTORGANIC_ISSUER = "https://provider.test";
		process.env.NOTORGANIC_MAX_COST_MICROUSD = "75000";
		globalThis.fetch = (async (input, init) => {
			observed = { url: String(input), headers: new Headers(init?.headers) };
			return new Response("data: [DONE]\n\n", {
				headers: { "content-type": "text/event-stream" },
			});
		}) as typeof fetch;

		try {
			const handler = (await import("../../server/api/notorganic/openai/[...path]")).default;
			const event = mockEvent(
				new Request("https://keating.test/api/notorganic/openai/v1/chat/completions", {
					method: "POST",
					headers: {
						"content-type": "application/json",
						authorization: "Bearer browser-placeholder",
					},
					body: JSON.stringify({ model: "balanced", messages: [] }),
				}),
			);
			event.context.notOrganicSessionAdapter = {
				getProductSession: async (_event: unknown, request: { feature: string }) => {
					feature = request.feature;
					return {
						accountId: "did:plc:alice",
						accessToken: "server-capability",
						createDpopProof: async () => "server-proof",
					};
				},
			};

			const response = await handler(event) as Response;
			expect(response.status).toBe(200);
			expect(observed.url).toBe("https://provider.test/v1/chat/completions");
			expect(observed.headers?.get("authorization")).toBe("DPoP server-capability");
			expect(observed.headers?.get("authorization")).not.toContain("browser-placeholder");
			expect(observed.headers?.get(NOTORGANIC_MAX_COST_HEADER)).toBe("75000");
			expect(observed.headers?.get(NOTORGANIC_IDEMPOTENCY_HEADER)).toMatch(/^keating_/);
			expect(feature).toBe("keating:web-chat");
		} finally {
			globalThis.fetch = originalFetch;
			restoreEnv("NOTORGANIC_ENABLED", previous.enabled);
			restoreEnv("NOTORGANIC_ISSUER", previous.url);
			restoreEnv("NOTORGANIC_MAX_COST_MICROUSD", previous.cost);
		}
	});

	it("runs Python only through the fixed same-origin hosted-notebook route", async () => {
		const previous = {
			enabled: process.env.NOTORGANIC_ENABLED,
			url: process.env.NOTORGANIC_ISSUER,
			cost: process.env.NOTORGANIC_MAX_COST_MICROUSD,
		};
		const originalFetch = globalThis.fetch;
		const calls: Array<{ url: string; body: string; headers: Headers }> = [];
		let feature = "";
		process.env.NOTORGANIC_ENABLED = "true";
		process.env.NOTORGANIC_ISSUER = "https://provider.test";
		process.env.NOTORGANIC_MAX_COST_MICROUSD = "75000";
		globalThis.fetch = (async (input, init) => {
			const url = String(input);
			calls.push({ url, body: String(init?.body), headers: new Headers(init?.headers) });
			return url.startsWith("https://provider.test")
				? Response.json({ id: "sandbox_1", status: "queued" }, { status: 202 })
				: Response.json({ uri: "at://did:plc:alice/app.notorganic.codeSnapshot/snapshot" });
		}) as typeof fetch;

		try {
			const handler = (await import("../../server/api/notorganic/notebook/runs/index.post")).default;
			const event = mockEvent(new Request("https://keating.test/api/notorganic/notebook/runs", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					code: "print('hello')",
					filename: "lesson.py",
					language: "python",
					execution: {
						device_class: "desktop",
						network_class: "normal",
						code_bytes: 14,
					},
				}),
			}));
			event.context.notOrganicSessionAdapter = {
				getProductSession: async (_event: unknown, request: { feature: string }) => {
					feature = request.feature;
					return {
						accountId: "did:plc:alice",
						accessToken: "server-capability",
						createDpopProof: async () => "server-proof",
						pds: { url: "https://pds.test", accessToken: "pds-write-token" },
					};
				},
			};
			const response = await handler(event) as Response;
			expect(response.status).toBe(202);
			expect(feature).toBe("keating:notebook-run");
			const provider = calls.find((call) => call.url === "https://provider.test/v1/sandbox/runs");
			expect(provider?.headers.get("authorization")).toBe("DPoP server-capability");
			expect(provider?.headers.get(NOTORGANIC_MAX_COST_HEADER)).toBe("75000");
			expect(JSON.parse(provider?.body ?? "{}")).toEqual({
				project_id: "keating-chat",
				code: "print('hello')",
				filename: "lesson.py",
				language: "python",
				max_cost_microusd: 75_000,
				execution: {
					executor: "cloud",
					device_class: "desktop",
					network_class: "normal",
					code_bytes: 14,
				},
			});
			expect(calls.filter((call) => call.url === "https://pds.test/xrpc/com.atproto.repo.putRecord")).toHaveLength(2);
			expect(response.headers.get("x-keating-pds-snapshot")).toMatch(/^[0-9a-f-]{36}$/i);
		} finally {
			globalThis.fetch = originalFetch;
			restoreEnv("NOTORGANIC_ENABLED", previous.enabled);
			restoreEnv("NOTORGANIC_ISSUER", previous.url);
			restoreEnv("NOTORGANIC_MAX_COST_MICROUSD", previous.cost);
		}
	});
});

function restoreEnv(name: string, value: string | undefined): void {
	if (value === undefined) {
		delete process.env[name];
	} else {
		process.env[name] = value;
	}
}

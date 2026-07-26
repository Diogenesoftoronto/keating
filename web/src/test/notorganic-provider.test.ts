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
});

function restoreEnv(name: string, value: string | undefined): void {
	if (value === undefined) {
		delete process.env[name];
	} else {
		process.env[name] = value;
	}
}

import { describe, expect, it } from "bun:test";
import { mockEvent } from "h3";
import {
	NOTORGANIC_DEFAULT_MODEL,
	NOTORGANIC_INKLING_2_SMALL_MODEL,
	NOTORGANIC_SOL_MODEL,
	NOTORGANIC_LUNA_MODEL,
	NOTORGANIC_FLINT_MODEL,
	NOTORGANIC_MERCURY_2_MODEL,
	NOTORGANIC_MERCURY_3_MODEL,
	NOTORGANIC_ASTRA_MODEL,
	NOTORGANIC_INKLING_MODEL,
	createNotOrganicModelListing,
	getAvailableNotOrganicChatModels,
	NOTORGANIC_IMAGE_MODEL_ALIAS,
	NOTORGANIC_MODEL_ALIAS,
	NOTORGANIC_PROVIDER_ID,
	createNotOrganicCheckout,
	getNotOrganicUsage,
	isNotOrganicProvider,
	notOrganicOpenAiBaseUrl,
	notOrganicOpenAiImageEndpoint,
	notOrganicModelNeedsConsent,
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
	it("registers provisional Flint metadata without granting an existing session new authority", () => {
		expect(NOTORGANIC_FLINT_MODEL).toMatchObject({ id: "flint", name: "Flint (preview)", api: "openai-completions",
			provider: "notorganic", baseUrl: NOTORGANIC_DEFAULT_MODEL.baseUrl, input: ["text"], reasoning: false,
			contextWindow: 12288, maxTokens: 4096, compat: { maxTokensField: "max_completion_tokens", supportsStore: false } });
		const existing = { scope: "infer:balanced web:search web:fetch" };
		expect(notOrganicModelNeedsConsent(NOTORGANIC_FLINT_MODEL, existing)).toBe(true);
		expect(existing.scope).toBe("infer:balanced web:search web:fetch");
		expect(notOrganicModelNeedsConsent(NOTORGANIC_FLINT_MODEL, { scope: "infer:flint web:search web:fetch" })).toBe(false);
	});
	it("offers exactly the chat models the account gateway lists for this session", async () => {
		const listing = createNotOrganicModelListing({ storage: null });
		const ids = async (advertised: string[]) => (await getAvailableNotOrganicChatModels({
			getSession: () => ({ scope: "infer:text", id: advertised.join(",") }),
			request: async (path: string) => { expect(path).toBe("/v1/models"); return Response.json({ object: "list", data: advertised.map(id => ({ id, object: "model" })) }); },
		}, listing)).map(model => model.id);
		expect(await ids(["mercury-2", "balanced"])).toEqual(["balanced", "mercury-2"]);
		// Picker order follows the profiles; the gateway decides membership, including the default.
		expect(await ids(["mercury-3", "gpt-6-astra", "gpt-6.1-sol"])).toEqual(["gpt-6.1-sol", "gpt-6-astra", "mercury-3"]);
		expect(await ids(["gpt-6-luna", "inkling", "flint"])).toEqual(["gpt-6-luna", "inkling", "flint"]);
		// Image, speech and embedding aliases share the list but are not chat models.
		expect(await ids(["image", "embedding", "audio", "realtime", "unknown-alias"])).toEqual([]);
	});
	it("gives every advertised chat alias a callable profile", () => {
		expect(NOTORGANIC_MERCURY_2_MODEL).toMatchObject({
			id: "mercury-2", provider: "notorganic", api: "openai-completions", baseUrl: NOTORGANIC_DEFAULT_MODEL.baseUrl,
			cost: NOTORGANIC_DEFAULT_MODEL.cost, input: ["text"],
		});
		expect(NOTORGANIC_MERCURY_3_MODEL).toMatchObject({ id: "mercury-3", name: "Mercury 3", api: "openai-completions", input: ["text"],
			contextWindow: 1_000_000, maxTokens: 131_072, cost: NOTORGANIC_DEFAULT_MODEL.cost });
		expect(NOTORGANIC_ASTRA_MODEL).toMatchObject({ id: "gpt-6-astra", name: "GPT-6 Astra", api: "openai-responses",
			thinkingLevelMap: NOTORGANIC_SOL_MODEL.thinkingLevelMap, input: ["text", "image"] });
		expect(NOTORGANIC_INKLING_MODEL).toMatchObject({ id: "inkling", name: "Inkling", api: "openai-completions", contextWindow: 262_144 });
		for (const scope of ["infer:text", "infer:mercury-2"]) expect(notOrganicModelNeedsConsent(NOTORGANIC_MERCURY_2_MODEL, { scope })).toBe(false);
		for (const model of [NOTORGANIC_MERCURY_3_MODEL, NOTORGANIC_ASTRA_MODEL, NOTORGANIC_INKLING_MODEL]) {
			expect(notOrganicModelNeedsConsent(model, { scope: "infer:text" })).toBe(false);
		}
	});
	it("keeps the last answer when the gateway cannot answer, and offers only the default without one", async () => {
		const store = new Map<string, string>();
		const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
		let clock = 0;
		let calls = 0;
		const client = (scope: string, response: () => Response | Promise<Response>) => ({
			getSession: () => ({ scope, id: "device-session" }), request: async () => { calls++; return response(); },
		});
		const listed = (listing: ReturnType<typeof createNotOrganicModelListing>, scope: string, response: () => Response | Promise<Response>) =>
			getAvailableNotOrganicChatModels(client(scope, response), listing).then(models => models.map(model => model.id));
		const failures = [() => Response.json({ error: "unavailable" }, { status: 503 }), () => Response.json({ error: "malformed" }), () => { throw new Error("offline"); }];
		const unlisted = [NOTORGANIC_LUNA_MODEL.id];

		expect((await getAvailableNotOrganicChatModels(null)).map(model => model.id)).toEqual(unlisted);
		const fresh = createNotOrganicModelListing({ storage: null, now: () => clock });
		for (const failure of failures) expect(await listed(fresh, "infer:flint", failure)).toEqual(unlisted);

		const listing = createNotOrganicModelListing({ storage, now: () => clock });
		expect(await listed(listing, "infer:text", () => Response.json({ data: [{ id: "gpt-6.1-sol" }, { id: "balanced" }] }))).toEqual(["gpt-6.1-sol", "balanced"]);
		calls = 0;
		expect(await listed(listing, "infer:text", () => { throw new Error("A fresh answer is reused"); })).toEqual(["gpt-6.1-sol", "balanced"]);
		expect(calls).toBe(0);
		clock += 61_000;
		for (const failure of failures) expect(await listed(listing, "infer:text", failure)).toEqual(["gpt-6.1-sol", "balanced"]);
		// A reload restores the session's last answer; a different grant is a different answer.
		const reloaded = createNotOrganicModelListing({ storage, now: () => clock });
		expect(reloaded.snapshot(client("infer:text", () => Response.json({ data: [] })))).toMatchObject([{ id: "gpt-6.1-sol" }, { id: "balanced" }]);
		expect(reloaded.snapshot(client("infer:balanced", () => Response.json({ data: [] })))).toEqual([NOTORGANIC_LUNA_MODEL]);
		expect(await listed(reloaded, "infer:text", () => Response.json({ data: [{ id: "mercury-2" }] }))).toEqual(["mercury-2"]);
	});
	it("shares one gateway request among concurrent callers", async () => {
		let calls = 0;
		const listing = createNotOrganicModelListing({ storage: null });
		const client = { getSession: () => ({ scope: "infer:text" }), request: async () => { calls++; return Response.json({ data: [{ id: "gpt-6-luna" }] }); } };
		const results = await Promise.all([1, 2, 3].map(() => getAvailableNotOrganicChatModels(client, listing)));
		expect(calls).toBe(1);
		for (const models of results) expect(models).toEqual([NOTORGANIC_LUNA_MODEL]);
	});
	it("offers Sol through Responses and preserves narrow legacy grants", () => {
		expect(NOTORGANIC_SOL_MODEL).toMatchObject({
			id: "gpt-6.1-sol", name: "GPT-6.1 Sol", provider: "notorganic",
			api: "openai-responses", baseUrl: NOTORGANIC_DEFAULT_MODEL.baseUrl,
			reasoning: true, input: ["text", "image"],
		});
		const existing = { scope: "wallet:read infer:balanced" };
		expect(notOrganicModelNeedsConsent(NOTORGANIC_SOL_MODEL, existing)).toBe(true);
		expect(notOrganicModelNeedsConsent(NOTORGANIC_DEFAULT_MODEL, existing)).toBe(true);
		expect(notOrganicModelNeedsConsent(NOTORGANIC_SOL_MODEL, { scope: "infer:balanced infer:gpt-6.1-sol web:search web:fetch" })).toBe(false);
		expect(notOrganicModelNeedsConsent(NOTORGANIC_SOL_MODEL, { scope: "infer:gpt-6.1-sol-other" })).toBe(true);
		expect(notOrganicModelNeedsConsent(NOTORGANIC_SOL_MODEL, null)).toBe(false);
		expect(notOrganicModelNeedsConsent({ id: "gpt-6.1-sol", provider: "openai" }, existing)).toBe(false);
	});
	it("offers GPT-6 Luna as an ordinary hosted Responses model", async () => {
		expect(await getAvailableNotOrganicChatModels(null)).toContainEqual(NOTORGANIC_LUNA_MODEL);
		expect(NOTORGANIC_LUNA_MODEL).toMatchObject({ id: "gpt-6-luna", name: "GPT-6 Luna", provider: "notorganic",
			api: "openai-responses", input: ["text", "image"], compat: { supportsLongCacheRetention: false } });
		expect(notOrganicModelNeedsConsent(NOTORGANIC_LUNA_MODEL, { scope: "infer:text" })).toBe(false);
		expect(notOrganicModelNeedsConsent(NOTORGANIC_LUNA_MODEL, { scope: "infer:inkling-2-small" })).toBe(true);
	});
	it("does not demand optional web permissions just to select an authorized model", () => {
		for (const model of [NOTORGANIC_DEFAULT_MODEL, NOTORGANIC_SOL_MODEL]) {
			for (const webScopes of ["", "web:search", "web:fetch", "web:search-other web:fetch"]) {
				expect(notOrganicModelNeedsConsent(model, { scope: `infer:${model.id} ${webScopes}` })).toBe(false);
			}
			expect(notOrganicModelNeedsConsent(model, { scope: `infer:${model.id} web:search web:fetch` })).toBe(false);
		}
	});
	it("switches ordinary models with stable text access but keeps preview and unknown profiles separate", () => {
    const scope = "infer:text";
    for (const model of [NOTORGANIC_DEFAULT_MODEL, NOTORGANIC_SOL_MODEL]) expect(notOrganicModelNeedsConsent(model, { scope })).toBe(false);
    expect(notOrganicModelNeedsConsent(NOTORGANIC_FLINT_MODEL, { scope })).toBe(true);
    expect(notOrganicModelNeedsConsent({ provider: "notorganic", id: "new-private-model" }, { scope })).toBe(true);
  });
	it("defaults to Luna, retains Inkling 2 Small, and supports the same-origin endpoints", () => {
		expect(NOTORGANIC_DEFAULT_MODEL.id).toBe(NOTORGANIC_MODEL_ALIAS);
		expect(NOTORGANIC_DEFAULT_MODEL).toBe(NOTORGANIC_LUNA_MODEL);
		expect(NOTORGANIC_INKLING_2_SMALL_MODEL).toMatchObject({ id: "inkling-2-small", api: "openai-completions" });
		expect(NOTORGANIC_DEFAULT_MODEL.provider).toBe(NOTORGANIC_PROVIDER_ID);
		expect(notOrganicOpenAiBaseUrl("https://keating.test/")).toBe(
			"https://keating.test/api/notorganic/openai/v1",
		);
		expect(NOTORGANIC_IMAGE_MODEL_ALIAS).toBe("image");
		expect(notOrganicOpenAiImageEndpoint("https://keating.test/")).toBe(
			"https://keating.test/api/notorganic/openai/v1/images/generations",
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

	it("sends an idempotency key on billing POSTs that carry no cost ceiling", async () => {
		// The idempotency header used to be set only inside the maxCostMicrousd
		// branch, so /v1/billing/checkout -- the one request where a duplicate
		// becomes a second charge -- went out without a key.
		const seen: Headers[] = [];
		const adapter = new NotOrganicFetchAdapter({
			baseUrl: "https://provider.test",
			session: {
				accountId: "did:plc:alice",
				accessToken: "server-capability",
				createDpopProof: async () => "proof",
			},
			fetch: (async (_url, init) => {
				seen.push(new Headers(init?.headers));
				return Response.json({ ok: true });
			}) as typeof fetch,
		});

		await adapter.request("/v1/billing/checkout", {
			method: "POST",
			body: JSON.stringify({ product_id: "keating_pack_10" }),
		});
		expect(seen[0]?.get(NOTORGANIC_IDEMPOTENCY_HEADER)).toMatch(/^keating_/);
		expect(seen[0]?.get(NOTORGANIC_MAX_COST_HEADER)).toBeNull();

		await adapter.request("/v1/billing/checkout", {
			method: "POST",
			body: "{}",
			idempotencyKey: "caller-supplied",
		});
		expect(seen[1]?.get(NOTORGANIC_IDEMPOTENCY_HEADER)).toBe("caller-supplied");

		// Reads are naturally idempotent and must not acquire a key.
		await adapter.request("/v1/wallet", { method: "GET" });
		expect(seen[2]?.get(NOTORGANIC_IDEMPOTENCY_HEADER)).toBeNull();
	});
});

describe("Not Organic browser resource client", () => {
	it("allows a free account to buy standalone credit through same-origin product routes", async () => {
		const calls: string[] = [];
		const fetcher = (async (input, init) => {
			calls.push(`${init?.method ?? "GET"} ${String(input)}`);
			if (String(input).endsWith("/wallet")) return Response.json({ availableMicros: 0, subscriptions: [], checkout: { available: true, packIds: ["keating_pack_25"], planIds: [] } });
			if (String(input).endsWith("/checkout")) expect(JSON.parse(String(init?.body))).toEqual({ pack_id: "keating_pack_25", return_url: "https://keating.test/settings" });
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
			"GET /api/notorganic/provider/wallet",
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

			observed = {};
			const imageEvent = mockEvent(
				new Request("https://keating.test/api/notorganic/openai/v1/images/generations", {
					method: "POST",
					headers: {
						"content-type": "application/json",
						authorization: "Bearer browser-placeholder",
					},
					body: JSON.stringify({ model: "image", prompt: "A labeled anatomy diagram", n: 1 }),
				}),
			);
			imageEvent.context.notOrganicSessionAdapter = {
				getProductSession: async (_event: unknown, request: { feature: string }) => {
					feature = request.feature;
					return {
						accountId: "did:plc:alice",
						accessToken: "server-capability",
						createDpopProof: async () => "server-proof",
					};
				},
			};
			const imageResponse = await handler(imageEvent) as Response;
			expect(imageResponse.status).toBe(200);
			expect(observed.url).toBe("https://provider.test/v1/images/generations");
			expect(observed.headers?.get("authorization")).toBe("DPoP server-capability");
			expect(observed.headers?.get("authorization")).not.toContain("browser-placeholder");
			expect(observed.headers?.get(NOTORGANIC_MAX_COST_HEADER)).toBe("75000");
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

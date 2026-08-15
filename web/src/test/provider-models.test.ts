import { afterEach, describe, expect, it, mock } from "bun:test";

let providerKeys: Record<string, string | undefined> = {};

mock.module("@earendil-works/pi-web-ui", () => ({
	getAppStorage: () => ({
		customProviders: { getAll: async () => [] },
		providerKeys: { get: async (provider: string) => providerKeys[provider] },
	}),
}));

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
	providerKeys = {};
});

function provider(type: "gateway" | "openai-completions", baseUrl: string) {
	return {
		id: "gateway-1",
		name: "Gateway",
		type,
		gatewayKind: type === "gateway" ? "bifrost" as const : undefined,
		baseUrl,
		apiKey: "gateway-key",
		models: [],
	};
}

describe("gateway model discovery", () => {
	it("uses Bifrost's unified /v1 model route and preserves display names", async () => {
		const { discoverCustomProviderModels } = await import("../lib/provider-models");
		let requestUrl = "";
		let authorization = "";
		globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			requestUrl = input.toString();
			authorization = new Headers(init?.headers).get("authorization") ?? "";
			return new Response(JSON.stringify({
				data: [{ id: "anthropic/claude-sonnet", display_name: "Claude Sonnet" }],
			}), { status: 200 });
		}) as typeof fetch;

		const models = await discoverCustomProviderModels(provider("gateway", "https://bifrost.example"));

		expect(requestUrl).toBe("/api/chat-proxy/v1/models");
		expect(authorization).toBe("Bearer gateway-key");
		expect(models).toHaveLength(1);
		expect(models[0]?.id).toBe("anthropic/claude-sonnet");
		expect(models[0]?.name).toBe("Claude Sonnet");
		expect(models[0]?.baseUrl).toBe("https://bifrost.example/v1");
	});

	it("continues past an empty unversioned response", async () => {
		const { discoverCustomProviderModels } = await import("../lib/provider-models");
		const requests: string[] = [];
		globalThis.fetch = (async (input: string | URL | Request) => {
			const url = input.toString();
			requests.push(url);
			const body = url.endsWith("/v1/models")
				? { data: [{ id: "gateway/model" }] }
				: { data: [] };
			return new Response(JSON.stringify(body), { status: 200 });
		}) as typeof fetch;

		const models = await discoverCustomProviderModels(provider("openai-completions", "https://gateway.example"));

		expect(requests).toEqual(["/api/chat-proxy/models", "/api/chat-proxy/v1/models"]);
		expect(models.map((model) => model.id)).toEqual(["gateway/model"]);
	});
});

describe("chat model fallback selection", () => {
	it("uses the local browser model when no account or provider key is available", async () => {
		const originalNavigator = globalThis.navigator;
		Object.defineProperty(globalThis, "navigator", {
			configurable: true,
			value: {
				gpu: {
					requestAdapter: async () => ({
						features: { has: (name: string) => name === "shader-f16" },
					}),
				},
			},
		});
		try {
			const { resolveAvailableChatModel } = await import("../lib/provider-models");
			const selected = await resolveAvailableChatModel({
				id: "balanced",
				name: "Not Organic Balanced",
				api: "openai-completions" as any,
				provider: "notorganic",
				baseUrl: "/api/notorganic/openai/v1",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 256_000,
				maxTokens: 8192,
			});

			expect(selected.provider).toBe("browser");
			expect(selected.id).toBe("LiquidAI/LFM2.5-2.6B-ONNX");
		} finally {
			Object.defineProperty(globalThis, "navigator", {
				configurable: true,
				value: originalNavigator,
			});
		}
	});

	it("uses the Codex subscription catalog without treating it as an OpenAI API key", async () => {
		providerKeys = {
			"oauth:openai-codex": JSON.stringify({
				provider: "openai-codex",
				access: "codex-access-token",
				refresh: "codex-refresh-token",
				expires: Date.now() + 120_000,
				apiKey: "legacy-exchanged-api-key",
			}),
		};
		const { getProviderApiKey, resolveAvailableChatModel } = await import("../lib/provider-models");

		expect(await getProviderApiKey("openai")).toBeUndefined();
		expect(await getProviderApiKey("openai-codex")).toBe("codex-access-token");

		const selected = await resolveAvailableChatModel({
			id: "balanced",
			name: "Not Organic Balanced",
			api: "openai-completions" as any,
			provider: "notorganic",
			baseUrl: "/api/notorganic/openai/v1",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 256_000,
			maxTokens: 8192,
		});

		expect(selected.provider).toBe("openai-codex");
		expect(selected.api).toBe("openai-codex-responses");
	});

	it("uses an available OpenAI key when Not Organic has no product session", async () => {
		providerKeys = { openai: "openai-test-key" };
		const { resolveAvailableChatModel } = await import("../lib/provider-models");

		const selected = await resolveAvailableChatModel({
			id: "balanced",
			name: "Not Organic Balanced",
			api: "openai-completions" as any,
			provider: "notorganic",
			baseUrl: "/api/notorganic/openai/v1",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 256_000,
			maxTokens: 8192,
		});

		expect(selected.provider).toBe("openai");
		expect(selected.id).toBe("gpt-5.5");
	});

	it("uses an available Anthropic key when Not Organic and OpenAI are unavailable", async () => {
		providerKeys = { anthropic: "anthropic-test-key" };
		const { resolveAvailableChatModel } = await import("../lib/provider-models");

		const selected = await resolveAvailableChatModel({
			id: "balanced",
			name: "Not Organic Balanced",
			api: "openai-completions" as any,
			provider: "notorganic",
			baseUrl: "/api/notorganic/openai/v1",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 256_000,
			maxTokens: 8192,
		});

		expect(selected.provider).toBe("anthropic");
		expect(selected.id).toBe("claude-sonnet-4-6");
	});
});

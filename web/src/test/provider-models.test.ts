import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as appStorage from "../keating/app-storage";
import { IndexedDBStorageBackend } from "../lib/cloud-storage-backend";

let providerKeys: Record<string, string | undefined> = {};

let storageSpy: ReturnType<typeof spyOn> | undefined;
beforeEach(() => {
	const keys = new appStorage.ProviderKeysStore();
	keys.get = async (provider) => providerKeys[provider] ?? null;
	keys.set = async (provider, value) => { providerKeys[provider] = value; };
	keys.delete = async (provider) => { delete providerKeys[provider]; };
	const custom = new appStorage.CustomProvidersStore();
	custom.getAll = async () => [];
	storageSpy = spyOn(appStorage, "getAppStorage").mockReturnValue(new appStorage.AppStorage(
		new appStorage.SettingsStore(), keys, new appStorage.SessionsStore(), custom,
		new IndexedDBStorageBackend({ dbName: "provider-model-test", version: 1, stores: [] }),
	));
});

const originalFetch = globalThis.fetch;

afterEach(() => {
	storageSpy?.mockRestore();
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
	it("shares a single rotating Codex refresh between concurrent model consumers", async () => {
		providerKeys["oauth:openai-codex"] = JSON.stringify({
			provider: "openai-codex", access: "expired", refresh: "refresh-once",
			expires: 0, apiKey: "legacy-key",
		});
		let refreshCount = 0;
		globalThis.fetch = (async (_input, init) => {
			refreshCount++;
			expect(JSON.parse(String(init?.body)).refresh_token).toBe("refresh-once");
			await new Promise((resolve) => setTimeout(resolve, 0));
			return Response.json({ access_token: "fresh-codex", refresh_token: "rotated", expires_in: 3600 });
		}) as typeof fetch;
		const { getProviderApiKey } = await import("../lib/provider-models");
		expect(await Promise.all(Array.from({ length: 8 }, () => getProviderApiKey("openai-codex"))))
			.toEqual(Array(8).fill("fresh-codex"));
		expect(refreshCount).toBe(1);
		expect(JSON.parse(providerKeys["oauth:openai-codex"]!)).toMatchObject({ access: "fresh-codex", refresh: "rotated" });
		expect(await getProviderApiKey("openai-codex")).toBe("fresh-codex");
		expect(refreshCount).toBe(1);
	});

	it("retains Codex credentials after an invalid refresh response and permits retry", async () => {
		const saved = JSON.stringify({ provider: "openai-codex", access: "expired", refresh: "refresh-once", expires: 0 });
		providerKeys["oauth:openai-codex"] = saved;
		globalThis.fetch = (async () => Response.json({ expires_in: 3600 })) as unknown as typeof fetch;
		const { getProviderApiKey } = await import("../lib/provider-models");
		expect(await getProviderApiKey("openai-codex")).toBeUndefined();
		expect(providerKeys["oauth:openai-codex"]).toBe(saved);
		globalThis.fetch = (async () => Response.json({ access_token: "retried", refresh_token: "rotated", expires_in: 3600 })) as unknown as typeof fetch;
		expect(await getProviderApiKey("openai-codex")).toBe("retried");
	});

	it("keeps an explicitly selected model instead of silently replacing it", async () => {
		const { resolveAvailableChatModel } = await import("../lib/provider-models");
		const selected = {
			id: "gpt-5.5",
			name: "GPT-5.5",
			api: "openai-completions" as any,
			provider: "openai",
			baseUrl: "https://api.openai.com/v1",
			reasoning: true,
			input: ["text"] as Array<"text" | "image">,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128_000,
			maxTokens: 8192,
		};

		expect(await resolveAvailableChatModel(selected, { allowFallback: false })).toBe(selected);
	});

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
			expect(selected.id).toBe("RASMUS/MiniCPM5-2B-ONNX");
		} finally {
			Object.defineProperty(globalThis, "navigator", {
				configurable: true,
				value: originalNavigator,
			});
		}
	});

	it("does not select a browser model when the GPU lacks its required WebGPU feature", async () => {
		const originalNavigator = globalThis.navigator;
		Object.defineProperty(globalThis, "navigator", {
			configurable: true,
			value: {
				gpu: {
					requestAdapter: async () => ({
						features: { has: () => false },
					}),
				},
			},
		});
		try {
			const { resolveAvailableChatModel } = await import("../lib/provider-models");
			const current = {
				id: "balanced",
				name: "Not Organic Balanced",
				api: "openai-completions" as any,
				provider: "notorganic",
				baseUrl: "/api/notorganic/openai/v1",
				reasoning: true,
				input: ["text"] as Array<"text" | "image">,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 256_000,
				maxTokens: 8192,
			};

			expect(await resolveAvailableChatModel(current)).toBe(current);
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

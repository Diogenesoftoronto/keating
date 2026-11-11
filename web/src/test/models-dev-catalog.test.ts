import { describe, expect, it } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { createModelsDevCatalog, MODEL_CATALOG_TTL, parseModelsDevCatalog } from "../lib/models-dev-catalog";

const model = (provider: string, api: Api, baseUrl: string, id = "old"): Model<Api> => ({
	id, name: id, provider, api, baseUrl, reasoning: false, input: ["text"],
	contextWindow: 8192, maxTokens: 4096, cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
});
const baseline = [model("anthropic", "anthropic-messages", "https://api.anthropic.com"), model("openai", "openai-responses", "https://api.openai.com/v1")];
const entry = (id: string, extra: Record<string, unknown> = {}) => ({
	id, name: `New ${id}`, reasoning: true, tool_call: true,
	modalities: { input: ["text", "image", "pdf"], output: ["text"] },
	limit: { context: 1_000_000, output: 128_000 },
	cost: { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 },
	reasoning_options: [{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] }],
	...extra,
});
const payload = {
	anthropic: { npm: "@ai-sdk/anthropic", models: { latest: entry("claude-fable-5-2") } },
	openai: { npm: "@ai-sdk/openai", models: { latest: entry("gpt-6.1-sol") } },
};
const fakeFetch = (handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) => handler as typeof fetch;

describe("models.dev chat catalog", () => {
	it("includes newly published models and reasoning limits without a model allowlist", () => {
		const models = parseModelsDevCatalog(payload, baseline);
		expect(models.map(model => model.id)).toEqual(["claude-fable-5-2", "gpt-6.1-sol"]);
		expect(models[0]).toMatchObject({ provider: "anthropic", api: "anthropic-messages", compat: { forceAdaptiveThinking: true } });
		expect(models[1]).toMatchObject({ provider: "openai", api: "openai-responses", input: ["text", "image"], contextWindow: 1_000_000, maxTokens: 128_000,
			thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" },
			cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 } });
	});
	it("never accepts catalog endpoints, headers, or an unsupported provider", () => {
		const hostile = { api: "https://untrusted.example", headers: { Authorization: "untrusted" }, npm: "@ai-sdk/openai" };
		const parsed = parseModelsDevCatalog({ openai: { ...hostile, models: { future: entry("future", { provider: hostile, baseUrl: hostile.api, headers: hostile.headers }) } },
			unknown: { ...hostile, models: { future: entry("future") } } }, baseline);
		expect(parsed).toHaveLength(1);
		expect(parsed[0]?.baseUrl).toBe("https://api.openai.com/v1");
		expect(parsed[0]?.headers).toBeUndefined();
	});
	it("excludes non-chat endpoints but does not filter ordinary chat models by tool use", () => {
		const models = parseModelsDevCatalog({ openai: { models: {
			image: entry("image", { type: "image" }), embedding: entry("embedding", { type: "embedding" }),
			realtime: entry("realtime", { type: "realtime" }), noText: entry("noText", { modalities: { input: ["text"], output: ["image"] } }),
			deprecated: entry("deprecated", { status: "deprecated" }),
			audio: entry("audio", { modalities: { input: ["text"], output: ["text", "audio"] } }),
			chat: entry("chat", { tool_call: false }),
		} } }, baseline);
		expect(models.map(model => model.id)).toEqual(["chat"]);
	});
	it("keeps trusted compatibility metadata for existing models and maps tiered prices", () => {
		const known = { ...baseline[1]!, compat: { supportsStrictMode: true } };
		const parsed = parseModelsDevCatalog({ openai: { models: { old: entry("old", {
			cost: { input: 2, output: 10, tiers: [{ input: 4, output: 15, cache_read: 0.4, tier: { type: "context", size: 272000 } }] },
		}) } } }, [known]);
		expect(parsed[0]?.compat).toEqual(known.compat);
		expect(parsed[0]?.cost.tiers?.[0]).toMatchObject({ inputTokensAbove: 272000, input: 4, output: 15, cacheRead: 0.4 });
	});
	it("does not infer Codex subscription availability from the OpenAI API catalog", () => {
		expect(parseModelsDevCatalog(payload, [model("openai-codex", "openai-codex-responses", "https://chatgpt.com/backend-api")])).toEqual([]);
	});
	it("uses trusted SDK routes for mixed providers, leaving ambiguous new routes unlisted", () => {
		const mixed = [model("mixed", "anthropic-messages", "https://mixed.example/anthropic"), model("mixed", "openai-responses", "https://mixed.example/openai", "other")];
		const parsed = parseModelsDevCatalog({ mixed: { models: {
			new: entry("new", { provider: { npm: "@ai-sdk/anthropic", api: "https://untrusted.example" } }), ambiguous: entry("ambiguous"),
		} } }, mixed);
		expect(parsed).toHaveLength(1);
		expect(parsed[0]).toMatchObject({ id: "new", api: "anthropic-messages", baseUrl: "https://mixed.example/anthropic" });
	});
	it("rejects alternate unsupported Vertex SDKs rather than sending them to Gemini", () => {
		const vertex = model("google-vertex", "google-vertex", "https://{location}-aiplatform.googleapis.com");
		const parsed = parseModelsDevCatalog({ "google-vertex": { npm: "@ai-sdk/google-vertex", models: {
			claude: entry("claude", { provider: { npm: "@ai-sdk/google-vertex/anthropic" } }),
			mistral: entry("mistral", { provider: { npm: "@ai-sdk/mistral" } }),
			gemini: entry("gemini"),
		} } }, [vertex]);
		expect(parsed.map(model => model.id)).toEqual(["gemini"]);
	});
	it("does not add prefixed Cloudflare IDs to native provider endpoints", () => {
		const gateway = model("cloudflare-ai-gateway", "openai-responses", "https://gateway.example/openai", "old");
		const parsed = parseModelsDevCatalog({ "cloudflare-ai-gateway": { npm: "ai-gateway-provider", models: {
			new: entry("openai/gpt-future", { provider: { npm: "@ai-sdk/openai" } }), old: entry("old"),
		} } }, [gateway]);
		expect(parsed.map(model => model.id)).toEqual(["old"]);
	});
	it("preserves budget-based Claude compatibility instead of inferring adaptive from effort", () => {
		const known = { ...baseline[0]!, id: "claude-opus-4-5", reasoning: true, compat: { supportsStrictTools: true } };
		const parsed = parseModelsDevCatalog({ anthropic: { models: { old: entry(known.id, {
			reasoning_options: [{ type: "effort", values: ["low", "medium", "high"] }, { type: "budget_tokens", min: 1024 }],
		}) } } }, [known]);
		expect(parsed[0]?.compat).toEqual(known.compat);
		expect(parsed[0]?.thinkingLevelMap).toBeUndefined();
	});
	it("retains reasoning-off for new toggle-capable models", () => {
		const parsed = parseModelsDevCatalog({ openai: { models: { toggle: entry("toggle", {
			reasoning_options: [{ type: "toggle" }, { type: "effort", values: ["low", "high", "max"] }],
		}) } } }, baseline);
		expect(parsed[0]?.thinkingLevelMap?.off).toBe("off");
	});
	it("inherits invariant route headers and serialization flags, not model-specific fallbacks", () => {
		const common = { thinkingFormat: "deepseek" as const, requiresReasoningContentOnAssistantMessages: true };
		const known = ["one", "two"].map(id => ({ ...model("xiaomi", "openai-completions", "https://api.xiaomimimo.com/v1", id),
			headers: { "Provider-Identity": "trusted" }, compat: { ...common, supportsStrictMode: id === "one" } }));
		const parsed = parseModelsDevCatalog({ xiaomi: { npm: "@ai-sdk/openai-compatible", models: { new: entry("mimo-new") } } }, known);
		expect(parsed[0]?.compat).toEqual(common);
		expect(parsed[0]?.headers).toEqual({ "Provider-Identity": "trusted" });
	});
	it("ignores malformed records without losing valid entries", () => {
		expect(parseModelsDevCatalog(null, baseline)).toEqual([]);
		const parsed = parseModelsDevCatalog({ openai: { models: { bad: null, limits: entry("limits", { limit: { context: -1, output: "bad" } }), good: entry("good") } } }, baseline);
		expect(parsed.map(model => model.id)).toEqual(["good"]);
	});
});

describe("catalog refresh and persistence", () => {
	it("coalesces refresh, omits credentials, honors expiry and allows an explicit refresh", async () => {
		let calls = 0, now = 1000;
		const catalog = createModelsDevCatalog({ baseline: () => baseline, now: () => now, fetch: fakeFetch(async (url, init) => {
			calls++; expect(String(url)).toBe("https://models.dev/api.json"); expect(init?.credentials).toBe("omit");
			expect(new Headers(init?.headers).has("authorization")).toBe(false);
			await Promise.resolve(); return Response.json(payload);
		}) });
		await Promise.all([catalog.refresh(), catalog.refresh(), catalog.refresh()]);
		expect(calls).toBe(1); expect(catalog.models()).toHaveLength(4);
		await catalog.refresh(); expect(calls).toBe(1);
		now += MODEL_CATALOG_TTL; await catalog.refresh(); expect(calls).toBe(2);
		await catalog.refresh(true); expect(calls).toBe(3);
	});
	it("restores cached metadata safely and retains it through failed or malformed refresh", async () => {
		const values = new Map<string, string>();
		const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
		let now = 1000;
		const first = createModelsDevCatalog({ baseline: () => baseline, storage: () => storage, now: () => now, fetch: fakeFetch(async () => Response.json(payload)) });
		await first.refresh();
		const restored = createModelsDevCatalog({ baseline: () => baseline, storage: () => storage, now: () => now,
			fetch: fakeFetch(async () => Response.json({ invalid: true })) });
		expect(restored.models().map(model => model.id)).toContain("gpt-6.1-sol");
		now += MODEL_CATALOG_TTL; await restored.refresh();
		expect(restored.models().map(model => model.id)).toContain("gpt-6.1-sol");
		expect(restored.status().error).toContain("last available catalog");
		expect(restored.status().updatedAt).toBe(1000);
	});
	it("falls back to the bundle on timeout and can recover on explicit retry", async () => {
		let shouldFail = true;
		const catalog = createModelsDevCatalog({ baseline: () => baseline, timeoutMs: 5, fetch: fakeFetch(async (_url, init) => {
			if (!shouldFail) return Response.json(payload);
			return await new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
		}) });
		await catalog.refresh(); expect(catalog.models()).toEqual(baseline); expect(catalog.status().error).not.toBeNull();
		shouldFail = false; await catalog.refresh(true);
		expect(catalog.models()).toHaveLength(4); expect(catalog.status().error).toBeNull();
	});
	it("works even when storage is blocked or full", async () => {
		const catalog = createModelsDevCatalog({ baseline: () => baseline, storage: () => { throw new Error("blocked"); }, fetch: fakeFetch(async () => Response.json(payload)) });
		await catalog.refresh(); expect(catalog.models()).toHaveLength(4); expect(catalog.status().error).toBeNull();
	});
});

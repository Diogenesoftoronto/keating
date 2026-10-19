import { describe, expect, it } from "bun:test";

import {
	applyProviderWebSearch,
	resolveProviderWebSearchRoute,
	shouldExposeClientWebSearch,
} from "../keating/provider-web-search";
import { setSearchProvenanceSignalSink } from "../keating/search";
import {
	resolveAuxiliaryWebSearchModel,
	selectAuxiliaryWebSearchModel,
	withProviderWebSearch,
} from "../hooks/keating-stream";

describe("provider-native web search", () => {
	it("prefers hosted Not Organic search over native provider search and respects disabled/unconfigured fallback", () => {
		const keys = ["VITE_NOTORGANIC_ENABLED", "VITE_NOTORGANIC_PUBLIC_ISSUER", "VITE_NOTORGANIC_AUTHORIZATION_URL", "VITE_NOTORGANIC_CLIENT_ID", "VITE_NOTORGANIC_REDIRECT_URI"];
		const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
		const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
		const values = new Map<string, string>();
		Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null } });
		const model = { provider: "openai", api: "openai-responses", id: "gpt-5.6-sol" } as any;
		try {
			Object.assign(process.env, { VITE_NOTORGANIC_ENABLED: "true", VITE_NOTORGANIC_PUBLIC_ISSUER: "https://gateway.example.test", VITE_NOTORGANIC_AUTHORIZATION_URL: "https://accounts.example.test/authorize", VITE_NOTORGANIC_CLIENT_ID: "https://keating.example.test", VITE_NOTORGANIC_REDIRECT_URI: "https://keating.example.test/notorganic/callback" });
			expect(resolveProviderWebSearchRoute(model, true).kind).toBe("client-adapter");
			expect(resolveProviderWebSearchRoute(model, false).kind).toBe("client-adapter");
			expect(shouldExposeClientWebSearch(model)).toBe(true);
			expect(applyProviderWebSearch({}, model, true)).toBeUndefined();
			values.set("keating_ui_settings", JSON.stringify({ webSearch: "off" }));
			expect(resolveProviderWebSearchRoute(model, true).kind).toBe("unavailable");
			expect(shouldExposeClientWebSearch(model)).toBe(false);
			expect(applyProviderWebSearch({}, model, true)).toBeUndefined();
			values.clear();
			process.env.VITE_NOTORGANIC_ENABLED = "false";
			expect(resolveProviderWebSearchRoute(model, true).kind).toBe("native");
			expect(applyProviderWebSearch({}, model, true)).toBeDefined();
			process.env.VITE_NOTORGANIC_ENABLED = "true";
			delete process.env.VITE_NOTORGANIC_PUBLIC_ISSUER;
			expect(resolveProviderWebSearchRoute(model, true).kind).toBe("native");
		} finally {
			for (const key of keys) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]; }
			if (storageDescriptor) Object.defineProperty(globalThis, "localStorage", storageDescriptor);
			else delete (globalThis as any).localStorage;
		}
	});
	it("keeps the request transformer pure outside the production stream", () => {
		const signals: unknown[] = [];
		const cleanup = setSearchProvenanceSignalSink((signal) => signals.push(signal));
		applyProviderWebSearch(
			{},
			{ provider: "openai", api: "openai-responses", id: "gpt-5.6-sol" } as any,
			true,
		);
		expect(signals).toEqual([]);
		cleanup();
	});

	it.each([
		["openai", "openai-responses", "gpt-5.6-sol"],
		["google", "google-generative-ai", "gemini-3.5-flash"],
		["anthropic", "anthropic-messages", "claude-sonnet-5"],
	])("signals untrusted provenance when the %s production stream activates hosted search", async (provider, api, id) => {
		const signals: any[] = [];
		const cleanup = setSearchProvenanceSignalSink((signal) => signals.push(signal));
		const model = { provider, api, id } as any;
		const options = withProviderWebSearch({ apiKey: "test-key" }, model, true);

		const payload = await options?.onPayload?.({}, model);
		expect(payload).toBeDefined();
		expect(signals).toHaveLength(1);
		expect(signals[0]).toMatchObject({
			untrusted: true,
			provider,
			modelId: id,
			sourceIds: [],
		});

		await options?.onPayload?.({}, model);
		expect(signals).toHaveLength(1);
		cleanup();
	});

	it("does not signal a production request when hosted search was not injected", async () => {
		const signals: unknown[] = [];
		const cleanup = setSearchProvenanceSignalSink((signal) => signals.push(signal));
		const model = { provider: "openai", api: "openai-responses", id: "gpt-5.6-sol" } as any;
		const options = withProviderWebSearch({}, model, false);

		await options?.onPayload?.({}, model);
		expect(signals).toEqual([]);
		cleanup();
	});
	it("uses Google Search grounding without dropping custom tools", () => {
		const payload = applyProviderWebSearch(
			{ config: { tools: [{ functionDeclarations: [{ name: "quiz" }] }] } },
			{ provider: "google", api: "google-generative-ai", id: "gemini-3.5-flash" } as any,
			true,
		) as any;
		expect(payload.config.tools).toHaveLength(2);
		expect(payload.config.tools[1]).toEqual({ googleSearch: {} });
	});

	it("uses the GA Responses web_search tool for current OpenAI models", () => {
		const payload = applyProviderWebSearch(
			{ tools: [{ type: "function", name: "quiz" }] },
			{ provider: "openai", api: "openai-responses", id: "gpt-5.6-sol" } as any,
			true,
		) as any;
		expect(payload.tools.at(-1)).toEqual({ type: "web_search" });
	});

	it("uses Anthropic's server-side search tool on Claude 5", () => {
		const payload = applyProviderWebSearch(
			{},
			{ provider: "anthropic", api: "anthropic-messages", id: "claude-sonnet-5" } as any,
			true,
		) as any;
		expect(payload.tools).toEqual([{ type: "web_search_20250305", name: "web_search" }]);
	});

	it("does not inject hosted tools without the provider's key", () => {
		expect(applyProviderWebSearch(
			{},
			{ provider: "openai", api: "openai-responses", id: "gpt-5.6-sol" } as any,
			false,
		)).toBeUndefined();
	});

	it("routes MiniMax through an explicit client adapter without payload injection", () => {
		const model = {
			provider: "minimax",
			api: "openai-completions",
			id: "minimax-m2.7-highspeed",
		} as any;
		expect(resolveProviderWebSearchRoute(model, true)).toMatchObject({
			kind: "client-adapter",
			tool: "client-web-search",
			providerNative: false,
		});
		expect(applyProviderWebSearch({}, model, true)).toBeUndefined();
		expect(shouldExposeClientWebSearch(model)).toBe(true);
	});

	it("routes unknown providers through the same explicit adapter", () => {
		const route = resolveProviderWebSearchRoute(
			{ provider: "private-provider", api: "openai-completions", id: "private-1" } as any,
			true,
		);
		expect(route.kind).toBe("client-adapter");
		expect(route.providerNative).toBe(false);
	});

	it("falls back when a provider family supports search but the selected model does not", () => {
		const model = { provider: "openai", api: "openai-responses", id: "gpt-4" } as any;
		expect(resolveProviderWebSearchRoute(model, true)).toMatchObject({
			kind: "client-adapter",
			tool: "client-web-search",
			citationKind: "tool-results",
		});
		expect(shouldExposeClientWebSearch(model)).toBe(true);
		expect(shouldExposeClientWebSearch(
			{ provider: "openai", api: "openai-responses", id: "gpt-5.6-sol" } as any,
		)).toBe(false);
	});

	it("uses the client adapter when Gemini grounding cannot coexist with app tools", () => {
		const model = { provider: "google", api: "google-generative-ai", id: "gemini-2.5-flash" } as any;
		expect(resolveProviderWebSearchRoute(model, true).kind).toBe("native");
		expect(shouldExposeClientWebSearch(model)).toBe(true);
		expect(applyProviderWebSearch(
			{ config: { tools: [{ functionDeclarations: [{ name: "quiz" }] }] } },
			model,
			true,
		)).toBeUndefined();
	});

	it("prefers a keyed OpenAI search model independently of the active model", async () => {
		const models = [
			{ provider: "google", api: "google-generative-ai", id: "gemini-2.5-flash" },
			{ provider: "openai", api: "openai-responses", id: "gpt-5-mini" },
		] as any[];
		expect(selectAuxiliaryWebSearchModel(models, new Set(["openai", "google"]))?.id).toBe("gpt-5-mini");

		const resolved = await resolveAuxiliaryWebSearchModel({
			models,
			getApiKey: async (provider) => provider === "google" ? "google-test-key" : undefined,
		});
		expect(resolved?.model).toMatchObject({ provider: "google", id: "gemini-2.5-flash" });
		expect(resolved?.apiKey).toBe("google-test-key");
	});
});

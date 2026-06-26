import { afterEach, describe, expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { applyProviderWebSearch } from "../src/hooks/keating-stream";

// ui-settings reads localStorage; provide a minimal mock that defaults to "auto".
const store = new Map<string, string>();
(globalThis as any).localStorage = {
	getItem: (key: string) => store.get(key) ?? null,
	setItem: (key: string, value: string) => store.set(key, value),
	removeItem: (key: string) => store.delete(key),
	clear: () => store.clear(),
};
(globalThis as any).window ??= {
	addEventListener: () => {},
	removeEventListener: () => {},
	dispatchEvent: () => true,
};

afterEach(() => store.clear());

function model(provider: string, id: string, api: Api): Model<Api> {
	return {
		id,
		name: id,
		api,
		provider,
		baseUrl: "https://example.com",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 4096,
	};
}

describe("provider-native web search injection", () => {
	test("adds GA web_search for GPT-5 Responses models", () => {
		const next = applyProviderWebSearch({ tools: [] }, model("openai", "gpt-5.5", "openai-responses" as Api), true) as any;
		expect(next.tools).toEqual([{ type: "web_search" }]);
	});

	test("uses web_search_preview for the 4o/4.1 generation", () => {
		const next = applyProviderWebSearch({}, model("openai", "gpt-4.1", "openai-responses" as Api), true) as any;
		expect(next.tools).toEqual([{ type: "web_search_preview" }]);
	});

	test("skips OpenAI codex slugs", () => {
		expect(applyProviderWebSearch({}, model("openai", "gpt-5.2-codex", "openai-responses" as Api), true)).toBeUndefined();
	});

	test("adds Anthropic server-side web_search for Claude 4 models", () => {
		const next = applyProviderWebSearch({ tools: [{ name: "plan" }] }, model("anthropic", "claude-sonnet-4-6", "anthropic-messages" as Api), true) as any;
		expect(next.tools).toHaveLength(2);
		expect(next.tools[1]).toEqual({ type: "web_search_20250305", name: "web_search" });
	});

	test("does not duplicate an existing web search tool", () => {
		const payload = { tools: [{ type: "web_search" }] };
		expect(applyProviderWebSearch(payload, model("openai", "gpt-5.5", "openai-responses" as Api), true)).toBeUndefined();
	});

	test("requires an API key", () => {
		expect(applyProviderWebSearch({}, model("openai", "gpt-5.5", "openai-responses" as Api), false)).toBeUndefined();
		expect(applyProviderWebSearch({}, model("anthropic", "claude-sonnet-4-6", "anthropic-messages" as Api), false)).toBeUndefined();
	});

	test("respects the off setting", () => {
		store.set("keating_ui_settings", JSON.stringify({ webSearch: "off" }));
		expect(applyProviderWebSearch({}, model("openai", "gpt-5.5", "openai-responses" as Api), true)).toBeUndefined();
		expect(applyProviderWebSearch({}, model("anthropic", "claude-sonnet-4-6", "anthropic-messages" as Api), true)).toBeUndefined();
	});
});

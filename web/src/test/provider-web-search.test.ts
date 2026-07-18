import { describe, expect, it } from "bun:test";

import { applyProviderWebSearch } from "../keating/provider-web-search";

describe("provider-native web search", () => {
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
});

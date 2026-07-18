import { describe, expect, it } from "bun:test";

import {
	applyProviderWebSearch,
	resolveProviderWebSearchRoute,
} from "../keating/provider-web-search";
import { setSearchProvenanceSignalSink } from "../keating/search";
import { withProviderWebSearch } from "../hooks/keating-stream";

describe("provider-native web search", () => {
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
	});

	it("routes unknown providers through the same explicit adapter", () => {
		const route = resolveProviderWebSearchRoute(
			{ provider: "private-provider", api: "openai-completions", id: "private-1" } as any,
			true,
		);
		expect(route.kind).toBe("client-adapter");
		expect(route.providerNative).toBe(false);
	});
});

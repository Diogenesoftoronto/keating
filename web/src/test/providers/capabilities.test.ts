import { describe, expect, test } from "bun:test";
import {
	negotiateProviderCapabilities,
	resolveProviderCapabilities,
	type CapabilityRule,
} from "../../keating/providers";

describe("provider capability registry", () => {
	test("selects the specific OpenAI realtime rule before generic OpenAI", () => {
		const result = resolveProviderCapabilities({
			provider: "openai",
			id: "gpt-realtime-2.1",
			api: "openai-responses",
		});

		expect(result.ruleId).toBe("openai-realtime");
		expect(result.capabilities.realtimeAudio).toBe("native");
		expect(result.capabilities.realtimeTransports).toEqual(["webrtc", "websocket"]);
	});

	test("negotiates preferred native transport and adapter search for realtime", () => {
		const result = negotiateProviderCapabilities(
			{ provider: "openai", id: "gpt-realtime-2.1" },
			{
				realtimeAudio: true,
				webSearch: true,
				toolCalls: true,
				citations: true,
				preferredTransports: ["livekit", "webrtc", "websocket"],
			},
		);

		expect(result.transport).toBe("webrtc");
		expect(result.realtimeAudio).toBe("native");
		expect(result.webSearch).toBe("adapter");
		expect(result.searchTool).toBe("client-web-search");
		expect(result.toolCalls).toBe("native");
		expect(result.citations).toBe("adapter");
		expect(result.usesFallback).toBe(true);
		expect(result.missing).toEqual([]);
	});

	test("maps native hosted search and citation formats by provider", () => {
		const cases = [
			["openai", "gpt-5.4", "openai-responses", "openai-web-search", "provider-annotations"],
			["google", "gemini-3.1-pro-preview", "google-generative-ai", "google-search-grounding", "grounding-metadata"],
			["anthropic", "claude-sonnet-4-6", "anthropic-messages", "anthropic-web-search", "provider-annotations"],
		] as const;

		for (const [provider, id, api, searchTool, citationKind] of cases) {
			const result = negotiateProviderCapabilities(
				{ provider, id, api },
				{ webSearch: true, toolCalls: true, citations: true },
			);
			expect(result.webSearch).toBe("native");
			expect(result.searchTool).toBe(searchTool);
			expect(result.toolCalls).toBe("native");
			expect(result.citations).toBe("native");
			expect(result.capabilities.citationKind).toBe(citationKind);
		}
	});

	test("gives MiniMax native tool calls with client search fallbacks", () => {
		for (const provider of ["minimax", "minimax-cn"]) {
			const result = negotiateProviderCapabilities(
				{ provider, id: "minimax-m2.7-highspeed", api: "openai-completions" },
				{ webSearch: true, toolCalls: true, citations: true },
			);
			expect(result.ruleId).toBe("minimax-chat");
			expect(result.webSearch).toBe("adapter");
			expect(result.toolCalls).toBe("native");
			expect(result.citations).toBe("adapter");
		}
	});

	test("generic providers degrade safely and adapters can be disabled", () => {
		const result = negotiateProviderCapabilities(
			{ provider: "my-gateway", id: "unknown-model", api: "openai-completions" },
			{ realtimeAudio: true, webSearch: true, toolCalls: true, citations: true, allowAdapters: false },
		);

		expect(result.ruleId).toBe("generic-provider");
		expect(result.realtimeAudio).toBe("unavailable");
		expect(result.webSearch).toBe("unavailable");
		expect(result.toolCalls).toBe("unavailable");
		expect(result.citations).toBe("unavailable");
		expect(result.missing).toEqual(["realtimeAudio", "webSearch", "toolCalls", "citations"]);
	});

	test("reports transport incompatibility independently from realtime support", () => {
		const result = negotiateProviderCapabilities(
			{ provider: "openai", id: "gpt-realtime-2.1" },
			{ realtimeAudio: true, preferredTransports: ["livekit"] },
		);

		expect(result.realtimeAudio).toBe("native");
		expect(result.transport).toBeUndefined();
		expect(result.missing).toEqual(["transport"]);
	});

	test("accepts injected rules for custom deployments without call-site conditionals", () => {
		const rules: CapabilityRule[] = [{
			id: "private-livekit",
			provider: "private-cloud",
			capabilities: {
				realtimeAudio: "native",
				realtimeTransports: ["livekit"],
				webSearch: "none",
				toolCalls: "native",
				citations: "none",
			},
		}];
		const result = negotiateProviderCapabilities(
			{ provider: "private-cloud", id: "voice" },
			{ realtimeAudio: true, preferredTransports: ["livekit"] },
			rules,
		);

		expect(result.ruleId).toBe("private-livekit");
		expect(result.transport).toBe("livekit");
	});
});

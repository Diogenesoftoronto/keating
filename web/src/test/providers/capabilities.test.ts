import { describe, expect, test } from "bun:test";
import {
	negotiateProviderCapabilities,
	resolveProviderCapabilities,
	resolveRealtimeTier,
	type CapabilityRule,
	type RealtimeTier,
} from "../../keating/providers";

describe("provider capability registry", () => {
	test("selects the specific OpenAI realtime rule before generic OpenAI", () => {
		const result = resolveProviderCapabilities({
			provider: "openai",
			id: "gpt-realtime-2.1",
			api: "openai-responses",
		});

		expect(result.ruleId).toBe("openai-realtime-vision");
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
				realtimeVideo: "none",
				realtimeImage: "none",
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

describe("realtime capability cascade", () => {
	// This table is the spec for the tier system. Each row states the highest
	// tier Keating may drive a model at, and how vision reaches it.
	const CASCADE: ReadonlyArray<readonly [string, string, RealtimeTier, "native" | "sampled" | "none"]> = [
		// tier 3 — provider has a dedicated realtime video lane
		["google", "gemini-3.1-flash-live-preview", 3, "native"],
		["google", "gemini-2.5-flash-live-preview", 3, "native"],
		["google", "gemini-2.0-flash-live-001", 3, "native"],
		["google", "gemini-live-2.5-flash-native-audio", 3, "native"],
		// tier 2 — audio duplex, vision sampled as still images
		["openai", "gpt-realtime-2.1", 2, "sampled"],
		["openai", "gpt-realtime-2.1-mini", 2, "sampled"],
		["openai", "gpt-realtime-2", 2, "sampled"],
		["openai", "gpt-realtime", 2, "sampled"],
		["openai", "gpt-realtime-mini", 2, "sampled"],
		// tier 1 — audio duplex only, cannot see anything
		["openai", "gpt-4o-realtime-preview-2024-12-17", 1, "none"],
		["openai", "gpt-4o-mini-realtime-preview-2024-12-17", 1, "none"],
		// tier 0 — no duplex session at all
		["openai", "gpt-5.4", 0, "none"],
		["anthropic", "claude-sonnet-4-6", 0, "none"],
		["google", "gemini-3.1-pro-preview", 0, "none"],
		["my-gateway", "unknown-model", 0, "none"],
	];

	test.each(CASCADE)("%s/%s resolves to tier %i (%s video)", (provider, id, tier, videoRoute) => {
		const descriptor = resolveRealtimeTier({ provider, id });
		expect(descriptor.tier).toBe(tier);
		expect(descriptor.videoRoute).toBe(videoRoute);
		expect(descriptor.video).toBe(videoRoute !== "none");
	});

	test("every tier below the top explains why it is capped", () => {
		for (const [provider, id, tier] of CASCADE) {
			const descriptor = resolveRealtimeTier({ provider, id });
			if (tier === 3) expect(descriptor.capReason).toBeUndefined();
			else expect(descriptor.capReason).toBeTruthy();
		}
	});

	test("sampled vision negotiates through the adapter route, native does not", () => {
		const sampled = negotiateProviderCapabilities(
			{ provider: "openai", id: "gpt-realtime-2.1" },
			{ realtimeAudio: true, realtimeVideo: true, toolCalls: true },
		);
		expect(sampled.realtimeVideo).toBe("adapter");
		expect(sampled.realtimeImage).toBe("not-requested");

		const native = negotiateProviderCapabilities(
			{ provider: "google", id: "gemini-3.1-flash-live-preview" },
			{ realtimeAudio: true, realtimeVideo: true, toolCalls: true },
		);
		expect(native.realtimeVideo).toBe("native");
	});

	test("disabling adapters strips sampled vision but keeps native vision", () => {
		const sampled = negotiateProviderCapabilities(
			{ provider: "openai", id: "gpt-realtime-2.1" },
			{ realtimeAudio: true, realtimeVideo: true, allowAdapters: false },
		);
		expect(sampled.realtimeVideo).toBe("unavailable");
		expect(sampled.missing).toContain("realtimeVideo");

		const native = negotiateProviderCapabilities(
			{ provider: "google", id: "gemini-3.1-flash-live-preview" },
			{ realtimeAudio: true, realtimeVideo: true, allowAdapters: false },
		);
		expect(native.realtimeVideo).toBe("native");
		expect(native.missing).toEqual([]);
	});

	test("legacy realtime previews keep duplex audio but lose image input", () => {
		const legacy = resolveProviderCapabilities({
			provider: "openai",
			id: "gpt-4o-realtime-preview-2024-12-17",
		});
		expect(legacy.ruleId).toBe("openai-realtime-legacy");
		expect(legacy.capabilities.realtimeAudio).toBe("native");
		expect(legacy.capabilities.realtimeImage).toBe("none");
		expect(legacy.capabilities.realtimeVideo).toBe("none");
	});

	test("a duplex model that cannot call tools is not a teaching session", () => {
		const rules: CapabilityRule[] = [{
			id: "toolless-voice",
			provider: "voice-only",
			capabilities: {
				realtimeAudio: "native",
				realtimeTransports: ["websocket"],
				realtimeVideo: "native",
				realtimeImage: "native",
				webSearch: "none",
				toolCalls: "none",
				citations: "none",
			},
		}];
		const descriptor = resolveRealtimeTier({ provider: "voice-only", id: "chatty" }, rules);
		expect(descriptor.tier).toBe(0);
		expect(descriptor.capReason).toContain("tools");
	});
});

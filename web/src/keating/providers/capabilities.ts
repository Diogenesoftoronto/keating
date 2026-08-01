/** Provider/model features that affect how Keating constructs a session. */
export type CapabilitySupport = "native" | "adapter" | "none";

export type RealtimeTransport = "webrtc" | "websocket" | "livekit";

export type SearchToolKind =
	| "openai-web-search"
	| "google-search-grounding"
	| "anthropic-web-search"
	| "client-web-search";

export type CitationKind = "provider-annotations" | "grounding-metadata" | "tool-results";

export interface ProviderModelDescriptor {
	provider: string;
	id: string;
	api?: string;
}

export interface ProviderCapabilities {
	realtimeAudio: CapabilitySupport;
	realtimeTransports: readonly RealtimeTransport[];
	/**
	 * Continuous vision during a live session.
	 * "native"  — the provider has a dedicated realtime video lane (Gemini Live).
	 * "adapter" — no video lane, but still images can be injected as conversation
	 *             items, so Keating's frame sampler can stand in (GPT Realtime).
	 * "none"    — the session cannot see anything.
	 */
	realtimeVideo: CapabilitySupport;
	/** Still-image input during a live session. */
	realtimeImage: CapabilitySupport;
	webSearch: CapabilitySupport;
	searchTool?: SearchToolKind;
	toolCalls: CapabilitySupport;
	citations: CapabilitySupport;
	citationKind?: CitationKind;
}

export interface CapabilityRule {
	id: string;
	provider: string | RegExp;
	model?: RegExp;
	api?: string | RegExp;
	capabilities: ProviderCapabilities;
}

export interface CapabilityRequest {
	realtimeAudio?: boolean;
	realtimeVideo?: boolean;
	realtimeImage?: boolean;
	webSearch?: boolean;
	toolCalls?: boolean;
	citations?: boolean;
	preferredTransports?: readonly RealtimeTransport[];
	/** Permit Keating/client adapters when a provider has no native feature. */
	allowAdapters?: boolean;
}

export type NegotiatedRoute = "native" | "adapter" | "unavailable" | "not-requested";

export interface CapabilityNegotiation {
	ruleId: string;
	model: ProviderModelDescriptor;
	capabilities: ProviderCapabilities;
	realtimeAudio: NegotiatedRoute;
	realtimeVideo: NegotiatedRoute;
	realtimeImage: NegotiatedRoute;
	transport?: RealtimeTransport;
	webSearch: NegotiatedRoute;
	searchTool?: SearchToolKind;
	toolCalls: NegotiatedRoute;
	citations: NegotiatedRoute;
	missing: Array<
		| "realtimeAudio"
		| "realtimeVideo"
		| "realtimeImage"
		| "webSearch"
		| "toolCalls"
		| "citations"
		| "transport"
	>;
	usesFallback: boolean;
}

const GENERIC_CAPABILITIES: ProviderCapabilities = {
	realtimeAudio: "none",
	realtimeTransports: [],
	realtimeVideo: "none",
	realtimeImage: "none",
	webSearch: "adapter",
	searchTool: "client-web-search",
	toolCalls: "adapter",
	citations: "adapter",
	citationKind: "tool-results",
};

const OPENAI_TEXT: ProviderCapabilities = {
	realtimeAudio: "none",
	realtimeTransports: [],
	realtimeVideo: "none",
	realtimeImage: "none",
	webSearch: "native",
	searchTool: "openai-web-search",
	toolCalls: "native",
	citations: "native",
	citationKind: "provider-annotations",
};

/**
 * Ordered from specific to general. Rules describe routing capability, not
 * entitlement: callers must still check credentials and account availability.
 */
export const PROVIDER_CAPABILITY_RULES: readonly CapabilityRule[] = [
	{
		// gpt-realtime / gpt-realtime-2* accept still images as conversation
		// items, so Keating's frame sampler can supply continuous vision.
		id: "openai-realtime-vision",
		provider: "openai",
		model: /^gpt-realtime/i,
		capabilities: {
			...GENERIC_CAPABILITIES,
			realtimeAudio: "native",
			realtimeTransports: ["webrtc", "websocket"],
			realtimeVideo: "adapter",
			realtimeImage: "native",
			toolCalls: "native",
		},
	},
	{
		// gpt-4o-*realtime-preview: duplex audio and tools, but no image input.
		id: "openai-realtime-legacy",
		provider: "openai",
		model: /(?:^|[-_.])realtime(?:$|[-_.])/i,
		capabilities: {
			...GENERIC_CAPABILITIES,
			realtimeAudio: "native",
			realtimeTransports: ["webrtc", "websocket"],
			toolCalls: "native",
		},
	},
	{
		id: "openai-responses",
		provider: "openai",
		api: "openai-responses",
		capabilities: OPENAI_TEXT,
	},
	{
		id: "openai-generic",
		provider: "openai",
		capabilities: {
			...GENERIC_CAPABILITIES,
			toolCalls: "native",
		},
	},
	{
		id: "google-live",
		provider: "google",
		model: /(?:^|[-_.])live(?:$|[-_.])|native-audio/i,
		capabilities: {
			realtimeAudio: "native",
			realtimeTransports: ["websocket"],
			// Gemini Live has a dedicated realtime video lane (1 fps JPEG frames).
			realtimeVideo: "native",
			realtimeImage: "native",
			webSearch: "native",
			searchTool: "google-search-grounding",
			toolCalls: "native",
			citations: "native",
			citationKind: "grounding-metadata",
		},
	},
	{
		id: "google-gemini",
		provider: "google",
		model: /^gemini-/i,
		capabilities: {
			...GENERIC_CAPABILITIES,
			webSearch: "native",
			searchTool: "google-search-grounding",
			toolCalls: "native",
			citations: "native",
			citationKind: "grounding-metadata",
		},
	},
	{
		id: "anthropic-claude",
		provider: "anthropic",
		model: /^claude-/i,
		capabilities: {
			...GENERIC_CAPABILITIES,
			webSearch: "native",
			searchTool: "anthropic-web-search",
			toolCalls: "native",
			citations: "native",
			citationKind: "provider-annotations",
		},
	},
	{
		id: "minimax-chat",
		provider: /^(?:minimax|minimax-cn)$/i,
		model: /^(?:minimax-|MiniMax-)/,
		capabilities: {
			...GENERIC_CAPABILITIES,
			toolCalls: "native",
		},
	},
	{
		id: "generic-provider",
		provider: /.*/,
		capabilities: GENERIC_CAPABILITIES,
	},
] as const;

function matches(value: string, matcher: string | RegExp | undefined): boolean {
	if (matcher === undefined) return true;
	return typeof matcher === "string" ? value === matcher : matcher.test(value);
}

export function resolveProviderCapabilities(
	model: ProviderModelDescriptor,
	rules: readonly CapabilityRule[] = PROVIDER_CAPABILITY_RULES,
): { ruleId: string; capabilities: ProviderCapabilities } {
	const rule = rules.find((candidate) =>
		matches(model.provider, candidate.provider)
		&& matches(model.id, candidate.model)
		&& matches(model.api ?? "", candidate.api)
	) ?? PROVIDER_CAPABILITY_RULES[PROVIDER_CAPABILITY_RULES.length - 1]!;
	return { ruleId: rule.id, capabilities: rule.capabilities };
}

function route(requested: boolean | undefined, support: CapabilitySupport, allowAdapters: boolean): NegotiatedRoute {
	if (!requested) return "not-requested";
	if (support === "native") return "native";
	if (support === "adapter" && allowAdapters) return "adapter";
	return "unavailable";
}

export function negotiateProviderCapabilities(
	model: ProviderModelDescriptor,
	request: CapabilityRequest,
	rules: readonly CapabilityRule[] = PROVIDER_CAPABILITY_RULES,
): CapabilityNegotiation {
	const resolved = resolveProviderCapabilities(model, rules);
	const capabilities = resolved.capabilities;
	const allowAdapters = request.allowAdapters !== false;
	const realtimeAudio = route(request.realtimeAudio, capabilities.realtimeAudio, allowAdapters);
	const realtimeVideo = route(request.realtimeVideo, capabilities.realtimeVideo, allowAdapters);
	const realtimeImage = route(request.realtimeImage, capabilities.realtimeImage, allowAdapters);
	const webSearch = route(request.webSearch, capabilities.webSearch, allowAdapters);
	const toolCalls = route(request.toolCalls, capabilities.toolCalls, allowAdapters);
	const citations = route(request.citations, capabilities.citations, allowAdapters);

	let transport: RealtimeTransport | undefined;
	if (realtimeAudio !== "unavailable" && realtimeAudio !== "not-requested") {
		const preferences = request.preferredTransports ?? ["webrtc", "websocket", "livekit"];
		transport = preferences.find((candidate) => capabilities.realtimeTransports.includes(candidate));
	}

	const missing: CapabilityNegotiation["missing"] = [];
	if (realtimeAudio === "unavailable") missing.push("realtimeAudio");
	if (request.realtimeAudio && realtimeAudio !== "unavailable" && !transport) missing.push("transport");
	if (realtimeVideo === "unavailable") missing.push("realtimeVideo");
	if (realtimeImage === "unavailable") missing.push("realtimeImage");
	if (webSearch === "unavailable") missing.push("webSearch");
	if (toolCalls === "unavailable") missing.push("toolCalls");
	if (citations === "unavailable") missing.push("citations");

	return {
		ruleId: resolved.ruleId,
		model,
		capabilities,
		realtimeAudio,
		realtimeVideo,
		realtimeImage,
		transport,
		webSearch,
		searchTool: webSearch === "not-requested" || webSearch === "unavailable" ? undefined : capabilities.searchTool,
		toolCalls,
		citations,
		missing,
		usesFallback: [realtimeAudio, realtimeVideo, realtimeImage, webSearch, toolCalls, citations].includes("adapter"),
	};
}

/**
 * Realtime capability tiers. Keating drives every provider at the highest tier
 * it actually supports and degrades explicitly rather than failing:
 *
 *   3 — audio duplex + a native provider video lane + tools
 *   2 — audio duplex + tools, vision supplied by Keating's frame sampler
 *   1 — audio duplex + tools, no vision at all
 *   0 — no duplex session; push-to-talk STT plus one-shot TTS
 */
export type RealtimeTier = 0 | 1 | 2 | 3;

export interface RealtimeTierDescriptor {
	tier: RealtimeTier;
	label: string;
	/** True when the session can show the model what the learner sees. */
	video: boolean;
	/** How frames reach the model, when they can at all. */
	videoRoute: "native" | "sampled" | "none";
	/**
	 * Why the tier is not higher, for surfacing in the UI. Undefined at tier 3.
	 */
	capReason?: string;
}

const TIER_LABELS: Record<RealtimeTier, string> = {
	3: "Audio + video duplex",
	2: "Audio duplex + sampled vision",
	1: "Audio duplex",
	0: "Half duplex (push to talk)",
};

/**
 * Collapse a model's capabilities into the tier Keating can actually drive.
 * Tool calling is required above tier 0: a live session that cannot reach the
 * Keating tool catalog is not a teaching session, so it is treated as
 * half-duplex regardless of how good its audio is.
 */
export function resolveRealtimeTier(
	model: ProviderModelDescriptor,
	rules: readonly CapabilityRule[] = PROVIDER_CAPABILITY_RULES,
): RealtimeTierDescriptor {
	const { capabilities } = resolveProviderCapabilities(model, rules);
	const hasTransport = capabilities.realtimeTransports.length > 0;

	if (capabilities.realtimeAudio !== "native" || !hasTransport) {
		return {
			tier: 0,
			label: TIER_LABELS[0],
			video: false,
			videoRoute: "none",
			capReason: hasTransport
				? "This model has no native realtime audio."
				: "This model has no realtime transport.",
		};
	}
	if (capabilities.toolCalls !== "native") {
		return {
			tier: 0,
			label: TIER_LABELS[0],
			video: false,
			videoRoute: "none",
			capReason: "This model cannot call tools in a live session.",
		};
	}
	if (capabilities.realtimeVideo === "native") {
		return { tier: 3, label: TIER_LABELS[3], video: true, videoRoute: "native" };
	}
	if (capabilities.realtimeVideo === "adapter" || capabilities.realtimeImage === "native") {
		return {
			tier: 2,
			label: TIER_LABELS[2],
			video: true,
			videoRoute: "sampled",
			capReason: "This model has no live video lane, so Keating samples frames as still images.",
		};
	}
	return {
		tier: 1,
		label: TIER_LABELS[1],
		video: false,
		videoRoute: "none",
		capReason: "This model cannot accept image or video input.",
	};
}

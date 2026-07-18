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
	transport?: RealtimeTransport;
	webSearch: NegotiatedRoute;
	searchTool?: SearchToolKind;
	toolCalls: NegotiatedRoute;
	citations: NegotiatedRoute;
	missing: Array<"realtimeAudio" | "webSearch" | "toolCalls" | "citations" | "transport">;
	usesFallback: boolean;
}

const GENERIC_CAPABILITIES: ProviderCapabilities = {
	realtimeAudio: "none",
	realtimeTransports: [],
	webSearch: "adapter",
	searchTool: "client-web-search",
	toolCalls: "adapter",
	citations: "adapter",
	citationKind: "tool-results",
};

const OPENAI_TEXT: ProviderCapabilities = {
	realtimeAudio: "none",
	realtimeTransports: [],
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
		id: "openai-realtime",
		provider: "openai",
		model: /(?:^|[-_.])realtime(?:$|[-_.])|^gpt-realtime/i,
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
	if (webSearch === "unavailable") missing.push("webSearch");
	if (toolCalls === "unavailable") missing.push("toolCalls");
	if (citations === "unavailable") missing.push("citations");

	return {
		ruleId: resolved.ruleId,
		model,
		capabilities,
		realtimeAudio,
		transport,
		webSearch,
		searchTool: webSearch === "not-requested" || webSearch === "unavailable" ? undefined : capabilities.searchTool,
		toolCalls,
		citations,
		missing,
		usesFallback: [realtimeAudio, webSearch, toolCalls, citations].includes("adapter"),
	};
}

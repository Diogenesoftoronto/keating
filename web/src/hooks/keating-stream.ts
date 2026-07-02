import {
	createAssistantMessageEventStream,
	type Api,
	type AssistantMessage,
	type Context,
	type Model,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import { normalizeToolCallStream } from "../keating/tool-call-normalizer";
import { streamWithApiRetry } from "../keating/api-retry";
import { chatProxyBaseUrl, proxyTargetHeader, shouldProxyModel } from "../lib/provider-proxy";
import { DIO_DEFAULT_MODEL } from "../dio-provider";
import { loadKeatingUiSettings } from "../keating/ui-settings";
import { getProviderApiKey } from "../lib/provider-models";
import { localModel, getModelName, getModelId } from "../stores/local-model";

export const DEFAULT_MODEL = DIO_DEFAULT_MODEL;

function isGoogleGroundingModel(model: Model<Api>): boolean {
	return model.provider === "google" && model.api === "google-generative-ai" && /^gemini-(?:2(?:\.0|\.5)|3|3\.1|3\.5)/.test(model.id);
}

function supportsGoogleSearchWithCustomTools(model: Model<Api>): boolean {
	return /^gemini-3/.test(model.id);
}

function hasGoogleSearchTool(payload: any): boolean {
	return Array.isArray(payload?.config?.tools)
		&& payload.config.tools.some((tool: any) => tool?.googleSearch || tool?.google_search);
}

export function applyGoogleSearchGrounding(payload: unknown, model: Model<Api>, hasApiKey: boolean): unknown | undefined {
	if (!hasApiKey || loadKeatingUiSettings().webSearch === "off" || !isGoogleGroundingModel(model)) {
		return undefined;
	}

	const params = payload as any;
	const existingTools = Array.isArray(params?.config?.tools) ? params.config.tools : [];
	if (existingTools.length > 0 && !supportsGoogleSearchWithCustomTools(model)) {
		return undefined;
	}
	if (hasGoogleSearchTool(params)) {
		return undefined;
	}

	return {
		...params,
		config: {
			...(params?.config ?? {}),
			tools: [...existingTools, { googleSearch: {} }],
		},
	};
}

// ─── OpenAI native web search ────────────────────────────────────────────────
// The Responses API exposes a hosted `web_search` tool. Older snapshots only
// accept `web_search_preview`; newer GPT-5 models accept `web_search`.
function isOpenAiWebSearchModel(model: Model<Api>): boolean {
	if (model.provider !== "openai") return false;
	if (model.api !== "openai-responses") return false;
	// Hosted web search is available on GPT-4o, GPT-4.1, GPT-5, and o-series
	// reasoning models. Exclude codex-only and deep-research slugs that ship
	// their own search behavior.
	if (/codex/.test(model.id)) return false;
	return /^(gpt-4o|gpt-4\.1|gpt-5|o[1345])/.test(model.id);
}

function openAiWebSearchToolType(model: Model<Api>): "web_search" | "web_search_preview" {
	// GPT-5 era and o3/o4 reasoning models use the GA `web_search` type. The
	// 4o/4.1 generation still expects the `web_search_preview` type.
	return /^(gpt-5|o3|o4)/.test(model.id) ? "web_search" : "web_search_preview";
}

function hasOpenAiWebSearchTool(params: any): boolean {
	return Array.isArray(params?.tools)
		&& params.tools.some((tool: any) => typeof tool?.type === "string" && tool.type.startsWith("web_search"));
}

function applyOpenAiWebSearch(payload: unknown, model: Model<Api>, hasApiKey: boolean): unknown | undefined {
	if (!hasApiKey || loadKeatingUiSettings().webSearch === "off" || !isOpenAiWebSearchModel(model)) {
		return undefined;
	}
	const params = payload as any;
	if (hasOpenAiWebSearchTool(params)) return undefined;
	const existingTools = Array.isArray(params?.tools) ? params.tools : [];
	return {
		...params,
		tools: [...existingTools, { type: openAiWebSearchToolType(model) }],
	};
}

// ─── Anthropic native web search ─────────────────────────────────────────────
// Anthropic exposes a server-side `web_search` tool via a versioned type.
const ANTHROPIC_WEB_SEARCH_TOOL = { type: "web_search_20250305", name: "web_search" } as const;

function isAnthropicWebSearchModel(model: Model<Api>): boolean {
	if (model.provider !== "anthropic") return false;
	if (model.api !== "anthropic-messages") return false;
	// Web search is supported on Claude 3.5+ (Sonnet/Haiku/Opus) and the 4.x line.
	return /^claude-(?:3-5|3-7|sonnet-4|opus-4|haiku-4|fable-)/.test(model.id);
}

function hasAnthropicWebSearchTool(params: any): boolean {
	return Array.isArray(params?.tools)
		&& params.tools.some((tool: any) => typeof tool?.type === "string" && tool.type.startsWith("web_search"));
}

function applyAnthropicWebSearch(payload: unknown, model: Model<Api>, hasApiKey: boolean): unknown | undefined {
	if (!hasApiKey || loadKeatingUiSettings().webSearch === "off" || !isAnthropicWebSearchModel(model)) {
		return undefined;
	}
	const params = payload as any;
	if (hasAnthropicWebSearchTool(params)) return undefined;
	const existingTools = Array.isArray(params?.tools) ? params.tools : [];
	return {
		...params,
		tools: [...existingTools, { ...ANTHROPIC_WEB_SEARCH_TOOL }],
	};
}

/**
 * Inject provider-native web search for keyed requests when the active model
 * supports it. Google grounding, OpenAI native search, and Anthropic native
 * search all share the same `webSearch` setting.
 */
export function applyProviderWebSearch(payload: unknown, model: Model<Api>, hasApiKey: boolean): unknown | undefined {
	switch (model.provider) {
		case "google":
			return applyGoogleSearchGrounding(payload, model, hasApiKey);
		case "openai":
			return applyOpenAiWebSearch(payload, model, hasApiKey);
		case "anthropic":
			return applyAnthropicWebSearch(payload, model, hasApiKey);
		default:
			return undefined;
	}
}

function mergeOnPayload(
	options: SimpleStreamOptions | undefined,
	model: Model<Api>,
): SimpleStreamOptions | undefined {
	if (model.provider !== "google" && model.provider !== "openai" && model.provider !== "anthropic") {
		return options;
	}

	return {
		...options,
		onPayload: async (payload, payloadModel) => {
			const userPayload = await options?.onPayload?.(payload, payloadModel);
			const nextPayload = userPayload ?? payload;
			const groundedPayload = applyProviderWebSearch(nextPayload, payloadModel, !!options?.apiKey);
			return groundedPayload ?? userPayload;
		},
	};
}

function createBrowserStreamFn() {
	return async (_model: Model<Api>, context: Context, options?: SimpleStreamOptions) => {
		const stream = createAssistantMessageEventStream();
		const abortSignal = options?.signal;

		const defaultFields = {
			api: "browser" as const,
			provider: "browser" as const,
			model: getModelId(),
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
		};

		(async () => {
			try {
				if (abortSignal?.aborted) {
					stream.end({
						...defaultFields,
						role: "assistant",
						content: [],
						stopReason: "aborted",
						errorMessage: "Request aborted",
						timestamp: Date.now(),
					} as AssistantMessage);
					return;
				}

				const userMessages = context.messages
					.filter((m): m is Extract<typeof m, { role: "user" }> => m.role === "user")
					.map((m) => {
						const content = m.content;
						if (typeof content === "string") return content;
						return content
							.filter((c): c is Extract<typeof c, { type: "text" }> => c.type === "text")
							.map((c) => c.text)
							.join("\n");
					});

				const systemPrompt = context.systemPrompt || "";
				const conversationHistory = userMessages.join("\n\n");
				const fullPrompt = systemPrompt
					? `${systemPrompt}\n\n${conversationHistory}`
					: conversationHistory;

				const partialMessage: AssistantMessage = {
					...defaultFields,
					role: "assistant",
					content: [{ type: "text", text: "" }],
					stopReason: "stop",
					timestamp: Date.now(),
				};

				stream.push({ type: "start", partial: partialMessage });
				stream.push({ type: "text_start", contentIndex: 0, partial: partialMessage });

				const response = await localModel.generate(
					fullPrompt,
					{ max_length: options?.maxTokens ?? 1024, temperature: options?.temperature ?? 0.7 },
					(token: string) => {
						const textBlock = partialMessage.content[0];
						if (textBlock.type === "text") textBlock.text += token;
						stream.push({ type: "text_delta", contentIndex: 0, delta: token, partial: partialMessage });
					},
				);

				if (abortSignal?.aborted) {
					stream.end({
						...defaultFields,
						role: "assistant",
						content: [{ type: "text", text: response }],
						stopReason: "aborted",
						errorMessage: "Request aborted",
						timestamp: Date.now(),
					} as AssistantMessage);
					return;
				}

				stream.push({
					type: "text_end",
					contentIndex: 0,
					content: response,
					partial: partialMessage,
				});
				stream.end({
					...defaultFields,
					role: "assistant",
					content: [{ type: "text", text: response }],
					stopReason: "stop",
					timestamp: Date.now(),
				} as AssistantMessage);
			} catch (error) {
				stream.end({
					...defaultFields,
					role: "assistant",
					content: [],
					stopReason: "error",
					errorMessage: error instanceof Error ? error.message : String(error),
					timestamp: Date.now(),
				} as AssistantMessage);
			}
		})();

		return stream;
	};
}

export async function hybridStreamFn(model: Model<Api>, context: Context, options?: SimpleStreamOptions) {
	if (model.provider === "browser") {
		return normalizeToolCallStream(await createBrowserStreamFn()(model, context, options), context);
	}

	const apiKey = options?.apiKey ?? await getProviderApiKey(model.provider);
	const streamOptions: SimpleStreamOptions | undefined = apiKey ? { ...options, apiKey } : options;

	if (shouldProxyModel(model)) {
		const proxiedModel = {
			...model,
			baseUrl: chatProxyBaseUrl(),
		};
		const proxiedOptions: SimpleStreamOptions = {
			...streamOptions,
			headers: {
				...streamOptions?.headers,
				"x-target-url": proxyTargetHeader(model.baseUrl),
			},
		};
		if (import.meta.env.DEV) {
			const hasApiKey = !!proxiedOptions.apiKey;
			console.log(`[keating:stream] proxy ${model.provider} -> ${model.baseUrl} (apiKey=${hasApiKey})`);
		}
		const mergedOptions = mergeOnPayload(proxiedOptions, proxiedModel);
		return normalizeToolCallStream(
			streamWithApiRetry(proxiedModel, context, mergedOptions, (nextOptions) => streamSimple(proxiedModel, context, nextOptions)),
			context,
		);
	}

	const mergedOptions = mergeOnPayload(streamOptions, model);
	return normalizeToolCallStream(
		streamWithApiRetry(model, context, mergedOptions, (nextOptions) => streamSimple(model, context, nextOptions)),
		context,
	);
}

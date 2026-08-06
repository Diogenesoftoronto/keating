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
import {
	isNotOrganicProvider,
	NOTORGANIC_DEFAULT_MODEL,
} from "../notorganic-provider";
import {
	applyGoogleSearchGrounding,
	applyProviderWebSearch,
	resolveProviderWebSearchRoute,
} from "../keating/provider-web-search";
import { signalHostedSearchActivation } from "../keating/search";

// Compatibility exports for existing integrations and tests. New routing should
// prefer applyProviderWebSearch so capability negotiation stays centralized.
export { applyGoogleSearchGrounding, applyProviderWebSearch };
import { getProviderApiKey } from "../lib/provider-models";
import { localModel, DEFAULT_BROWSER_MODEL_ID } from "../stores/local-model";

export const DEFAULT_MODEL = NOTORGANIC_DEFAULT_MODEL;

export function withProviderWebSearch(
	options: SimpleStreamOptions | undefined,
	model: Model<Api>,
	hasApiKey: boolean,
): SimpleStreamOptions | undefined {
	if (model.provider !== "google" && model.provider !== "openai" && model.provider !== "anthropic") {
		return options;
	}
	let signalled = false;

	return {
		...options,
		onPayload: async (payload, payloadModel) => {
			const userPayload = await options?.onPayload?.(payload, payloadModel);
			const nextPayload = userPayload ?? payload;
			const groundedPayload = applyProviderWebSearch(nextPayload, payloadModel, hasApiKey);
			if (groundedPayload !== undefined && !signalled) {
				signalled = true;
				signalHostedSearchActivation(resolveProviderWebSearchRoute(payloadModel, hasApiKey));
			}
			return groundedPayload ?? userPayload;
		},
	};
}

function createBrowserStreamFn() {
	return async (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => {
		const stream = createAssistantMessageEventStream();
		const abortSignal = options?.signal;
		// Report the model that was actually selected, not the catalog default.
		const modelId = model.id || DEFAULT_BROWSER_MODEL_ID;

		const defaultFields = {
			api: "browser" as const,
			provider: "browser" as const,
			model: modelId,
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

				// Selecting a different browser model has to swap the loaded weights
				// before any tokens are generated.
				if (localModel.getState().modelId !== modelId || !localModel.getState().loaded) {
					await localModel.load(modelId);
					const loadState = localModel.getState();
					if (!loadState.loaded) {
						throw new Error(loadState.error ?? `Could not load ${modelId}`);
					}
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
				const message = error instanceof Error ? error.message : String(error);
				// Without this the failure is invisible: the UI shows the generic
				// "Request failed" card and nothing reaches the console.
				console.error(`[keating-stream] browser model ${modelId} failed:`, error);
				stream.end({
					...defaultFields,
					role: "assistant",
					content: [],
					stopReason: "error",
					errorMessage: message,
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
	let streamOptions: SimpleStreamOptions | undefined = apiKey ? { ...options, apiKey } : options;
	if (isNotOrganicProvider(model.provider)) {
		streamOptions = {
			...streamOptions,
			headers: {
				...streamOptions?.headers,
				"idempotency-key": `keating_${crypto.randomUUID()}`,
			},
		};
	}

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
		const mergedOptions = withProviderWebSearch(proxiedOptions, proxiedModel, !!apiKey);
		return normalizeToolCallStream(
			streamWithApiRetry(proxiedModel, context, mergedOptions, (nextOptions) => streamSimple(proxiedModel, context, nextOptions)),
			context,
		);
	}

	const mergedOptions = withProviderWebSearch(streamOptions, model, !!apiKey);
	return normalizeToolCallStream(
		streamWithApiRetry(model, context, mergedOptions, (nextOptions) => streamSimple(model, context, nextOptions)),
		context,
	);
}

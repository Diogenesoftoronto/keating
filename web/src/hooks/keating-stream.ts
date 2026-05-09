import {
	createAssistantMessageEventStream,
	getModel,
	streamSimple,
	type Api,
	type AssistantMessage,
	type Context,
	type Model,
	type SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import { normalizeToolCallStream } from "../keating/tool-call-normalizer";
import { chatProxyBaseUrl, proxyTargetHeader, shouldProxyModel } from "../lib/provider-proxy";
import { localModel, getModelName, getModelId } from "../stores/local-model";

export const DEFAULT_MODEL = getModel("google", "gemini-3-flash-preview");

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

				const response = await localModel.generate(
					fullPrompt,
					{ max_length: options?.maxTokens ?? 1024, temperature: options?.temperature ?? 0.7 },
					(token: string) => {
						const textBlock = partialMessage.content[0];
						if (textBlock.type === "text") textBlock.text += token;
						stream.push({ type: "text_start", contentIndex: 0, partial: partialMessage });
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

	if (shouldProxyModel(model)) {
		const proxiedModel = {
			...model,
			baseUrl: chatProxyBaseUrl(),
		};
		const proxiedOptions: SimpleStreamOptions = {
			...options,
			headers: {
				...options?.headers,
				"x-target-url": proxyTargetHeader(model.baseUrl),
			},
		};
		return normalizeToolCallStream(streamSimple(proxiedModel, context, proxiedOptions), context);
	}

	return normalizeToolCallStream(streamSimple(model, context, options), context);
}

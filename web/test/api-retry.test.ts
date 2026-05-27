import { describe, expect, test } from "bun:test";
import {
	createAssistantMessageEventStream,
	type Api,
	type AssistantMessage,
	type Context,
	type Model,
} from "@earendil-works/pi-ai";
import { isRetryableApiError, streamWithApiRetry, WEB_API_RETRY_POLICY } from "../src/keating/api-retry";

const model: Model<Api> = {
	id: "test-model",
	name: "Test Model",
	api: "openai-completions",
	provider: "test-provider",
	baseUrl: "https://example.test/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8192,
	maxTokens: 4096,
};

const context: Context = { messages: [] };

function assistant(stopReason: AssistantMessage["stopReason"], errorMessage?: string): AssistantMessage {
	return {
		role: "assistant",
		api: model.api,
		provider: model.provider,
		model: model.id,
		content: [],
		stopReason,
		errorMessage,
		timestamp: Date.now(),
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
}

describe("web API retry", () => {
	test("classifies common provider rate-limit failures", () => {
		expect(isRetryableApiError("HTTP 429: Too Many Requests")).toBe(true);
		expect(isRetryableApiError("Google RESOURCE_EXHAUSTED quota exceeded")).toBe(true);
		expect(isRetryableApiError("HTTP 401: invalid API key")).toBe(false);
	});

	test("retries stream failures before visible output", async () => {
		let attempts = 0;
		const stream = streamWithApiRetry(
			model,
			context,
			undefined,
			() => {
				attempts += 1;
				const source = createAssistantMessageEventStream();
				queueMicrotask(() => {
					if (attempts === 1) {
						source.push({ type: "start", partial: assistant("error", "HTTP 429: Too Many Requests") });
						source.push({ type: "error", reason: "error", error: assistant("error", "HTTP 429: Too Many Requests") });
						return;
					}
					const done = assistant("stop");
					source.push({ type: "start", partial: done });
					source.push({ type: "done", reason: "stop", message: done });
				});
				return source;
			},
			{ ...WEB_API_RETRY_POLICY, initialDelayMs: 0, rateLimitIntervalMs: 0, jitterRatio: 0 },
		);

		const result = await stream.result();

		expect(attempts).toBe(2);
		expect(result.stopReason).toBe("stop");
	});

	test("does not retry after visible output has streamed", async () => {
		let attempts = 0;
		const stream = streamWithApiRetry(
			model,
			context,
			undefined,
			() => {
				attempts += 1;
				const source = createAssistantMessageEventStream();
				queueMicrotask(() => {
					const partial = { ...assistant("error", "HTTP 429: Too Many Requests"), content: [{ type: "text" as const, text: "" }] };
					source.push({ type: "start", partial });
					source.push({ type: "text_start", contentIndex: 0, partial });
					source.push({ type: "error", reason: "error", error: assistant("error", "HTTP 429: Too Many Requests") });
				});
				return source;
			},
			{ ...WEB_API_RETRY_POLICY, initialDelayMs: 0, rateLimitIntervalMs: 0, jitterRatio: 0 },
		);

		const result = await stream.result();

		expect(attempts).toBe(1);
		expect(result.stopReason).toBe("error");
	});
});

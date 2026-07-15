import { describe, expect, test } from "bun:test";
import {
	createAssistantMessageEventStream,
	type Api,
	type AssistantMessage,
	type Context,
	type Model,
} from "@earendil-works/pi-ai";
import {
	classifyLlmError,
	isRetryableApiError,
	retryAfterDelayMs,
	streamWithApiRetry,
	WEB_API_RETRY_POLICY,
} from "../src/keating/api-retry";

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

	test("gives permanent failures specific human recovery guidance", () => {
		expect(classifyLlmError("HTTP 429: insufficient_quota; add credits")).toMatchObject({
			category: "billing",
			automaticRetry: false,
			title: "Provider credits unavailable",
		});
		expect(classifyLlmError("HTTP 400: maximum context length exceeded")).toMatchObject({
			category: "context-length",
			automaticRetry: false,
			title: "Conversation is too large for this model",
		});
		expect(classifyLlmError("HTTP 404: model test-v9 does not exist")).toMatchObject({
			category: "model-unavailable",
			automaticRetry: false,
		});
	});

	test("reads structured provider status and Retry-After values", () => {
		const error = {
			message: "request throttled",
			response: {
				status: 429,
				headers: new Headers({ "retry-after": "3" }),
			},
		};
		expect(retryAfterDelayMs(error)).toBe(3_000);
		expect(classifyLlmError(error)).toMatchObject({
			category: "rate-limit",
			statusCode: 429,
			retryAfterMs: 3_000,
			automaticRetry: true,
		});
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

	test("retries when a stream opened but produced no visible content", async () => {
		let attempts = 0;
		const stream = streamWithApiRetry(
			model,
			context,
			undefined,
			() => {
				attempts += 1;
				const source = createAssistantMessageEventStream();
				queueMicrotask(() => {
					if (attempts > 1) {
						const done = assistant("stop");
						source.push({ type: "start", partial: done });
						source.push({ type: "done", reason: "stop", message: done });
						return;
					}
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

		expect(attempts).toBe(2);
		expect(result.stopReason).toBe("stop");
	});

	test("does not replay a request after visible output has streamed", async () => {
		let attempts = 0;
		const stream = streamWithApiRetry(
			model,
			context,
			undefined,
			() => {
				attempts += 1;
				const source = createAssistantMessageEventStream();
				queueMicrotask(() => {
					const partial = { ...assistant("error", "HTTP 503: overloaded"), content: [{ type: "text" as const, text: "Partial" }] };
					source.push({ type: "start", partial });
					source.push({ type: "text_start", contentIndex: 0, partial });
					source.push({ type: "text_delta", contentIndex: 0, delta: "Partial", partial });
					source.push({ type: "error", reason: "error", error: assistant("error", "HTTP 503: overloaded") });
				});
				return source;
			},
			{ ...WEB_API_RETRY_POLICY, initialDelayMs: 0, rateLimitIntervalMs: 0, jitterRatio: 0 },
		);

		const result = await stream.result() as AssistantMessage & { __keatingRetryAttempts?: number };

		expect(attempts).toBe(1);
		expect(result.stopReason).toBe("error");
		expect(result.__keatingRetryAttempts).toBe(1);
	});

	test("records exhausted automatic recovery attempts on the final error", async () => {
		let attempts = 0;
		const stream = streamWithApiRetry(
			model,
			context,
			undefined,
			() => {
				attempts += 1;
				const source = createAssistantMessageEventStream();
				queueMicrotask(() => {
					source.push({ type: "error", reason: "error", error: assistant("error", "HTTP 429: Too Many Requests") });
				});
				return source;
			},
			{ ...WEB_API_RETRY_POLICY, maxAttempts: 3, initialDelayMs: 0, rateLimitIntervalMs: 0, jitterRatio: 0 },
		);

		const result = await stream.result() as AssistantMessage & {
			__keatingRetryAttempts?: number;
			__keatingRetryExhausted?: boolean;
		};

		expect(attempts).toBe(3);
		expect(result.__keatingRetryAttempts).toBe(3);
		expect(result.__keatingRetryExhausted).toBe(true);
	});
});

import {
	createAssistantMessageEventStream,
	type Api,
	type AssistantMessage,
	type AssistantMessageEvent,
	type AssistantMessageEventStream,
	type Context,
	type Model,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import {
	DEFAULT_API_RETRY_POLICY,
	isRetryableApiError,
	retryDelayMs,
	type ApiRetryPolicy,
} from "../core/api-retry.js";

export {
	isRetryableApiError,
	retryAfterDelayMs,
	retryDelayMs,
	retryableStatusCode,
	type ApiRetryPolicy,
} from "../core/api-retry.js";

export const WEB_API_RETRY_POLICY: ApiRetryPolicy = DEFAULT_API_RETRY_POLICY;

let nextStartAt = 0;

function errorText(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	try {
		return JSON.stringify(error);
	} catch {
		return String(error);
	}
}

function defaultUsage(): AssistantMessage["usage"] {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function errorMessage(model: Model<Api>, error: unknown): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: defaultUsage(),
		stopReason: "error",
		errorMessage: errorText(error),
		timestamp: Date.now(),
	};
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (ms <= 0) return;
	if (signal?.aborted) throw new Error("Request aborted");
	await new Promise<void>((resolve, reject) => {
		let timeout: ReturnType<typeof globalThis.setTimeout>;
		const cleanup = () => {
			globalThis.clearTimeout(timeout);
			signal?.removeEventListener("abort", abort);
		};
		const done = () => {
			cleanup();
			resolve();
		};
		const abort = () => {
			cleanup();
			reject(new Error("Request aborted"));
		};
		timeout = globalThis.setTimeout(done, ms);
		signal?.addEventListener("abort", abort, { once: true });
	});
}

async function waitForApiTurn(policy: ApiRetryPolicy, signal?: AbortSignal): Promise<void> {
	const now = Date.now();
	const waitMs = Math.max(0, nextStartAt - now);
	nextStartAt = Math.max(now, nextStartAt) + policy.rateLimitIntervalMs;
	await sleep(waitMs, signal);
}

export async function withApiRetry<T>(
	operation: () => Promise<T> | T,
	options: { policy?: ApiRetryPolicy; signal?: AbortSignal } = {},
): Promise<T> {
	const policy = options.policy ?? WEB_API_RETRY_POLICY;
	let lastError: unknown;

	for (let attempt = 0; attempt < policy.maxAttempts; attempt += 1) {
		await waitForApiTurn(policy, options.signal);
		try {
			return await operation();
		} catch (error) {
			lastError = error;
			if (attempt >= policy.maxAttempts - 1 || !isRetryableApiError(error)) throw error;
			await sleep(retryDelayMs(attempt, error, policy), options.signal);
		}
	}

	throw lastError;
}

function terminalErrorEvent(model: Model<Api>, error: unknown): AssistantMessageEvent {
	const message = errorMessage(model, error);
	return { type: "error", reason: "error", error: message };
}

function forwardBuffered(target: AssistantMessageEventStream, pending: AssistantMessageEvent[]): void {
	for (const event of pending) target.push(event);
	pending.length = 0;
}

export function streamWithApiRetry(
	model: Model<Api>,
	context: Context,
	options: SimpleStreamOptions | undefined,
	createStream: (options?: SimpleStreamOptions) => AssistantMessageEventStream,
	policy: ApiRetryPolicy = WEB_API_RETRY_POLICY,
): AssistantMessageEventStream {
	const target = createAssistantMessageEventStream();

	(async () => {
		let finalError: unknown;
		for (let attempt = 0; attempt < policy.maxAttempts; attempt += 1) {
			const pending: AssistantMessageEvent[] = [];
			let forwarded = false;
			let attemptError: AssistantMessage | null = null;

			try {
				await waitForApiTurn(policy, options?.signal);
				const source = createStream({
					...options,
					maxRetries: options?.maxRetries ?? 0,
					maxRetryDelayMs: options?.maxRetryDelayMs ?? policy.maxDelayMs,
				});

				for await (const event of source) {
					if (event.type === "error") {
						attemptError = event.error;
						break;
					}

					if (!forwarded) {
						if (event.type === "start") {
							pending.push(event);
							continue;
						}
						forwardBuffered(target, pending);
						forwarded = true;
					}
					target.push(event);
				}
			} catch (error) {
				attemptError = errorMessage(model, error);
			}

			if (!attemptError) return;
			finalError = attemptError.errorMessage ?? "API request failed";

			const canRetry = !forwarded
				&& !options?.signal?.aborted
				&& attempt < policy.maxAttempts - 1
				&& isRetryableApiError(finalError);

			if (canRetry) {
				await sleep(retryDelayMs(attempt, finalError, policy), options?.signal);
				continue;
			}

			forwardBuffered(target, pending);
			target.push({ type: "error", reason: attemptError.stopReason === "aborted" ? "aborted" : "error", error: attemptError });
			return;
		}

		target.push(terminalErrorEvent(model, finalError ?? "API request failed"));
	})().catch((error) => {
		target.push(terminalErrorEvent(model, error));
	});

	return target;
}

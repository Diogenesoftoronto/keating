import { expect, test } from "bun:test";
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { normalizeProviderStreamOptions } from "../src/hooks/keating-stream";
import { classifyLlmError } from "../src/core/api-retry";
import { createNotOrganicInferenceFetch } from "../src/notorganic-provider/inference-fetch";
import { inklingFallbackModel, sameInferenceSession, withInklingFallback } from "../src/notorganic-provider/inkling-fallback";
import { NOTORGANIC_INKLING_2_SMALL_MODEL, NOTORGANIC_SOL_MODEL, NOTORGANIC_LUNA_MODEL, NOTORGANIC_FLINT_MODEL, NOTORGANIC_MERCURY_2_MODEL } from "../src/notorganic-provider";
import { streamWithApiRetry, WEB_API_RETRY_POLICY } from "../src/keating/api-retry";
const url = "https://api.notorganic.test/v1/chat/completions";
const model: Model<Api> = {
	id: "test", name: "Test", api: "openai-completions", provider: "notorganic",
	baseUrl: "https://api.notorganic.test/v1", reasoning: false, input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024,
};

for (const profile of [NOTORGANIC_SOL_MODEL, NOTORGANIC_LUNA_MODEL]) {
test(`${profile.name} uses supported Responses reasoning and omits unsupported sampling`, async () => {
	const selected = { ...profile, baseUrl: "https://api.notorganic.test/v1" };
	expect(getSupportedThinkingLevels(selected)).toEqual(profile === NOTORGANIC_SOL_MODEL
		? ["low", "medium", "high", "xhigh", "max"] : ["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
	for (const [reasoning, expected] of [[undefined, "low"], ["minimal", "low"], ["medium", "medium"], ["xhigh", "xhigh"], ["max", "max"]] as const) {
		let body: Record<string, any> | undefined;
		const options = normalizeProviderStreamOptions(selected, {
			reasoning, temperature: 0.2, sessionId: "learner-session", maxRetries: 0,
			samplingParams: { top_p: 0.9, top_logprobs: 2 },
			fetch: (async (input, init) => {
				body = await new Request(input, init).json();
				if (!["low", "medium", "high", "xhigh", "max"].includes(body!.reasoning?.effort)
					|| ["temperature", "top_p", "top_logprobs"].some(key => key in body!)) {
					return Response.json({ error: { message: "Unsupported Responses parameter" } }, { status: 400 });
				}
				return new Response('event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_sol","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":0,"total_tokens":1}}}\n\n', { headers: { "content-type": "text/event-stream" } });
			}) as typeof fetch,
		});
		const result = await streamSimple(selected, { messages: [{ role: "user", content: "Suggest a title", timestamp: 1 }] }, { ...options, apiKey: "test-key" }).result();
		expect(result.stopReason).toBe("stop");
		expect(body?.reasoning.effort).toBe(expected);
		expect(body?.prompt_cache_key).toBe("learner-session");
		expect(body?.model).toBe(profile.id);
	}
});
}

test("Flint uses account-only Chat Completions parameters and consumes buffered text plus tool-call SSE", async () => {
	const selected = { ...NOTORGANIC_FLINT_MODEL, baseUrl: "https://api.notorganic.test/v1" };
	let outbound: Request | undefined;
	const authenticated = createNotOrganicInferenceFetch({ async headersFor(_method, target, initial) {
		expect(target).toBe(url);
		const headers = new Headers(initial);
		headers.set("authorization", "DPoP flint-account-capability"); headers.set("dpop", "flint-proof");
		return headers;
	} }, url, { idempotencyKey: "flint-request", maxCostMicrousd: 100000, fetch: (async (input, init) => {
		outbound = new Request(input, init);
		const chunks = [
			{ id: "flint_test", model: "flint-multichannel", choices: [{ index: 0, delta: { role: "assistant", content: "Let us check.",
				tool_calls: [{ index: 0, id: "call_verify", type: "function", function: { name: "verify", arguments: '{"topic":"hinge"}' } }] }, finish_reason: null }] },
			{ id: "flint_test", model: "flint-multichannel", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
			{ id: "flint_test", model: "flint-multichannel", choices: [], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } },
		];
		return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
	}) as typeof fetch });
	const result = await streamSimple(selected, {
		systemPrompt: "Help the learner", messages: [{ role: "user", content: "Check hinge", timestamp: 1 }],
		tools: [{ name: "verify", description: "Verify understanding", parameters: Type.Object({ topic: Type.String() }) }],
	}, { fetch: authenticated, headers: { authorization: "DPoP initial" }, maxTokens: 4096, temperature: 0, maxRetries: 0 }).result();
	expect(outbound?.url).toBe(url);
	expect(outbound?.headers.get("authorization")).toBe("DPoP flint-account-capability");
	expect(outbound?.headers.get("x-notorganic-max-cost-microusd")).toBe("100000");
	const body = await outbound!.json();
	expect(body).toMatchObject({ model: "flint", stream: true, stream_options: { include_usage: true }, max_completion_tokens: 4096, temperature: 0 });
	expect(body).not.toHaveProperty("max_tokens");
	expect(body).not.toHaveProperty("store");
	expect(body).not.toHaveProperty("reasoning_effort");
	expect(body.messages[0].role).toBe("system");
	expect(body.tools[0].function.name).toBe("verify");
	expect(result.stopReason).toBe("toolUse");
	expect(result.content).toEqual([{ type: "text", text: "Let us check." }, { type: "toolCall", id: "call_verify", name: "verify", arguments: { topic: "hinge" } }]);
	expect(result.usage.input).toBe(20);
	expect(result.usage.output).toBe(10);
});
test("account Mercury sends exact chat parameters with a device-bound proof and cost ceiling", async () => {
	const selected = { ...NOTORGANIC_MERCURY_2_MODEL, baseUrl: "https://api.notorganic.test/v1" };
	let outbound: Request | undefined;
	const fetch = createNotOrganicInferenceFetch({ async headersFor(method, target, initial) {
		expect(method).toBe("POST");
		expect(target).toBe(url);
		const headers = new Headers(initial);
		headers.set("authorization", "DPoP test-capability");
		headers.set("dpop", "test-proof");
		return headers;
	} }, url, { idempotencyKey: "mercury-turn", maxCostMicrousd: 9000, fetch: (async (input, init) => {
		outbound = new Request(input, init);
		return new Response('data: {"id":"chat","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
	}) as typeof globalThis.fetch });
	const result = await streamSimple(selected, {
		systemPrompt: "Teach fractions.", messages: [{ role: "user", content: "Hello", timestamp: 1 }],
	}, { fetch, headers: { authorization: "DPoP initial" }, reasoning: "low", maxTokens: 50, maxRetries: 0 }).result();
	expect(result.stopReason).toBe("stop");
	expect(result.content).toContainEqual({ type: "text", text: "Hello" });
	expect(outbound?.headers.get("dpop")).toBe("test-proof");
	expect(outbound?.headers.get("authorization")).toBe("DPoP test-capability");
	expect(outbound?.headers.get("x-notorganic-max-cost-microusd")).toBe("9000");
	expect(outbound?.headers.get("idempotency-key")).toBe("mercury-turn");
	expect(await outbound?.json()).toMatchObject({ model: "mercury-2", stream: true, max_completion_tokens: 50, reasoning_effort: "low",
		messages: [{ role: "system", content: "Teach fractions." }, { role: "user", content: "Hello" }] });
});

test("the hosted Inkling SDK preserves a Tinker billing block and attempts the request once", async () => {
	const selected = { ...NOTORGANIC_INKLING_2_SMALL_MODEL, baseUrl: "https://api.notorganic.test/v1" };
	const context: Context = { messages: [{ role: "user", content: "Explain recursion", timestamp: 1 }] };
	let attempts = 0;
	const fetcher = createNotOrganicInferenceFetch({ async headersFor(_method, _target, initial) {
		return new Headers(initial);
	} }, url, { idempotencyKey: "billing-fixture", maxCostMicrousd: 100000, fetch: Object.assign(async () => {
		attempts++;
		return Response.json({
			detail: "Access is blocked due to billing status. Please add payment at https://tinker.thinkingmachines.ai/billing/balance",
			provider: "openai",
		}, { status: 402 });
	}, { preconnect() {} }) });
	const result = await streamWithApiRetry(selected, context, { fetch: fetcher, apiKey: "test-key", maxRetries: 1 },
		options => streamSimple(selected, context, options), { ...WEB_API_RETRY_POLICY, maxAttempts: 3, rateLimitIntervalMs: 0 }).result();
	expect(attempts).toBe(1);
	expect(result.stopReason).toBe("error");
	expect(classifyLlmError(result.errorMessage)).toMatchObject({ category: "provider-billing", statusCode: 402 });
});

test("an Inkling billing block switches transports before publishing events, with an independent signed request", async () => {
	const selected = { ...NOTORGANIC_INKLING_2_SMALL_MODEL, baseUrl: "https://api.notorganic.test/v1" };
	const fallback = { ...NOTORGANIC_SOL_MODEL, baseUrl: selected.baseUrl };
	const context: Context = { messages: [{ role: "user", content: "Explain recursion", timestamp: 1 }] };
	const attempts: Request[] = [];
	const fetcher = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = new Request(input, init);
		attempts.push(request);
		if (request.url.endsWith("/chat/completions")) {
			return Response.json({ detail: "Access is blocked due to billing status. Please add payment at https://tinker.thinkingmachines.ai/billing/balance" }, { status: 402 });
		}
		const text = "Recursion means a function calls itself.";
		const item = { id: "reply", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] };
		const events = [
			{ type: "response.output_item.added", output_index: 0, item: { ...item, content: [] } },
			{ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: text },
			{ type: "response.output_item.done", output_index: 0, item },
			{ type: "response.completed", response: { id: "fallback", status: "completed", output: [item], usage: { input_tokens: 1, output_tokens: 8, total_tokens: 9 } } },
		];
		return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
	}, { preconnect() {} });
	const signing = { async headersFor(_method: string, target: string, initial?: HeadersInit) {
		const headers = new Headers(initial);
		headers.set("authorization", "DPoP same-account");
		headers.set("dpop", `proof-for-${new URL(target).pathname}`);
		return headers;
	} };
	const start = (profile: typeof selected | typeof fallback, endpoint: string, key: string) => streamSimple(profile, context, {
		apiKey: "test-key",
		fetch: createNotOrganicInferenceFetch(signing, endpoint, { fetch: fetcher, idempotencyKey: key, maxCostMicrousd: 100000 }),
	});
	const stream = withInklingFallback(start(selected, url, "inkling-attempt"), async () => start(fallback, `${selected.baseUrl}/responses`, "fallback-attempt"));
	const published: string[] = [];
	for await (const event of stream) published.push(event.type);
	expect(published).not.toContain("error");
	expect(await stream.result()).toMatchObject({ model: "gpt-6.1-sol", stopReason: "stop",
		content: [{ type: "text", text: "Recursion means a function calls itself." }] });
	expect(attempts.map(request => request.headers.get("idempotency-key"))).toEqual(["inkling-attempt", "fallback-attempt"]);
	expect(attempts.map(request => request.headers.get("dpop"))).toEqual(["proof-for-/v1/chat/completions", "proof-for-/v1/responses"]);

	const unavailable = await withInklingFallback(start(selected, url, "legacy-attempt"), async () => null).result();
	expect(unavailable.errorMessage).toBe("The selected hosted model is unavailable right now.");
});

test("an Inkling fallback respects existing grants, media, and account changes", () => {
	const text: Context = { messages: [{ role: "user", content: "Explain recursion", timestamp: 1 }] };
	const image: Context = { messages: [{ role: "user", content: [{ type: "image", mimeType: "image/png", data: "ZA==" }], timestamp: 1 }] };
	expect(inklingFallbackModel("infer:text", image)?.id).toBe("gpt-6.1-sol");
	expect(inklingFallbackModel("infer:gpt-6-luna", image)?.id).toBe("gpt-6-luna");
	expect(inklingFallbackModel("infer:mercury-2", text)?.id).toBe("mercury-2");
	expect(inklingFallbackModel("infer:mercury-2", image)).toBeNull();
	expect(inklingFallbackModel("infer:inkling-2-small", text)).toBeNull();
	const account = { id: "first-session", accessToken: "a", expiresAt: 5000, scope: "infer:text" };
	expect(sameInferenceSession(account, { ...account, accessToken: "renewed" })).toBe(true);
	expect(sameInferenceSession(account, { ...account, id: "different-session" })).toBe(false);
});
for (const sdkRetries of [0, 1]) {
	test(`fresh proofs across retries (SDK retries ${sdkRetries})`, async () => {
		let proofs = 0;
		const attempts: Request[] = [];
		const fetcher = createNotOrganicInferenceFetch({ async headersFor(method, target, initial) {
			expect(method).toBe("POST"); expect(target).toBe(url);
			const headers = new Headers(initial);
			headers.set("authorization", "DPoP test-account-token");
			headers.set("dpop", `single-use-proof-${++proofs}`);
			return headers;
		} }, url, {
			idempotencyKey: "logical-request", maxCostMicrousd: 123,
			fetch: (async (input, init) => {
				attempts.push(new Request(input, init));
				if (attempts.length < 3) return Response.json({ error: { message: "Internal server error" } }, { status: 500 });
				return new Response('data: {"id":"ok","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\ndata: {"id":"ok","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
			}) as typeof fetch,
		});
		const context = { messages: [{ role: "user" as const, content: "Hello", timestamp: 1 }] };
		const stream = streamWithApiRetry(model, context, {
			fetch: fetcher, headers: {
				authorization: "DPoP initial-auth", dpop: "stale-proof", "user-agent": "pi (browser)",
				"Session_Id": "learner-session", "X-Client-Request-Id": "learner-session",
				"X-Session-Affinity": "learner-session", "X-Session-Id": "learner-session",
			}, maxRetries: sdkRetries,
		}, (options) => streamSimple(model, context, options), {
			...WEB_API_RETRY_POLICY, maxAttempts: 3, initialDelayMs: 0, maxDelayMs: 1000, rateLimitIntervalMs: 0, jitterRatio: 0,
		});
		const result = await stream.result();
		expect(result.stopReason).toBe("stop"); expect(attempts).toHaveLength(3);
		expect(new Set(attempts.map((r) => r.headers.get("dpop"))).size).toBe(3);
		for (const request of attempts) {
			expect(request.headers.get("authorization")).toBe("DPoP test-account-token");
			expect(request.headers.get("idempotency-key")).toBe("logical-request");
			expect(request.headers.get("x-notorganic-max-cost-microusd")).toBe("123");
			expect(request.headers.has("user-agent")).toBe(false);
			for (const name of ["session_id", "x-client-request-id", "x-session-affinity", "x-session-id"]) {
				expect(request.headers.has(name)).toBe(false);
			}
			expect((await request.json()).messages[0].content).toBe("Hello");
		}
	});
}
test("rejects unexpected endpoints before signing", async () => {
	let signed = false;
	const fetcher = createNotOrganicInferenceFetch({ async headersFor() { signed = true; return new Headers(); } }, url, { idempotencyKey: "request", maxCostMicrousd: 1 });
	await expect(fetcher("https://unexpected.test/v1/chat/completions", { method: "POST" })).rejects.toThrow("Unexpected");
	expect(signed).toBe(false);
});

test("Responses with a session preserve account authorization and caching without unsupported CORS headers", async () => {
	const selected = { ...NOTORGANIC_SOL_MODEL, baseUrl: "https://api.notorganic.test/v1" };
	const context: Context = {
		tools: [{ name: "lookup", description: "Look up a learning concept", parameters: Type.Object({ topic: Type.String() }) }],
		messages: [
			{ role: "user", content: "Hello", timestamp: 1 },
			{ role: "assistant", content: [{ type: "toolCall", id: "call_lookup", name: "lookup", arguments: { topic: "hinge" } }],
				api: selected.api, provider: selected.provider, model: selected.id, timestamp: 2, stopReason: "toolUse",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
			{ role: "toolResult", toolCallId: "call_lookup", toolName: "lookup", content: [{ type: "text", text: "A pivot point." }], isError: false, timestamp: 3 },
		],
	};
	const target = "https://api.notorganic.test/v1/responses";
	let outbound: Request | undefined;
	const authenticated = createNotOrganicInferenceFetch({ async headersFor(method, requestUrl, initial) {
		expect(method).toBe("POST");
		expect(requestUrl).toBe(target);
		const headers = new Headers(initial);
		headers.set("authorization", "DPoP test-account-token");
		headers.set("dpop", "responses-proof");
		return headers;
	} }, target, {
		idempotencyKey: "responses-request", maxCostMicrousd: 123,
		fetch: (async (input, init) => {
			outbound = new Request(input, init);
			return new Response('event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_test","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":0,"total_tokens":1}}}\n\n', {
				headers: { "content-type": "text/event-stream" },
			});
		}) as typeof fetch,
	});
	const result = await streamSimple(selected, context, {
		fetch: authenticated, headers: { authorization: "DPoP initial" }, sessionId: "learner-session", maxRetries: 0,
	}).result();
	expect(result.stopReason).toBe("stop");
	expect(outbound?.url).toBe(target);
	expect(outbound?.headers.get("authorization")).toBe("DPoP test-account-token");
	expect(outbound?.headers.get("dpop")).toBe("responses-proof");
	expect(outbound?.headers.get("idempotency-key")).toBe("responses-request");
	expect(outbound?.headers.get("x-notorganic-max-cost-microusd")).toBe("123");
	expect(outbound?.headers.has("session_id")).toBe(false);
	expect(outbound?.headers.has("x-client-request-id")).toBe(false);
	const body = await outbound!.json();
	expect(body.model).toBe("gpt-6.1-sol");
	expect(body.prompt_cache_key).toBe("learner-session");
	expect(body.input[0].content[0].text).toBe("Hello");
	expect(body.tools[0]).toMatchObject({ type: "function", name: "lookup", description: "Look up a learning concept",
		parameters: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] } });
	expect(body.input[1]).toMatchObject({ type: "function_call", call_id: "call_lookup", name: "lookup", arguments: '{"topic":"hinge"}' });
	expect(body.input[2]).toMatchObject({ type: "function_call_output", call_id: "call_lookup", output: "A pivot point." });
});

test("real reasoning model serializes supported system and tool roles while preserving account headers", async () => {
	const selected = { ...NOTORGANIC_INKLING_2_SMALL_MODEL, baseUrl: "https://api.notorganic.test/v1" };
	const context: Context = {
		systemPrompt: "Guide the learner through one step at a time.",
		tools: [{ name: "lookup", description: "Look up a learning concept", parameters: Type.Object({ topic: Type.String() }) }],
		messages: [
			{ role: "user", content: "Explain the hinge.", timestamp: 1 },
			{ role: "assistant", content: [{ type: "toolCall", id: "call_lookup", name: "lookup", arguments: { topic: "hinge" } }],
				api: selected.api, provider: selected.provider, model: selected.id, timestamp: 2, stopReason: "toolUse",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
			{ role: "toolResult", toolCallId: "call_lookup", toolName: "lookup", content: [{ type: "text", text: "A pivot point." }], isError: false, timestamp: 3 },
		],
	};
	let outbound: Request | undefined;
	const authenticated = createNotOrganicInferenceFetch({ async headersFor(_method, _url, initial) {
		const headers = new Headers(initial);
		headers.set("authorization", "DPoP test-account-token"); headers.set("dpop", "fresh-test-proof");
		return headers;
	} }, url, { idempotencyKey: "role-regression", maxCostMicrousd: 123, fetch: (async (input, init) => {
		outbound = new Request(input, init);
		return new Response('data: {"id":"ok","choices":[{"index":0,"delta":{"content":"A careful answer."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
	}) as typeof fetch });
	const result = await streamSimple(selected, context, { fetch: authenticated, headers: { authorization: "DPoP stale" }, maxRetries: 0 }).result();
	expect(result.stopReason).toBe("stop");
	expect(selected.reasoning).toBe(true);
	expect(outbound?.headers.get("authorization")).toBe("DPoP test-account-token");
	expect(outbound?.headers.get("dpop")).toBe("fresh-test-proof");
	expect(outbound?.headers.get("idempotency-key")).toBe("role-regression");
	expect(outbound?.headers.get("x-notorganic-max-cost-microusd")).toBe("123");
	const body = await outbound!.json();
	expect(body.messages.map((message: { role: string }) => message.role)).toEqual(["system", "user", "assistant", "tool"]);
	expect(body.messages[0].content).toBe(context.systemPrompt);
	expect(body.messages[2].tool_calls[0]).toMatchObject({ id: "call_lookup", type: "function", function: { name: "lookup", arguments: '{"topic":"hinge"}' } });
	expect(body.messages[3]).toMatchObject({ tool_call_id: "call_lookup", content: "A pivot point." });
	expect(body.tools[0].function).toMatchObject({ name: "lookup", parameters: { type: "object", properties: { topic: { type: "string" } } } });
});

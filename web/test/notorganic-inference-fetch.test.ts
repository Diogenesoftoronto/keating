import { expect, test } from "bun:test";
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import { createNotOrganicInferenceFetch } from "../src/notorganic-provider/inference-fetch";
import { NOTORGANIC_DEFAULT_MODEL } from "../src/notorganic-provider";
import { streamWithApiRetry, WEB_API_RETRY_POLICY } from "../src/keating/api-retry";
const url = "https://api.notorganic.test/v1/chat/completions";
const model: Model<Api> = {
	id: "test", name: "Test", api: "openai-completions", provider: "notorganic",
	baseUrl: "https://api.notorganic.test/v1", reasoning: false, input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024,
};
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
			fetch: fetcher, headers: { authorization: "DPoP initial-auth", dpop: "stale-proof", "user-agent": "pi (browser)" }, maxRetries: sdkRetries,
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

test("real reasoning model serializes supported system and tool roles while preserving account headers", async () => {
	const selected = { ...NOTORGANIC_DEFAULT_MODEL, baseUrl: "https://api.notorganic.test/v1" };
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

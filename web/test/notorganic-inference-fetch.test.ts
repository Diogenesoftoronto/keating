import { expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import { createNotOrganicInferenceFetch } from "../src/notorganic-provider/inference-fetch";
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

import { afterEach, expect, test } from "bun:test";
import { H3 } from "h3";
import { Type } from "typebox";
import { hybridStreamFn } from "../src/hooks/keating-stream";
import { getCloudProviderModels } from "../src/lib/models-dev-catalog";
import chatProxy from "../server/api/chat-proxy/[...slug]";
import { MemoryPublicAbuseStore, setPublicAbuseStoreForTests } from "../server/utils/public-abuse";

const app = new H3().all("/api/chat-proxy/**", chatProxy);
const originalFetch = globalThis.fetch;
const originalLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
afterEach(() => {
	globalThis.fetch = originalFetch;
	setPublicAbuseStoreForTests();
	if (originalLocation) Object.defineProperty(globalThis, "location", originalLocation);
	else Reflect.deleteProperty(globalThis, "location");
});

test("Mercury chat streams text and a teaching tool call through the BYOK proxy", async () => {
	Object.defineProperty(globalThis, "location", { configurable: true, value: new URL("https://keating.test") });
	setPublicAbuseStoreForTests(new MemoryPublicAbuseStore());
	const [model] = getCloudProviderModels("inception");
	let outbound: Request | undefined;
	globalThis.fetch = (async (input, init) => {
		outbound = new Request(input, init);
		const chunks = [
			{ delta: { role: "assistant", content: "Let's check." }, finish_reason: null },
			{ delta: { tool_calls: [{ index: 0, id: "call_verify", type: "function", function: { name: "verify", arguments: '{"topic":' } }] }, finish_reason: null },
			{ delta: { tool_calls: [{ index: 0, function: { arguments: '"fractions"}' } }] }, finish_reason: "tool_calls" },
		];
		const events = chunks.map(choice => "data: " + JSON.stringify({ id: "mercury-test", choices: [{ index: 0, ...choice }] }));
		return new Response([...events, "data: [DONE]", ""].join("\n\n"), { headers: { "content-type": "text/event-stream" } });
	}) as typeof fetch;
	const stream = await hybridStreamFn(model, {
		systemPrompt: "Teach fractions.",
		messages: [{ role: "user", content: "Check my work.", timestamp: 1 }],
		tools: [{ name: "verify", description: "Check a topic", parameters: Type.Object({ topic: Type.String() }) }],
	}, {
		apiKey: "test-inception-key", reasoning: "low", maxTokens: 200, maxRetries: 0,
		fetch: (async (input, init) => app.fetch(new Request(input, init))) as typeof fetch,
	});
	const message = await stream.result();
	expect(message.stopReason).toBe("toolUse");
	expect(message.content).toContainEqual({ type: "text", text: "Let's check." });
	expect(message.content).toContainEqual({ type: "toolCall", id: "call_verify", name: "verify", arguments: { topic: "fractions" } });
	expect(outbound?.url).toBe("https://api.inceptionlabs.ai/v1/chat/completions");
	expect(outbound?.headers.get("authorization")).toBe("Bearer test-inception-key");
	expect(await outbound?.json()).toMatchObject({
		model: "mercury-2", stream: true, reasoning_effort: "low", max_completion_tokens: 200,
		messages: [{ role: "system", content: "Teach fractions." }, { role: "user", content: "Check my work." }],
		tools: [{ type: "function", function: { name: "verify" } }],
	});
});

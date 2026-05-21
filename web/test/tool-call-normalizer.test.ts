import { describe, expect, test } from "bun:test";
import { createAssistantMessageEventStream, type AssistantMessage, type Context } from "@earendil-works/pi-ai";
import { normalizeToolCallStream, resolveToolCallName } from "../src/keating/tool-call-normalizer";

const context: Context = {
	messages: [],
	tools: [
		{ name: "plan", description: "Plan", parameters: { type: "object", properties: {} } as any },
		{ name: "learner_state", description: "Learner state", parameters: { type: "object", properties: {} } as any },
	],
};

function message(toolName: string): AssistantMessage {
	return {
		role: "assistant",
		api: "openai-completions",
		provider: "openai",
		model: "test",
		content: [{ type: "toolCall", id: "call-1", name: toolName, arguments: {} }],
		stopReason: "toolUse",
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

describe("tool call normalizer", () => {
	test("resolves common provider-emitted tool name variants", () => {
		expect(resolveToolCallName("functions.plan", context)).toBe("plan");
		expect(resolveToolCallName("keating/learner-state", context)).toBe("learner_state");
		expect(resolveToolCallName("PLAN", context)).toBe("plan");
		expect(resolveToolCallName("unknown", context)).toBe("unknown");
	});

	test("normalizes streamed final messages before the agent executes tools", async () => {
		const source = createAssistantMessageEventStream();
		const normalized = normalizeToolCallStream(source, context);
		const final = message("functions.plan");

		queueMicrotask(() => {
			source.push({ type: "start", partial: final });
			source.push({ type: "done", reason: "toolUse", message: final });
		});

		for await (const event of normalized) {
			if (event.type === "done") {
				const call = event.message.content[0];
				expect(call.type).toBe("toolCall");
				if (call.type === "toolCall") expect(call.name).toBe("plan");
			}
		}

		const result = await normalized.result();
		const call = result.content[0];
		expect(call.type).toBe("toolCall");
		if (call.type === "toolCall") expect(call.name).toBe("plan");
	});
});

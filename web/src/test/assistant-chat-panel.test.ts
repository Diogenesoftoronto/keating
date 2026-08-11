import { describe, expect, it } from "bun:test";

import {
	__test_assistantTextParts,
	__test_recordCredentialBlockedSend,
} from "../components/AssistantChatPanel";

describe("AssistantChatPanel reasoning parser", () => {
	it("treats an unmatched closing think tag as hidden reasoning and preserves the visible answer tail", () => {
		const sample = [
			"tool. Let me think about this carefully.",
			"",
			"The",
			"",
			" developer policy says I'm a hyperteacher.",
			"</think>",
			"",
			"Here's the honest situation — and it's actually a useful pedagogical moment, not a refusal.",
		].join("\n");

		expect(__test_assistantTextParts(sample)).toEqual([
			{
				type: "reasoning",
				text: [
					"tool. Let me think about this carefully.",
					"",
					"The",
					"",
					" developer policy says I'm a hyperteacher.",
				].join("\n"),
			},
			{
				type: "text",
				text: "Here's the honest situation — and it's actually a useful pedagogical moment, not a refusal.",
			},
		]);
	});

	it("still parses normal think blocks into reasoning plus visible text", () => {
		const sample = "<think>private reasoning</think>\n\nVisible answer.";
		expect(__test_assistantTextParts(sample)).toEqual([
			{ type: "reasoning", text: "private reasoning" },
			{ type: "text", text: "\n\nVisible answer." },
		]);
	});
});

describe("AssistantChatPanel credential preflight recovery", () => {
	it("persists the exact user turn and a retryable auth error when credentials are unavailable", () => {
		const messages: any[] = [];
		const agent = {
			state: {
				messages,
				model: {
					api: "openai-completions",
					provider: "example-provider",
					id: "example-model",
				},
			},
		} as any;
		const userMessage = {
			role: "user",
			content: [{ type: "text", text: "Keep this exact learner draft." }],
			timestamp: 123,
		} as any;

		__test_recordCredentialBlockedSend(
			agent,
			userMessage,
			"example-provider",
		);

		expect(messages[0]).toBe(userMessage);
		expect(messages[1]).toMatchObject({
			role: "assistant",
			stopReason: "error",
			provider: "example-provider",
			model: "example-model",
		});
		expect(messages[1].errorMessage).toContain("Authentication error");
		expect(messages[1].errorMessage).toContain("retry this message");
	});

	it("does not duplicate an already-recorded learner turn", () => {
		const existing = {
			role: "user",
			content: [{ type: "text", text: "Same learner turn." }],
			timestamp: 100,
		};
		const messages: any[] = [existing];
		const agent = {
			state: {
				messages,
				model: {
					api: "openai-completions",
					provider: "example-provider",
					id: "example-model",
				},
			},
		} as any;

		__test_recordCredentialBlockedSend(
			agent,
			{
				role: "user",
				content: [{ type: "text", text: "Same learner turn." }],
				timestamp: 200,
			} as any,
			"example-provider",
		);

		expect(messages.filter((message) => message.role === "user")).toHaveLength(1);
		expect(messages.at(-1)?.stopReason).toBe("error");
	});
});

import { describe, expect, it } from "bun:test";

import { __test_assistantTextParts } from "../components/AssistantChatPanel";

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

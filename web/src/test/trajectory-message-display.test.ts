import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { collectReviewToolOutcomes, reviewMessageDisplay } from "../keating/trajectory-message-display";

describe("reviewMessageDisplay", () => {
	test("keeps markdown and exposes tool-call inputs without provider reasoning", () => {
		const message = {
			role: "assistant",
			provider: "test",
			model: "teacher",
			stopReason: "toolUse",
			content: [
				{ type: "thinking", thinking: "private chain of thought" },
				{ type: "text", text: "## Let me check\n\nA useful preface." },
				{ type: "toolCall", id: "call-1", name: "learner_state", arguments: { topic: "addition" } },
			],
		} as unknown as AgentMessage;

		const outcomes = collectReviewToolOutcomes([message, {
			role: "toolResult",
			toolCallId: "call-1",
			toolName: "learner_state",
			isError: false,
			content: [{ type: "text", text: "done" }],
		} as unknown as AgentMessage]);
		const display = reviewMessageDisplay(message, outcomes);
		expect(display.markdown).toBe("## Let me check\n\nA useful preface.");
		expect(display.tools).toEqual([{
			kind: "call",
			name: "learner_state",
			callId: "call-1",
			status: "succeeded",
			input: '{\n  "topic": "addition"\n}',
		}]);
		expect(display.raw).toContain("[reasoning omitted from review]");
		expect(display.raw).not.toContain("private chain of thought");
	});

	test("shows tool results, details, errors, and summarizes embedded media", () => {
		const message = {
			role: "toolResult",
			toolCallId: "call-2",
			toolName: "web_search",
			isError: true,
			content: [{ type: "text", text: "**Search failed**" }, { type: "image", mimeType: "image/png", data: "abc" }],
			details: { screenshot: "data:image/png;base64,AAAA" },
		} as unknown as AgentMessage;

		const display = reviewMessageDisplay(message);
			expect(display.tools[0]).toMatchObject({
			kind: "result",
			name: "web_search",
			callId: "call-2",
			status: "failed",
			output: "**Search failed**",
			isError: true,
		});
		expect(display.raw).toContain("encodedCharacters");
		expect(display.raw).toContain("embedded image/png");
		expect(display.raw).not.toContain("data:image/png;base64");
	});
});

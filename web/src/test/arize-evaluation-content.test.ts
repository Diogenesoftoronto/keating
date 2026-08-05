import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { currentTurnEvaluationContent } from "../lib/arize-evaluation-content";

const message = (role: "user" | "assistant", text: string): AgentMessage => ({
	role,
	content: [{ type: "text", text }],
	timestamp: 1,
} as AgentMessage);

describe("Arize evaluation content", () => {
	test("never pairs a new user prompt with a prior turn reply", () => {
		const messages = [
			message("user", "prior prompt"),
			message("assistant", "prior reply"),
			message("user", "current prompt"),
		];
		expect(currentTurnEvaluationContent(messages)).toBeUndefined();
	});

	test("returns only visible text from the latest completed turn", () => {
		const messages = [
			message("user", "prior prompt"),
			message("assistant", "prior reply"),
			message("user", "current prompt"),
			message("assistant", "current reply"),
		];
		expect(currentTurnEvaluationContent(messages)).toEqual({
			input: "current prompt",
			output: "current reply",
		});
	});
});

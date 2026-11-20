import { describe, expect, test } from "bun:test";
import type { AppendMessage } from "@assistant-ui/react";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { makeUserMessageFromAppend, makeUserTextMessage, userTextMessage } from "../components/chat/user-message";
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
			makeUserMessageFromAppend(userTextMessage("current prompt"))!,
			message("assistant", "current reply"),
		];
		expect(currentTurnEvaluationContent(messages)).toEqual({
			input: "current prompt",
			output: "current reply",
		});
	});
});

describe("Arize text provenance", () => {
	const reply = message("assistant", "Visible reply");
	const evaluate = (learner: AgentMessage, assistant = reply) => currentTurnEvaluationContent([learner, assistant]);

	test("accepts a fresh string prompt and shares only the visible part of a reply", () => {
		const learner: AgentMessage = { role: "user", content: "My question", timestamp: 1 };
		expect(evaluate(learner, message("assistant", "<think>private reasoning</think>Visible reply")))
			.toEqual({ input: "My question", output: "Visible reply" });
		const mixed = { ...reply, content: [
			{ type: "thinking", thinking: "private reasoning" },
			{ type: "toolCall", id: "t", name: "read", arguments: { path: "private path" } },
			{ type: "text", text: "Visible reply" },
		] } as AgentMessage;
		expect(evaluate(learner, mixed)).toEqual({ input: "My question", output: "Visible reply" });
		expect(evaluate(learner, { ...mixed, stopReason: "toolUse" } as AgentMessage)).toBeUndefined();
		expect(evaluate(makeUserTextMessage("My question"))).toEqual({ input: "My question", output: "Visible reply" });
	});

	test("omits even the reply when composer input included an attachment or file", () => {
		const text = userTextMessage("Private document question");
		const composed = [
			{ ...text, attachments: [{ content: [{ type: "text", text: "extracted attachment secret" }] }] },
			{ ...text, content: [...text.content, { type: "file", filename: "secret.pdf", mimeType: "application/pdf", data: "encoded secret" }] },
			{ ...text, attachments: [{ content: [{ type: "file", filename: "voice.ogg", mimeType: "audio/ogg", data: "encoded audio" }] }] },
		];
		for (const item of composed) {
			const learner = makeUserMessageFromAppend(item as unknown as AppendMessage)!;
			expect(evaluate(structuredClone(learner))).toBeUndefined();
		}
	});

	test("supplies no content for old arrays, attachment turns, or a resumed answer with no new prompt", () => {
		expect(evaluate(message("user", "flattened attachment of unknown origin"))).toBeUndefined();
		const prior = makeUserTextMessage("Earlier question");
		const attachment: AgentMessage = { role: "user-with-attachments", content: "private", timestamp: 2 };
		expect(currentTurnEvaluationContent([prior, reply, attachment, reply])).toBeUndefined();
		expect(currentTurnEvaluationContent([reply])).toBeUndefined();
	});

	test("omits serialized activities, quoted anchors, withheld diagnostics, and OpenUI source", () => {
		for (const source of ['<keating-learner-response version="1">private state</keating-learner-response>', 'Quoted text <!-- keating-quotes v1 private -->']) {
			expect(evaluate(makeUserTextMessage(source))).toBeUndefined();
		}
		for (const output of ["<!--keating:review=withheld-->private diagnostics", "```openui\nprivate program\n```"]) {
			expect(evaluate(makeUserTextMessage("Hello"), message("assistant", output))).toBeUndefined();
		}
	});
});

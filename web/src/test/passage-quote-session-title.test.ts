import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { sessionPreview, sessionSearchText, sessionTitle } from "../hooks/session-metadata";
import { createPassageQuote, passageQuoteSummaryText, serializeQuotedTurn } from "../keating/passage-quote";

const { quote } = createPassageQuote({
	source: { kind: "message", id: "m-1" },
	exact: "the gradient points uphill",
	prefix: "Remember that ",
	suffix: ", so we step against it.",
})!;

function learnerTurn(text: string): AgentMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp: 1 } as AgentMessage;
}

describe("session metadata for quoted learner turns", () => {
	test("a session opened with a quote is titled by the learner's question", () => {
		const turn = learnerTurn(serializeQuotedTurn({ quotes: [quote], question: "Why do we subtract it?" }));

		const title = sessionTitle([turn]);

		expect(title.startsWith("Why do we subtract it?")).toBe(true);
		expect(title).not.toContain("From Keating's reply");
		expect(title).not.toContain("keating-quotes");
	});

	test("a quote sent without a question is titled by its passage", () => {
		const turn = learnerTurn(serializeQuotedTurn({ quotes: [quote], question: "" }));

		expect(sessionTitle([turn])).toBe("About “the gradient points uphill”");
	});

	test("preview and search keep the passage and the question, never the anchor comment", () => {
		const turn = learnerTurn(serializeQuotedTurn({ quotes: [quote], question: "Why do we subtract it?" }));

		for (const text of [sessionPreview([turn]), sessionSearchText([turn])]) {
			expect(text).toContain("Why do we subtract it?");
			expect(text).toContain("the gradient points uphill");
			expect(text).not.toContain("<!--");
			expect(text).not.toContain("prefix");
		}
	});

	test("ordinary learner text is left exactly as written", () => {
		const plain = "From what I read:\n> a blockquote I typed myself\n\nIs this right?";

		expect(passageQuoteSummaryText(plain)).toBe(plain);
		expect(sessionTitle([learnerTurn(plain)])).toBe("From what I read: > a blockquote I typed myself Is this right?");
	});

	test("a tampered anchor comment is dropped instead of shown", () => {
		const tampered = "From Keating's reply:\n> something\n\nq\n\n<!-- keating-quotes v1 {not json} -->";

		expect(passageQuoteSummaryText(tampered)).not.toContain("keating-quotes");
		expect(sessionTitle([learnerTurn(tampered)])).not.toContain("<!--");
	});
});

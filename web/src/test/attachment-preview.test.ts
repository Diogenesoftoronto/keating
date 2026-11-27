import { describe, expect, test } from "bun:test";
import type { AppendMessage } from "@assistant-ui/react";
import { convertMessages as openAiMessages } from "@earendil-works/pi-ai/api/openai-completions";
import { convertMessages as googleMessages } from "@earendil-works/pi-ai/api/google-shared";
import { contentFromAppendMessage } from "../components/chat/user-message";
import { browserInputMessages } from "../lib/browser-model-input";
import { attachmentCardOf, attachmentPreviewOf, attachmentSegments, attachmentText } from "../keating/attachment-text";

const page = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";
const pdfText = attachmentText("draft.pdf", "application/pdf", '<pdf filename="draft.pdf">\n<page number="1">\nConcept\n</page>\n</pdf>');

describe("a PDF's first page travels with the chat, not to the model", () => {
	const message = {
		role: "user",
		content: [{ type: "text", text: "Here is my draft" }],
		attachments: [{ id: "a", type: "document", name: "draft.pdf", contentType: "application/pdf", status: { type: "complete" },
			content: [{ type: "text", text: pdfText, keatingPreview: page }] }],
	} as unknown as AppendMessage;

	test("the saved turn keeps the picture beside the text the model reads", () => {
		const content = contentFromAppendMessage(message);
		expect(content).toHaveLength(2);
		expect(attachmentPreviewOf(content[1])).toBe(page);
		expect((content[1] as { text: string }).text).toBe(pdfText);
	});

	test("provider requests carry the text only", () => {
		const context = { systemPrompt: "Tutor", messages: [{ role: "user" as const, content: contentFromAppendMessage(message), timestamp: 1 }] };
		const browser = JSON.stringify(browserInputMessages(context as never, false));
		expect(browser).toContain("Concept");
		expect(browser).not.toContain("keatingPreview");
		const model = { id: "gpt-test", api: "openai-completions", provider: "openai", input: ["text", "image"], reasoning: false } as never;
		for (const payload of [openAiMessages(model, context as never, {} as never), googleMessages(model, context as never)]) {
			const json = JSON.stringify(payload);
			expect(json).toContain("Concept");
			expect(json).not.toContain("keatingPreview");
			expect(json).not.toContain("/9j/");
		}
	});
});

test("attachment segments, card detail and preview checks", () => {
	expect(attachmentSegments(`Look\n${pdfText}\nthanks`)).toEqual([
		{ type: "text", text: "Look" },
		{ type: "attachment", file: { name: "draft.pdf", type: "application/pdf", kind: "PDF", pages: 1 } },
		{ type: "text", text: "thanks" },
	]);
	expect(attachmentSegments("plain")).toEqual([{ type: "text", text: "plain" }]);
	expect(attachmentCardOf("application/pdf;keating-detail=PDF%2C%202%20pages")).toEqual({ type: "application/pdf", detail: "PDF, 2 pages" });
	expect(attachmentCardOf("audio/webm")).toBeNull();
	expect(attachmentPreviewOf({ keatingPreview: "data:image/svg+xml;base64,PHN2Zz4=" })).toBeUndefined();
	expect(attachmentPreviewOf({ keatingPreview: `data:image/jpeg;base64,${"A".repeat(500_000)}` })).toBeUndefined();
});

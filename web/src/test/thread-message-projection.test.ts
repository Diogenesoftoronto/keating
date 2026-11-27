import { describe, expect, test } from "bun:test";
import { projectThreadMessages } from "../components/AssistantChatPanel";
import { attachmentCardOf } from "../keating/attachment-text";

const at = 1_790_000_000_000;
const learner = (text: string, extra: Record<string, unknown> = {}) => ({ role: "user", content: [{ type: "text", text }], timestamp: at, ...extra });
const reply = (content: unknown[], extra: Record<string, unknown> = {}) => ({ role: "assistant", content, stopReason: "stop", timestamp: at + 1, ...extra });
const project = (messages: unknown[], running = false) =>
	projectThreadMessages(null, messages as never, running, false, "openai");
const lastRow = (messages: unknown[], running = false) => project(messages, running).at(-1)!;
const texts = (row: ReturnType<typeof lastRow>) =>
	(row.content as { type: string; text?: string }[]).filter((part) => part.type === "text").map((part) => part.text);
const custom = (row: ReturnType<typeof lastRow>) => row.metadata?.custom ?? {};

describe("chat rows built from saved agent messages", () => {
	test("only the last reply that is still being written shows as running", () => {
		const streaming = reply([{ type: "text", text: "Partial" }], { stopReason: undefined });
		expect(lastRow([learner("Hi"), streaming], true).status).toEqual({ type: "running" });
		expect(lastRow([learner("Hi"), streaming], false).status).toEqual({ type: "complete", reason: "stop" });
		const earlier = project([learner("Hi"), streaming, learner("Again")], true)[1]!;
		expect(earlier.status).toEqual({ type: "complete", reason: "stop" });
	});

	test("a reply whose tool calls all have results is not running while its tools finish", () => {
		const toolTurn = reply([{ type: "toolCall", id: "c1", name: "search", arguments: { q: "x" }, __toolResult: "done" }], { stopReason: undefined });
		const row = lastRow([learner("Look it up"), toolTurn], true);
		expect(row.status?.type).not.toBe("running");
	});

	test("thinking becomes reasoning and tool calls keep their arguments", () => {
		const row = lastRow([learner("Why"), reply([
			{ type: "thinking", thinking: "Consider the base case" },
			{ type: "toolCall", id: "c1", name: "search", arguments: { q: "zeta" } },
			{ type: "text", text: "Here is why." },
		])]);
		const parts = row.content as { type: string; text?: string; toolName?: string; args?: unknown; argsText?: string }[];
		expect(parts.find((part) => part.type === "reasoning")?.text).toBe("Consider the base case");
		const call = parts.find((part) => part.type === "tool-call")!;
		expect(call.toolName).toBe("search");
		expect(call.args).toEqual({ q: "zeta" });
		expect(call.argsText).toBe(JSON.stringify({ q: "zeta" }));
		expect(texts(row).join("")).toContain("Here is why.");
	});

	test("a failed reply with no text explains the failure and offers a retry when retrying can help", () => {
		const failed = reply([], { stopReason: "error", errorMessage: "429 Too Many Requests: rate limit exceeded" });
		const row = lastRow([learner("Hi"), failed]);
		expect(row.status).toEqual({ type: "incomplete", reason: "error", error: "429 Too Many Requests: rate limit exceeded" });
		expect(texts(row)[0]).toEndWith("429 Too Many Requests: rate limit exceeded");
		expect(custom(row).keatingLlmFailure).toMatchObject({ category: "rate-limit" });
		expect(custom(row).keatingRetryable).toBe(true);
		expect(custom(row).keatingFailedLastTurn).toBe(true);
		expect(custom(row).keatingRetryAttempts).toBe(1);
	});

	test("failures that a retry cannot fix are not retryable, and neither is an earlier failed turn", () => {
		for (const errorMessage of ["401 Unauthorized: invalid api key", "maximum context length exceeded"]) {
			const row = lastRow([learner("Hi"), reply([], { stopReason: "error", errorMessage })]);
			expect(custom(row).keatingRetryable).toBe(false);
		}
		const earlier = project([learner("Hi"), reply([], { stopReason: "error", errorMessage: "429 rate limit" }), learner("Again")])[1]!;
		expect(earlier.metadata?.custom?.keatingRetryable).toBe(false);
		expect(earlier.metadata?.custom?.keatingFailedLastTurn).toBe(false);
	});

	test("a failed reply keeps the text it did write instead of replacing it with the error", () => {
		const row = lastRow([learner("Hi"), reply([{ type: "text", text: "Half an answer" }], { stopReason: "error", errorMessage: "boom" })]);
		expect(texts(row)[0]).toBe("Half an answer");
	});

	test("a stopped reply says it was interrupted and records retry attempts", () => {
		const row = lastRow([learner("Hi"), reply([], { stopReason: "aborted", __keatingRetryAttempts: 2.6, __keatingRetryExhausted: true })]);
		expect(row.status).toEqual({ type: "incomplete", reason: "cancelled" });
		expect(texts(row)[0]).toBe("Response interrupted before it finished.");
		expect(custom(row).keatingRetryAttempts).toBe(3);
		expect(custom(row).keatingRetryExhausted).toBe(true);
	});

	test("a finished reply carries no failure details", () => {
		const row = lastRow([learner("Hi"), reply([{ type: "text", text: "Hello" }])]);
		expect(custom(row).keatingLlmFailure).toBeUndefined();
		expect(custom(row).keatingRetryable).toBeUndefined();
	});

	test("a tool result row reports a missing result as a failed tool", () => {
		const rows = project([learner("Hi"), { role: "toolResult", toolCallId: "c1", toolName: "search", content: [], timestamp: at + 2 }]);
		const row = rows.at(-1)!;
		expect(row.status).toMatchObject({ type: "incomplete", reason: "error" });
		expect(texts(row)[0]).toContain("Tool search:");
		expect(texts(row)[0]).toContain("Tool execution ended without returning a result.");
		const ok = project([{ role: "toolResult", toolCallId: "c2", toolName: "search", content: [{ type: "text", text: "3 results" }], timestamp: at }])[0]!;
		expect(ok.status).toEqual({ type: "complete", reason: "stop" });
		expect(texts(ok)[0]).toBe("Tool search:\n3 results");
	});

	test("a learner's attached file shows as an attachment, not the text sent to the model", () => {
		const attached = '<attachment name="current-draft.pdf" type="application/pdf">\n<pdf filename="current-draft.pdf">\n<page number="1">\nConcept Proposal\n</page>\n<page number="2">\nmore\n</page>\n</pdf>\n</attachment>';
		const row = project([{ role: "user", content: [{ type: "text", text: "My draft" }, { type: "text", text: attached }], timestamp: at }])[0]!;
		expect(row.role).toBe("user");
		expect(texts(row)).toEqual(["My draft"]);
		const file = (row.content as unknown as { type: string; filename: string; mimeType: string; data: string }[]).find(part => part.type === "file")!;
		expect(file).toMatchObject({ filename: "current-draft.pdf", data: "" });
		expect(attachmentCardOf(file.mimeType)).toEqual({ type: "application/pdf", detail: "PDF, 2 pages" });
		// A first page drawn when the file was attached shows with it.
		const page = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
		const drawn = project([{ role: "user", content: [{ type: "text", text: attached, keatingPreview: page }], timestamp: at }])[0]!;
		expect((drawn.content as unknown as { type: string; data?: string }[]).find(part => part.type === "file")?.data).toBe(page);
		// Anything that is not a small inline picture is ignored.
		const odd = project([{ role: "user", content: [{ type: "text", text: attached, keatingPreview: "https://example.com/x.jpg" }], timestamp: at }])[0]!;
		expect((odd.content as unknown as { type: string; data?: string }[]).find(part => part.type === "file")?.data).toBe("");
	});
});

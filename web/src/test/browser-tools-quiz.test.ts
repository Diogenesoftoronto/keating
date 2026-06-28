import { describe, expect, test } from "bun:test";

if (typeof (globalThis as { DOMMatrix?: unknown }).DOMMatrix === "undefined") {
	(globalThis as { DOMMatrix: new () => unknown }).DOMMatrix = class DOMMatrix {};
}

function textFromToolResult(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter((entry): entry is { type: "text"; text: string } => entry.type === "text")
		.map((entry) => entry.text)
		.join("\n");
}

function parseQuizPayload(text: string): any {
	const match = text.match(/<keating-quiz\s+json=([^>]+)\s*\/>/);
	expect(match).not.toBeNull();
	return JSON.parse(JSON.parse(match![1]!.trim()));
}

describe("quiz tool", () => {
	test("schema requires authored questions", async () => {
		const { createKeatingTools } = await import("../keating/browser-tools");
		const tools = await createKeatingTools({ saveLessonPlan: async () => ({ id: "unused" }) } as any);
		const quizTool = tools.find((tool) => tool.name === "quiz");

		expect(quizTool).toBeDefined();
		expect((quizTool!.parameters as { required?: string[] }).required).toEqual(["topic", "questions"]);
	});

	test("rejects topic-only calls as tool failures", async () => {
		const { createKeatingTools } = await import("../keating/browser-tools");
		const tools = await createKeatingTools({
			saveLessonPlan: async () => {
				throw new Error("should not save invalid quiz");
			},
		} as any);
		const quizTool = tools.find((tool) => tool.name === "quiz");

		expect(quizTool).toBeDefined();
		await expect(
			quizTool!.execute("tool-call-quiz-invalid", {
				topic: "Guile REPL debugging and Scheme type dispatch",
			}),
		).rejects.toThrow("Pass a `questions` array");
	});

	test("emits authored quiz payloads with blank metadata intact", async () => {
		const { createKeatingTools } = await import("../keating/browser-tools");
		let savedPlan: any = null;
		const tools = await createKeatingTools({
			saveLessonPlan: async (topic: string, content: string, metadata: Record<string, unknown>) => {
				savedPlan = { id: "quiz-plan-1", topic, content, metadata };
				return savedPlan;
			},
		} as any);
		const quizTool = tools.find((tool) => tool.name === "quiz");

		expect(quizTool).toBeDefined();
		const result = await quizTool!.execute("tool-call-quiz-valid", {
			topic: "Guile REPL debugging and Scheme type dispatch",
			questions: [
				{
					question: "Fill the slot: `(type-of x)` helps reveal the runtime ___.",
					type: "fill_in",
					level: "recall",
					blanks: [{ placeholder: "slot", hint: "what kind of value?" }],
					correctAnswer: "type",
					correctAnswers: ["type"],
					explanation: "In REPL debugging, inspecting the runtime type is often the fastest dispatch clue.",
				},
				{
					question: "What should you do after a procedure fails on an unexpected Guile value?",
					type: "multiple_choice",
					level: "application",
					options: ["Inspect the value and dispatch path", "Retry blindly", "Delete the REPL", "Ignore the error"],
					correctAnswer: "Inspect the value and dispatch path",
					explanation: "Good REPL debugging narrows the concrete value shape before changing code.",
				},
			],
		});

		const text = textFromToolResult(result as any);
		const quiz = parseQuizPayload(text);
		const fillIn = quiz.questions.find((question: any) => question.type === "fill_in");

		expect(savedPlan).toMatchObject({
			id: "quiz-plan-1",
			topic: "Guile REPL debugging and Scheme type dispatch",
			metadata: { type: "quiz", questionCount: 2 },
		});
		expect(text).toContain("<keating-quiz json=");
		expect(fillIn.blanks).toEqual([{ placeholder: "slot", hint: "what kind of value?" }]);
		expect(fillIn.correctAnswers).toEqual(["type"]);
	});
});

import { describe, expect, it } from "bun:test";
import { compileOpenUISourceToSharedDocument, EXAM_SOURCE_QUESTIONS_FIXTURE, tryCompileOpenUISourceToSharedDocument, validateUiAction, validateUiDocument } from "../src/index.js";

const options = { documentId: "exam-test", createdAt: "2026-09-06T00:00:00.000Z" };
const questions = EXAM_SOURCE_QUESTIONS_FIXTURE;
function source(seconds?: unknown, items: readonly unknown[] = questions) { return `root = LearningSurface([test], "", "", "resumable")\ntest = Exam(${JSON.stringify({ id: "exam", topic: "Caches & tradeoffs", questions: items, ...(seconds === undefined ? {} : { examTimeLimit: seconds }) })})`; }

describe("Exam source and contract", () => {
	it("lowers Exam to quiz mode with a separate whole-exam budget", () => {
		const document = compileOpenUISourceToSharedDocument(source(900), options);
		expect(validateUiDocument(document)).toBe(true);
		expect(document.nodes[0]).toMatchObject({ type: "quiz", mode: "exam", examTimeLimit: 900 });
        if (document.nodes[0]?.type !== "quiz") throw new Error("Expected quiz node");
        expect(document.nodes[0].questions).toHaveLength(20);
        expect(document.nodes[0].questions[0]?.timeLimit).toBe(45);
	});
	it("uses a 30-minute default and supports the positional source form", () => {
		expect(compileOpenUISourceToSharedDocument(source(), options).nodes[0]).toMatchObject({ mode: "exam", examTimeLimit: 1800 });
		const document = compileOpenUISourceToSharedDocument(`root = LearningSurface([test])\ntest = Exam("exam", "Numbers", ${JSON.stringify(questions)}, "resumable", 600)`, options);
		expect(document.nodes[0]).toMatchObject({ mode: "exam", examTimeLimit: 600 });
	});
	it("rejects invalid whole-exam budgets instead of silently resetting them", () => {
		for (const seconds of [0, -1, 1.5, 86_401, "900"]) expect(tryCompileOpenUISourceToSharedDocument(source(seconds), options).ok).toBe(false);
	});
	it("rejects authored and canonical exams below 20 without changing their questions", () => {
        for (const count of [0, 1, 19]) {
            const result = tryCompileOpenUISourceToSharedDocument(source(900, questions.slice(0, count)), options);
            expect(result).toMatchObject({ ok: false, kind: "invalid", message: "Exam requires at least 20 questions." });
        }
        const document = compileOpenUISourceToSharedDocument(source(), options);
        const exam = document.nodes[0];
        if (exam?.type !== "quiz") throw new Error("Expected quiz node");
        expect(validateUiDocument({ ...document, nodes: [{ ...exam, questions: exam.questions.slice(0, 19) }] })).toBe(false);
        expect(new Set(exam.questions.map((question) => question.prompt)).size).toBe(20);
        expect(exam.questions.map((question) => question.prompt)).toEqual(questions.map((question) => question.question));
    });
	it("keeps regular quiz timing semantics intact", () => {
		const document = compileOpenUISourceToSharedDocument(`root = LearningSurface([test])\ntest = Quiz("quiz", "Numbers", ${JSON.stringify(questions.slice(0, 1))}, "resumable", 75)`, options);
		expect(document.nodes[0]).toMatchObject({ type: "quiz", timeLimit: 75 });
		expect(document.nodes[0]).not.toHaveProperty("mode");
		expect(document.nodes[0]).not.toHaveProperty("examTimeLimit");
	});
	it("round-trips exact timings and whole-exam timeout through the existing action contract", () => {
		const action = { schemaVersion: 1, type: "complete-quiz", documentId: "exam-test", documentRevision: 0, nodeId: "exam", resultId: "exam-result", answers: [], score: 0, partialCreditPoints: 0, partialCredits: {}, timing: { totalMs: 4_238, perQuestionMs: { one: 3_179 } }, flaggedQuestionIds: [], pendingGradeQuestionIds: [], skippedQuestionIds: ["one"], timedOutQuestionIds: ["one"], examTimedOut: true, idempotencyKey: "exam-completion" };
		expect(validateUiAction(JSON.parse(JSON.stringify(action)))).toBe(true);
		expect(validateUiAction({ ...action, examTimedOut: "true" })).toBe(false);
	});
});

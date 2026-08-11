import { beforeEach, describe, expect, test } from "bun:test";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { UiActionReplayConflictError, type UiAction, type UiDocument } from "@keating/learner-contracts";

import { KeatingStorage } from "../keating/storage";

const AT = "2026-08-11T00:00:00.000Z";
const NEXT = "2026-08-11T00:00:01.000Z";

beforeEach(() => {
	(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});

function sourceDocument(): UiDocument {
	return {
		schemaVersion: 1,
		id: "openui-record-document",
		revision: 0,
		lifecycle: "ready",
		supportedSurfaces: ["web"],
		title: "Atomic learner records",
		nodes: [
			{ type: "question", id: "question-1", kind: "short_answer", prompt: "Why is the transaction atomic?", correctAnswer: "Because it commits together." },
			{
				type: "question-group",
				id: "group-1",
				title: "Atomic form",
				topic: "databases",
				questions: [
					{ id: "group-text-1", kind: "short_answer", prompt: "What does atomic mean?", correctAnswer: "all or nothing" },
					{ id: "group-choice-1", kind: "choice", prompt: "Which property applies?", choices: [{ id: "choice-atomic", label: "Atomic" }, { id: "choice-eventual", label: "Eventual" }], correctAnswers: ["choice-atomic"], allowText: true },
					{ id: "group-choice-2", kind: "choice", prompt: "Explain another property.", choices: [{ id: "choice-durable", label: "Durable" }], allowText: true },
				],
			},
			{
				type: "quiz",
				id: "quiz-1",
				title: "Transaction quiz",
				questions: [
					{ id: "quiz-question-1", kind: "short_answer", prompt: "What commits together?", correctAnswer: "all changes" },
					{ id: "quiz-question-2", kind: "short_answer", prompt: "What does a rollback prevent?", correctAnswer: "partial state" },
				],
			},
			{ type: "goal", id: "goal-1", title: "Understand records", status: "active", steps: [{ id: "step-1", title: "Explain atomicity", status: "not_started" }] },
			{ type: "study-plan", id: "plan-1", title: "Durable plan", items: [{ id: "plan-step-1", title: "Write records", status: "not_started" }] },
			{ type: "notes", id: "notes-1", title: "Notes", value: "draft" },
			{ type: "artifact", id: "artifact-1", resource: { id: "artifact-resource-1", title: "Evidence", format: "markdown", content: "proof" } },
			{ type: "deck", id: "deck-1", title: "Transaction cards", topic: "databases", cards: [{ id: "card-1", front: "What is atomicity?", back: "All or nothing." }, { id: "card-2", front: "What is rollback?", back: "Undo partial work." }] },
			{ type: "handoff", id: "handoff-1", target: "desktop", reason: "Continue there", context: "Keep this record." },
		],
		createdAt: AT,
		updatedAt: AT,
	};
}

function action<T extends UiAction["type"]>(type: T, values: Omit<Extract<UiAction, { type: T }>, "schemaVersion" | "type" | "documentId" | "documentRevision">): Extract<UiAction, { type: T }> {
	return {
		schemaVersion: 1,
		type,
		documentId: "openui-record-document",
		documentRevision: 0,
		...values,
	} as Extract<UiAction, { type: T }>;
}

describe("canonical OpenUI learner-record materialization", () => {
	test("replays the exact action without duplicate learner records", async () => {
		const storage = new KeatingStorage();
		const source = sourceDocument();
		const submitted = action("submit-answer", {
			nodeId: "question-1",
			answer: "Because it commits together.",
			idempotencyKey: "question-submit-1",
		});

		const first = await storage.materializeCanonicalOpenUiAction(submitted, source, NEXT);
		const replay = await storage.materializeCanonicalOpenUiAction(submitted, source, "2026-08-11T00:00:02.000Z");

		expect(first.replayed).toBe(false);
		expect(replay.replayed).toBe(true);
		expect(replay.receipt).toEqual(first.receipt);
		const checks = await storage.getQuestionChecks();
		expect(checks).toHaveLength(1);
		expect(checks[0]).toMatchObject({ grading: "auto", score: 1, answer: "Because it commits together." });
	});

	test("rejects an idempotency-key reuse with a different fingerprint", async () => {
		const storage = new KeatingStorage();
		const source = sourceDocument();
		await storage.materializeCanonicalOpenUiAction(action("submit-answer", {
			nodeId: "question-1",
			answer: "Because it commits together.",
			idempotencyKey: "reused-key",
		}), source, NEXT);

		await expect(storage.materializeCanonicalOpenUiAction(action("submit-answer", {
			nodeId: "question-1",
			answer: "A conflicting answer.",
			idempotencyKey: "reused-key",
		}), source, "2026-08-11T00:00:02.000Z")).rejects.toBeInstanceOf(UiActionReplayConflictError);
		expect(await storage.getQuestionChecks()).toHaveLength(1);
	});

	test("materializes grouped responses and aggregate quiz records once", async () => {
		const storage = new KeatingStorage();
		const source = sourceDocument();
		await storage.materializeCanonicalOpenUiAction(action("submit-question-group", {
			nodeId: "group-1",
			responses: [
				{ questionId: "group-text-1", type: "text", answer: "all or nothing" },
				{ questionId: "group-choice-1", type: "choice", optionIds: ["choice-atomic"], text: "Every write is included." },
				{ questionId: "group-choice-2", type: "choice", optionIds: [], text: "It survives a crash." },
			],
			idempotencyKey: "group-submit-1",
		}), source, NEXT);
		const quiz = action("complete-quiz", {
			nodeId: "quiz-1",
			resultId: "quiz-result-1",
			answers: [{ questionId: "quiz-question-1", answer: "all changes" }, { questionId: "quiz-question-2", answer: "rollback avoids half-written state" }],
			score: 1,
			partialCreditPoints: 1.5,
			partialCredits: { "quiz-question-1": 1, "quiz-question-2": 0.5 },
			timing: { totalMs: 1_200, perQuestionMs: { "quiz-question-1": 600, "quiz-question-2": 600 } },
			flaggedQuestionIds: ["quiz-question-2"],
			pendingGradeQuestionIds: [],
			skippedQuestionIds: [],
			idempotencyKey: "quiz-complete-1",
		});
		const firstQuiz = await storage.materializeCanonicalOpenUiAction(quiz, source, NEXT);
		const replayQuiz = await storage.materializeCanonicalOpenUiAction(quiz, source, "2026-08-11T00:00:02.000Z");
		await expect(storage.materializeCanonicalOpenUiAction({
			...quiz,
			answers: [{ questionId: "quiz-question-1", answer: "a conflicting answer" }, { questionId: "quiz-question-2", answer: "rollback avoids half-written state" }],
		}, source, "2026-08-11T00:00:03.000Z")).rejects.toBeInstanceOf(UiActionReplayConflictError);

		expect(replayQuiz.replayed).toBe(true);
		expect(replayQuiz.receipt).toEqual(firstQuiz.receipt);
		const checks = await storage.getQuestionChecks();
		expect(checks).toHaveLength(5);
		expect(checks.find((check) => check.question === "Which property applies?")).toMatchObject({
			topic: "databases", answer: "Atomic\nEvery write is included.", grading: "auto", score: 1,
		});
		expect(checks.find((check) => check.question === "What commits together?")).toMatchObject({ topic: "Transaction quiz", score: 1, grading: "auto" });
		expect(checks.find((check) => check.question === "What does a rollback prevent?")).toMatchObject({ score: 0.5, grading: "auto" });
		expect(checks.find((check) => check.question === "Explain another property.")).toMatchObject({ answer: "It survives a crash." });
	});

	test("materializes source-reported aggregate deck outcomes atomically", async () => {
		const storage = new KeatingStorage();
		const source = sourceDocument();
		const completed = action("complete-deck", {
			nodeId: "deck-1",
			ratings: [
				{ cardId: "card-1", rating: 2, appliedIntervalDays: 1, easeAfter: 2.5 },
				{ cardId: "card-2", rating: 0, appliedIntervalDays: 0, easeAfter: 2.3 },
			],
			summary: { reviewed: 2, lapses: 1 },
			idempotencyKey: "deck-complete-1",
		});
		const first = await storage.materializeCanonicalOpenUiAction(completed, source, NEXT);
		const replay = await storage.materializeCanonicalOpenUiAction(completed, source, "2026-08-11T00:00:02.000Z");

		expect(replay.replayed).toBe(true);
		expect(replay.receipt).toEqual(first.receipt);
		const [deck] = await storage.getDecks();
		expect(deck?.cards).toMatchObject([
			{ id: "card-1", srs: { intervalDays: 1, ease: 2.5, lastRating: 2 } },
			{ id: "card-2", srs: { intervalDays: 0, ease: 2.3, lastRating: 0 } },
		]);
		const reviews = await storage.getCardReviews();
		expect(reviews).toHaveLength(2);
		expect(reviews).toMatchObject([
			{ cardId: "card-1", appliedIntervalDays: 1, easeAfter: 2.5, isLapse: false },
			{ cardId: "card-2", appliedIntervalDays: 0, easeAfter: 2.3, isLapse: true },
		]);
	});

	test("projects plans and goals while keeping retry and handoff receipt-only", async () => {
		const storage = new KeatingStorage();
		const source = sourceDocument();
		await storage.materializeCanonicalOpenUiAction(action("complete-goal-step", {
			nodeId: "goal-1",
			stepId: "step-1",
			idempotencyKey: "goal-step-1",
		}), source, NEXT);
		await storage.materializeCanonicalOpenUiAction(action("complete-plan-item", {
			nodeId: "plan-1",
			itemId: "plan-step-1",
			completed: true,
			idempotencyKey: "plan-step-1",
		}), source, NEXT);
		await storage.materializeCanonicalOpenUiAction(action("update-notes", {
			nodeId: "notes-1",
			value: "saved note",
			idempotencyKey: "notes-save-1",
		}), source, NEXT);
		await storage.materializeCanonicalOpenUiAction(action("save-artifact", {
			nodeId: "artifact-1",
			idempotencyKey: "artifact-save-1",
		}), source, NEXT);

		const [goal] = await storage.getGoals();
		expect(goal).toMatchObject({ status: "completed", steps: [{ id: "step-1", status: "done" }] });
		const [plan] = await storage.getLessonPlans();
		expect(plan).toMatchObject({ id: "openui:lesson-plan:openui-record-document:projection" });
		expect(plan?.content).toContain("## Evidence");

		const failed = { ...source, id: "retry-document", lifecycle: "failed" as const };
		const retry = await storage.materializeCanonicalOpenUiAction({
			schemaVersion: 1,
			type: "retry",
			documentId: failed.id,
			documentRevision: 0,
			idempotencyKey: "retry-once",
		}, failed, NEXT);
		const handoff = await storage.materializeCanonicalOpenUiAction(action("open-handoff", {
			nodeId: "handoff-1",
			idempotencyKey: "handoff-once",
		}), source, NEXT);
		expect(retry.result.resultingDocument?.lifecycle).toBe("ready");
		expect(handoff.replayed).toBe(false);
		expect(await storage.getDecks()).toHaveLength(0);
		expect(await storage.getCardReviews()).toHaveLength(0);
	});

	test("aborts aggregate deck and review writes together when a review write fails", async () => {
		const storage = new KeatingStorage();
		const source = sourceDocument();
		const originalPut = IDBObjectStore.prototype.put;
		IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey): IDBRequest<IDBValidKey> {
			if (this.name === "card-reviews") throw new Error("injected review failure");
			return originalPut.call(this, value, key);
		};
		try {
			await expect(storage.materializeCanonicalOpenUiAction(action("complete-deck", {
				nodeId: "deck-1",
				ratings: [
					{ cardId: "card-1", rating: 2, appliedIntervalDays: 1, easeAfter: 2.5 },
					{ cardId: "card-2", rating: 0, appliedIntervalDays: 0, easeAfter: 2.3 },
				],
				summary: { reviewed: 2, lapses: 1 },
				idempotencyKey: "deck-failure-1",
			}), source, NEXT)).rejects.toThrow("injected review failure");
		} finally {
			IDBObjectStore.prototype.put = originalPut;
		}
		expect(await storage.getDecks()).toHaveLength(0);
		expect(await storage.getCardReviews()).toHaveLength(0);

		const retry = await storage.materializeCanonicalOpenUiAction(action("complete-deck", {
			nodeId: "deck-1",
			ratings: [
				{ cardId: "card-1", rating: 2, appliedIntervalDays: 1, easeAfter: 2.5 },
				{ cardId: "card-2", rating: 0, appliedIntervalDays: 0, easeAfter: 2.3 },
			],
			summary: { reviewed: 2, lapses: 1 },
			idempotencyKey: "deck-failure-1",
		}), source, NEXT);
		expect(retry.replayed).toBe(false);
		expect(await storage.getDecks()).toHaveLength(1);
		expect(await storage.getCardReviews()).toHaveLength(2);
	});
});

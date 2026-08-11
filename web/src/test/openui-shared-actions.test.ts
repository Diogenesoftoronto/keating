import { describe, expect, test } from "bun:test";
import {
	validateUiActionAgainstDocument,
	validateUiActionJournal,
	validateUiActionReceipt,
	validateUiActionResult,
	type UiDocument,
} from "@keating/learner-contracts";
import {
	acknowledgeSharedUiActionDelivery,
	dispatchSharedUiAction,
	loadSharedUiActionState,
	sharedUiActionStateKey,
} from "../keating/openui/shared-actions";

const AT = "2026-08-11T00:00:00.000Z";

class MemoryStorage {
	readonly data = new Map<string, string>();
	writes = 0;
	getItem(key: string) { return this.data.get(key) ?? null; }
	setItem(key: string, value: string) {
		this.writes += 1;
		this.data.set(key, value);
	}
}

function sourceDocument(): UiDocument {
	return {
		schemaVersion: 1,
		id: "message-1-openui-document",
		revision: 0,
		lifecycle: "ready",
		supportedSurfaces: ["web"],
		title: "Durable interaction",
		nodes: [
			{ type: "question", id: "question-1", kind: "short_answer", prompt: "Why?" },
			{ type: "question-group", id: "question-group-1", topic: "Bayes", intro: "Answer together.", questions: [
				{ id: "group-choice", kind: "choice", prompt: "Choose and explain.", choices: [{ id: "evidence", label: "Evidence" }, { id: "style", label: "Style" }], allowText: true },
				{ id: "group-text", kind: "text", prompt: "Why?" },
			] },
			{ type: "quiz", id: "quiz-1", title: "Quiz", questions: [
				{ id: "quiz-question-1", kind: "short_answer", prompt: "Name the updated belief.", correctAnswer: "posterior" },
			] },
			{ type: "deck", id: "deck-1", title: "Cards", topic: "Bayes", cards: [
				{ id: "card-1", front: "Prior?", back: "Before evidence" },
			] },
			{ type: "goal", id: "goal-1", title: "Learn", status: "active", steps: [{ id: "step-1", title: "Explain it", status: "not_started" }] },
			{ type: "notes", id: "notes-1", title: "Notes", value: "draft" },
		],
		createdAt: AT,
		updatedAt: AT,
	};
}

describe("durable shared web OpenUI actions", () => {
	test("commits a contract-valid document and receipt with one storage write", () => {
		const storage = new MemoryStorage();
		const source = sourceDocument();
		const dispatched = dispatchSharedUiAction(
			storage,
			source,
			{ type: "submit-answer", nodeId: "question-1", answer: "Because evidence changed." },
			"2026-08-11T00:00:01.000Z",
		);

		expect(storage.writes).toBe(1);
		expect(dispatched.replayed).toBe(false);
		expect(dispatched.document.revision).toBe(1);
		expect(validateUiActionAgainstDocument(dispatched.action, source)).toBe(true);
		expect(validateUiActionResult(dispatched.result)).toBe(true);
		expect(validateUiActionReceipt(dispatched.receipt)).toBe(true);
		expect(validateUiActionJournal(dispatched.journal)).toBe(true);
		expect(JSON.parse(storage.data.get(sharedUiActionStateKey(source.id)) ?? "null")).toMatchObject({
			version: 1,
			document: { revision: 1 },
			journal: { receipts: [{ state: "completed" }] },
		});
	});

	test("commits and exactly replays grouped, quiz, and deck aggregate receipts", () => {
		const source = sourceDocument();
		const cases = [
			{
				intent: {
					type: "submit-question-group" as const,
					nodeId: "question-group-1",
					responses: [
						{ questionId: "group-choice", type: "choice" as const, optionIds: ["evidence"], text: "It changes the likelihood." },
						{ questionId: "group-text", type: "text" as const, answer: "The evidence updates belief." },
					],
				},
			},
			{
				intent: {
					type: "complete-quiz" as const,
					nodeId: "quiz-1",
					resultId: "quiz-result-1",
					answers: [{ questionId: "quiz-question-1", answer: "posterior" }],
					score: 1,
					partialCreditPoints: 0,
					partialCredits: { "quiz-question-1": 1 },
					timing: { totalMs: 1_200, perQuestionMs: { "quiz-question-1": 1_200 } },
					flaggedQuestionIds: [],
					pendingGradeQuestionIds: [],
					skippedQuestionIds: [],
				},
			},
			{
				intent: {
					type: "complete-deck" as const,
					nodeId: "deck-1",
					ratings: [{ cardId: "card-1", rating: 2 as const, appliedIntervalDays: 1, easeAfter: 2.5 }],
					summary: { reviewed: 1, lapses: 0 },
				},
			},
		];

		for (const { intent } of cases) {
			const storage = new MemoryStorage();
			const first = dispatchSharedUiAction(storage, source, intent, "2026-08-11T00:00:01.000Z");
			const replay = dispatchSharedUiAction(storage, source, intent, "2026-08-11T00:00:02.000Z");
			expect(first.receipt.state).toBe("completed");
			expect(first.document.revision).toBe(1);
			expect(replay.replayed).toBe(true);
			expect(replay.receipt).toEqual(first.receipt);
			expect(storage.writes).toBe(1);
		}
	});

	test("replays an identical stale-renderer retry without another effect or write", () => {
		const storage = new MemoryStorage();
		const source = sourceDocument();
		const intent = { type: "submit-answer" as const, nodeId: "question-1", answer: "Because evidence changed." };
		const first = dispatchSharedUiAction(storage, source, intent, "2026-08-11T00:00:01.000Z");
		const replay = dispatchSharedUiAction(storage, source, intent, "2026-08-11T00:00:02.000Z");

		expect(replay.replayed).toBe(true);
		expect(replay.action.idempotencyKey).toBe(first.action.idempotencyKey);
		expect(replay.receipt).toEqual(first.receipt);
		expect(storage.writes).toBe(1);
	});

	test("commits host delivery with the receipt and reopens it until acknowledged", () => {
		const storage = new MemoryStorage();
		const source = sourceDocument();
		const dispatched = dispatchSharedUiAction(
			storage,
			source,
			{ type: "submit-answer", nodeId: "question-1", answer: "Durable answer." },
			"2026-08-11T00:00:01.000Z",
			{ sessionId: "session-1", humanFriendlyMessage: "Answered the question" },
		);
		const delivery = dispatched.deliveries[0];

		expect(storage.writes).toBe(1);
		expect(delivery).toMatchObject({ sessionId: "session-1", state: "pending", sourceDocument: { revision: 0 } });
		expect(loadSharedUiActionState(storage, source).deliveries[0]).toEqual(delivery);
		expect(acknowledgeSharedUiActionDelivery(storage, source, delivery!.id, "2026-08-11T00:00:02.000Z")).toBe(true);
		expect(loadSharedUiActionState(storage, source).deliveries[0]).toMatchObject({
			state: "acknowledged",
			acknowledgedAt: "2026-08-11T00:00:02.000Z",
		});
		expect(acknowledgeSharedUiActionDelivery(storage, source, delivery!.id)).toBe(false);
		expect(storage.writes).toBe(2);
	});

	test("chains later actions from the restored revision and rehydrates their mutations", () => {
		const storage = new MemoryStorage();
		const source = sourceDocument();
		const goal = dispatchSharedUiAction(
			storage,
			source,
			{ type: "complete-goal-step", nodeId: "goal-1", stepId: "step-1" },
			"2026-08-11T00:00:01.000Z",
		);
		const notes = dispatchSharedUiAction(
			storage,
			goal.document,
			{ type: "update-notes", nodeId: "notes-1", value: "saved" },
			"2026-08-11T00:00:02.000Z",
		);
		const restored = loadSharedUiActionState(storage, source);

		expect(notes.document.revision).toBe(2);
		expect(restored.document.revision).toBe(2);
		expect(restored.journal.receipts).toHaveLength(2);
		expect(restored.document.nodes.find((node) => node.id === "goal-1")).toMatchObject({
			status: "completed",
			steps: [{ status: "done" }],
		});
		expect(restored.document.nodes.find((node) => node.id === "notes-1")).toMatchObject({ value: "saved" });
	});

	test("does not expose a success state when the atomic storage write fails", () => {
		const source = sourceDocument();
		const storage = {
			getItem: () => null,
			setItem: () => { throw new Error("quota unavailable"); },
		};
		expect(() => dispatchSharedUiAction(
			storage,
			source,
			{ type: "submit-answer", nodeId: "question-1", answer: "kept in the form" },
			"2026-08-11T00:00:01.000Z",
		)).toThrow("quota unavailable");
		expect(loadSharedUiActionState(storage, source).document).toEqual(source);
	});

	test("migrates a completed legacy journal to a session-scoped document id", () => {
		const storage = new MemoryStorage();
		const legacy = sourceDocument();
		dispatchSharedUiAction(
			storage,
			legacy,
			{ type: "submit-answer", nodeId: "question-1", answer: "Keep my answer." },
			"2026-08-11T00:00:01.000Z",
		);
		const scoped = { ...legacy, id: "session-1-message-1-openui-document" };
		const restored = loadSharedUiActionState(storage, scoped, [legacy.id]);

		expect(restored.document).toMatchObject({ id: scoped.id, revision: 1 });
		expect(restored.journal.documentId).toBe(scoped.id);
		expect(restored.journal.receipts).toHaveLength(1);
		expect(restored.journal.receipts[0]?.action.documentId).toBe(scoped.id);
		expect(restored.journal.receipts[0]?.result?.documentId).toBe(scoped.id);
		expect(validateUiActionReceipt(restored.journal.receipts[0])).toBe(true);
		expect(storage.data.has(sharedUiActionStateKey(scoped.id))).toBe(true);

		const replay = dispatchSharedUiAction(
			storage,
			scoped,
			{ type: "submit-answer", nodeId: "question-1", answer: "Keep my answer." },
			"2026-08-11T00:00:02.000Z",
		);
		expect(replay.replayed).toBe(true);
		expect(storage.writes).toBe(2);
	});
});

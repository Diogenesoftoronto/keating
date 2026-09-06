import { beforeEach, describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import type { UiDocument } from "@keating/learner-contracts";
import { createOpenUIActionLearnerResponse, learnerResponseReviewText, parseLearnerResponse, serializeLearnerResponse } from "../keating/learner-response";
import { dispatchSharedUiAction, loadSharedUiActionState, type SharedUiActionIntent } from "../keating/openui/shared-actions";
import { KeatingStorage } from "../keating/storage";

const at = "2026-09-06T12:00:00.000Z";
const document: UiDocument = {
	schemaVersion: 1, id: "language-practice-roundtrip", revision: 0, lifecycle: "ready", supportedSurfaces: ["web"], createdAt: at, updatedAt: at,
	nodes: [{ type: "language-practice", id: "greetings", title: "First words", language: "Spanish", rounds: [
		{ id: "translate", kind: "translation", prompt: "Translate", text: "Hola", acceptedAnswers: ["Hello"] },
		{ id: "speak", kind: "pronunciation", prompt: "Say it aloud", text: "Hola" },
	] }],
};
const intent: Extract<SharedUiActionIntent, { type: "complete-language-practice" }> = {
	type: "complete-language-practice", nodeId: "greetings",
	rounds: [
		{ roundId: "translate", outcome: "correct", attempts: 1, timeMs: 1457, answer: "Hello" },
		{ roundId: "speak", outcome: "practiced", attempts: 1, timeMs: 2000 },
	],
	correct: 1, objectiveTotal: 1, pronunciationPracticed: 1, totalMs: 3457,
};
function localStorageFixture() {
	const values = new Map<string, string>();
	return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

beforeEach(() => { (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory(); });

describe("language practice completion", () => {
	test("restores exact round timings and answers, and replays without duplicate completion", () => {
		const storage = localStorageFixture();
		const first = dispatchSharedUiAction(storage, document, intent, at);
		const restored = loadSharedUiActionState(storage, document);
		expect(restored.journal.receipts[0]?.action).toEqual(first.action);
		expect(restored.journal.receipts[0]?.action).toMatchObject({ rounds: intent.rounds, totalMs: 3457 });
		const replay = dispatchSharedUiAction(storage, document, intent, at);
		expect(replay.replayed).toBe(true);
		expect(replay.journal.receipts).toHaveLength(1);
	});

	test("materializes a durable receipt without turning pronunciation practice into a quiz grade", async () => {
		const dispatched = dispatchSharedUiAction(localStorageFixture(), document, intent, at);
		const first = await new KeatingStorage().materializeCanonicalOpenUiAction(dispatched.action, document, at);
		const restored = await new KeatingStorage().materializeCanonicalOpenUiAction(dispatched.action, document, at);
		expect(first.receipt.action).toEqual(dispatched.action);
		expect(restored.replayed).toBe(true);
		expect(await new KeatingStorage().getQuizResults()).toEqual([]);
	});

	test("retains the complete learner evidence while making the limits of pronunciation feedback explicit", () => {
		const dispatched = dispatchSharedUiAction(localStorageFixture(), document, intent, at);
		const response = createOpenUIActionLearnerResponse({
			kind: "canonical", type: "complete-language-practice", humanFriendlyMessage: "Finished First words.", params: { ...intent },
			document: { id: document.id, revision: 0, lifecycle: "resumable" }, action: dispatched.action, sourceDocument: document, receipt: dispatched.receipt,
		}, { id: "language-evidence", submittedAt: at });
		const serialized = serializeLearnerResponse(response);
		if (response.kind !== "openui-action") throw new Error("Expected language action evidence");
		expect(parseLearnerResponse(serialized)).toEqual(response);
		expect(learnerResponseReviewText(serialized)).toContain("Time: 3.457s");
		expect(learnerResponseReviewText(serialized)).toContain("Pronunciation: 1 practiced · self-reviewed");
		expect(response.agentInstruction).toContain("pronunciation accuracy was not assessed");
		expect(response.payload.params.rounds).toEqual(intent.rounds);
	});
});

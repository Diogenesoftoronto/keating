import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { UiDocument } from "@keating/learner-contracts";
import { retryableAggregateAttempt, SharedUiDocumentRenderer } from "../keating/openui/shared-renderer";
import { dispatchSharedUiAction } from "../keating/openui/shared-actions";

const AT = "2026-08-10T00:00:00.000Z";

function document(lifecycle: UiDocument["lifecycle"]): UiDocument {
	return {
		schemaVersion: 1,
		id: "scoped-document",
		revision: 2,
		lifecycle,
		supportedSurfaces: ["web"],
		nodes: [{ type: "question", id: "matching-question", kind: "matching", prompt: "Match the terms.", items: ["prior", "posterior"], choices: [{ id: "before", label: "Before" }, { id: "after", label: "After" }], uniqueMatches: true }],
		createdAt: AT,
		updatedAt: AT,
	};
}

describe("shared web OpenUI renderer", () => {
	test("renders a ready matching interaction with semantic identity", () => {
		const html = renderToStaticMarkup(<SharedUiDocumentRenderer document={document("ready")} />);
		expect(html).toContain('data-shared-openui-document="scoped-document"');
		expect(html).toContain('data-question-kind="matching"');
		expect(html).not.toContain("<select disabled");
	});

	test("keeps failed content visible while disabling its controls", () => {
		const html = renderToStaticMarkup(<SharedUiDocumentRenderer document={document("failed")} />);
		expect(html).toContain("This interaction is failed");
		expect(html).toContain("disabled");
		expect(html).toContain("Match the terms.");
	});

	test("restores the exact submitted answer from a completed receipt", () => {
		const source: UiDocument = {
			...document("ready"),
			nodes: [{ type: "question", id: "answer-question", kind: "short_answer", prompt: "Explain the update." }],
		};
		const storage = new Map<string, string>();
		const dispatched = dispatchSharedUiAction({
			getItem: (key) => storage.get(key) ?? null,
			setItem: (key, value) => storage.set(key, value),
		}, source, { type: "submit-answer", nodeId: "answer-question", answer: "Evidence changes the posterior." }, "2026-08-10T00:00:01.000Z");
		const html = renderToStaticMarkup(<SharedUiDocumentRenderer document={dispatched.document} receipts={dispatched.journal.receipts} />);

		expect(html).toContain("Evidence changes the posterior.");
		expect(html).toContain("Answer saved.");
	});

	test("renders an explicit recovery state for an unavailable fixture image", () => {
		const source: UiDocument = {
			...document("ready"),
			nodes: [{ type: "image", id: "image-1", alt: "Bayes diagram", resource: { id: "image-resource", title: "Bayes image", format: "uri", uri: "https://assets.example.invalid/bayes.png" } }],
		};
		const html = renderToStaticMarkup(<SharedUiDocumentRenderer document={source} />);
		expect(html).toContain("This image resource is unavailable here");
		expect(html).not.toContain("<img");
	});

	test("offers and restores canonical artifact and handoff actions", () => {
		const source: UiDocument = {
			...document("ready"),
			nodes: [
				{ type: "artifact", id: "artifact-1", resource: { id: "resource-1", title: "Bayes note", format: "markdown", content: "# Bayes" } },
				{ type: "handoff", id: "handoff-1", target: "web", reason: "Continue in the workspace", context: "Keep the current lesson." },
			],
		};
		const storage = new Map<string, string>();
		const adapter = {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => storage.set(key, value),
		};
		const initial = renderToStaticMarkup(<SharedUiDocumentRenderer document={source} />);
		expect(initial).toContain("Save artifact");
		expect(initial).toContain("Open Keating web");

		const saved = dispatchSharedUiAction(adapter, source, { type: "save-artifact", nodeId: "artifact-1" }, "2026-08-10T00:00:01.000Z");
		const handedOff = dispatchSharedUiAction(adapter, saved.document, { type: "open-handoff", nodeId: "handoff-1" }, "2026-08-10T00:00:02.000Z");
		const restored = renderToStaticMarkup(<SharedUiDocumentRenderer document={handedOff.document} receipts={handedOff.journal.receipts} />);
		expect(restored).toContain("Saved to artifacts.");
		expect(restored).toContain("Handoff recorded.");
	});

	test("restores one grouped submission with stable option ids and no per-question submit controls", () => {
		const source: UiDocument = {
			...document("ready"),
			nodes: [{ type: "question-group", id: "group-1", topic: "Bayes", questions: [
				{ id: "choose-1", kind: "choice", prompt: "Pick evidence.", allowText: true, choices: [{ id: "evidence", label: "Evidence" }, { id: "guess", label: "Guess" }] },
				{ id: "match-1", kind: "matching", prompt: "Match.", items: ["prior"], choices: [{ id: "before", label: "Before" }], requireReasons: true },
			] }],
		};
		const storage = new Map<string, string>();
		const adapter = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) };
		const dispatched = dispatchSharedUiAction(adapter, source, { type: "submit-question-group", nodeId: "group-1", responses: [
			{ questionId: "choose-1", type: "choice", optionIds: ["evidence"], text: "Because observations update beliefs." },
			{ questionId: "match-1", type: "rows", rows: [{ item: "prior", optionId: "before", reason: "It comes first." }] },
		] }, "2026-08-10T00:00:01.000Z");
		const html = renderToStaticMarkup(<SharedUiDocumentRenderer document={dispatched.document} receipts={dispatched.journal.receipts} />);

		expect(dispatched.journal.receipts).toHaveLength(1);
		expect(dispatched.action.type).toBe("submit-question-group");
		expect(html).toContain("Answers saved.");
		expect(html).toContain("Because observations update beliefs.");
		expect(html).not.toContain("Submit answer");
		expect(() => dispatchSharedUiAction(adapter, source, { type: "submit-question-group", nodeId: "group-1", responses: [
			{ questionId: "choose-1", type: "choice", optionIds: ["wrong-option"] },
			{ questionId: "match-1", type: "rows", rows: [{ item: "prior", optionId: "before", reason: "It comes first." }] },
		] })).toThrow();
	});

	test("restores one terminal quiz completion instead of per-question actions", () => {
		const source: UiDocument = {
			...document("ready"),
			nodes: [{ type: "quiz", id: "quiz-1", title: "Bayes quiz", questions: [
				{ id: "quiz-choice", kind: "multiple_choice", prompt: "Which comes first?", choices: [{ id: "prior", label: "Prior" }, { id: "posterior", label: "Posterior" }], correctAnswer: "prior", explanation: "The prior is the starting belief." },
				{ id: "quiz-open", kind: "short_answer", prompt: "Explain the update.", correctAnswer: "Evidence updates the prior.", explanation: "Use evidence." },
			] }],
		};
		const storage = new Map<string, string>();
		const adapter = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) };
		const dispatched = dispatchSharedUiAction(adapter, source, { type: "complete-quiz", nodeId: "quiz-1", resultId: "quiz-1-result", answers: [{ questionId: "quiz-choice", answer: "prior" }, { questionId: "quiz-open", answer: "Evidence updates the prior." }], score: 1, partialCreditPoints: 1, partialCredits: { "quiz-choice": 1 }, timing: { totalMs: 12, perQuestionMs: { "quiz-choice": 6, "quiz-open": 6 } }, flaggedQuestionIds: [], pendingGradeQuestionIds: ["quiz-open"], skippedQuestionIds: [] }, "2026-08-10T00:00:01.000Z");
		const html = renderToStaticMarkup(<SharedUiDocumentRenderer document={dispatched.document} receipts={dispatched.journal.receipts} />);

		expect(dispatched.journal.receipts).toHaveLength(1);
		expect(dispatched.action.type).toBe("complete-quiz");
		expect(html).toContain("Quiz saved.");
		expect(html).toContain("Evidence updates the prior.");
		expect(html).not.toContain("Submit answer");
	});

	test("restores a completed deck as terminal and does not expose a wrapping rating loop", () => {
		const source: UiDocument = {
			...document("ready"),
			nodes: [{ type: "deck", id: "deck-1", title: "Bayes cards", topic: "Bayes", cards: [{ id: "card-1", front: "Prior", back: "Starting belief" }, { id: "card-2", front: "Posterior", back: "Updated belief" }] }],
		};
		const storage = new Map<string, string>();
		const adapter = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) };
		const dispatched = dispatchSharedUiAction(adapter, source, { type: "complete-deck", nodeId: "deck-1", ratings: [{ cardId: "card-1", rating: 2, appliedIntervalDays: 1, easeAfter: 2.5 }, { cardId: "card-2", rating: 0, appliedIntervalDays: 0, easeAfter: 2.3 }], summary: { reviewed: 2, lapses: 1 } }, "2026-08-10T00:00:01.000Z");
		const html = renderToStaticMarkup(<SharedUiDocumentRenderer document={dispatched.document} receipts={dispatched.journal.receipts} />);

		expect(dispatched.journal.receipts).toHaveLength(1);
		expect(dispatched.action.type).toBe("complete-deck");
		expect(html).toContain("Session complete. 2 cards reviewed.");
		expect(html).not.toContain("Again");
	});

	test("keeps an aggregate completion byte-identical after a failed host delivery", () => {
		const intent = { type: "complete-deck" as const, nodeId: "deck-1", ratings: [{ cardId: "card-1", rating: 2 as const, appliedIntervalDays: 1, easeAfter: 2.5 }], summary: { reviewed: 1, lapses: 0 } };
		const failed = retryableAggregateAttempt(undefined, () => intent, () => false);
		const retried = retryableAggregateAttempt(failed.pending, () => ({ ...intent, summary: { reviewed: 999, lapses: 999 } }), () => true);

		expect(failed.delivered).toBe(false);
		expect(failed.pending).toBe(intent);
		expect(retried.intent).toBe(intent);
		expect(retried.delivered).toBe(true);
		expect(retried.pending).toBeUndefined();
	});
});

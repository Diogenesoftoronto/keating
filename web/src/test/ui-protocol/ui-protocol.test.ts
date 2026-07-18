import { describe, expect, test } from "bun:test";
import {
	KEATING_UI_PROTOCOL,
	KEATING_UI_VERSION,
	actionTargetsDocument,
	decodeLegacyTagPayload,
	isJsonValue,
	isUiActionRequest,
	isUiDocument,
	legacyPayloadToUiDocument,
	legacyTagToUiDocument,
	resultCorrelatesToAction,
	type QuizDocument,
	type UiActionRequest,
	type UiActionResult,
} from "../../keating/ui-protocol";

const quiz: QuizDocument = {
	protocol: KEATING_UI_PROTOCOL,
	version: KEATING_UI_VERSION,
	id: "quiz-1",
	revision: 2,
	kind: "quiz",
	payload: {
		topic: "DNS",
		questions: [{ id: "q1", prompt: "What does DNS resolve?", type: "text" }],
	},
	actions: [{ id: "submit", kind: "submit", label: "Check answers" }],
};

describe("UI document validation", () => {
	test("accepts a versioned quiz and rejects stale/non-serializable shapes", () => {
		expect(isUiDocument(quiz)).toBe(true);
		expect(isUiDocument({ ...quiz, revision: -1 })).toBe(false);
		expect(isUiDocument({ ...quiz, payload: { topic: "DNS", questions: [], callback: () => {} } })).toBe(false);
	});

	test("supports every renderable document kind", () => {
		const payloads = {
			question: { fields: [] },
			goal: { goalId: "g1", title: "Ship", status: "active", steps: [] },
			deck: { deckId: "d1", topic: "DNS", title: "DNS cards", cards: [] },
			image: { title: "DNS", alt: "Resolution flow", url: "https://example.test/dns.png" },
			scene: { topic: "DNS", storyboard: "Resolver to root" },
			artifact: { uri: "artifact://plan/p1", label: "Plan" },
			generic: { format: "markdown", content: "Fallback" },
		} as const;
		for (const [kind, payload] of Object.entries(payloads)) {
			expect(isUiDocument({ ...quiz, id: kind, kind, payload })).toBe(true);
		}
	});

	test("JSON guard rejects cycles, special numbers, and prototype keys", () => {
		const cycle: Record<string, unknown> = {};
		cycle.self = cycle;
		expect(isJsonValue(cycle)).toBe(false);
		expect(isJsonValue({ score: Number.NaN })).toBe(false);
		expect(isJsonValue(JSON.parse('{"__proto__":{"polluted":true}}'))).toBe(false);
	});
});

describe("action correlation", () => {
	const request: UiActionRequest = {
		protocol: KEATING_UI_PROTOCOL,
		version: KEATING_UI_VERSION,
		id: "request-1",
		documentId: quiz.id,
		documentRevision: quiz.revision,
		actionId: "submit",
		createdAt: "2026-07-18T12:00:00.000Z",
		payload: { q1: "names to addresses" },
	};
	const result: UiActionResult = {
		protocol: KEATING_UI_PROTOCOL,
		version: KEATING_UI_VERSION,
		id: "result-1",
		actionRequestId: request.id,
		documentId: quiz.id,
		documentRevision: quiz.revision,
		status: "accepted",
		createdAt: "2026-07-18T12:00:01.000Z",
		resultingRevision: 3,
	};

	test("binds actions to an exact document revision", () => {
		expect(isUiActionRequest(request)).toBe(true);
		expect(actionTargetsDocument(request, quiz)).toBe(true);
		expect(actionTargetsDocument({ ...request, documentRevision: 1 }, quiz)).toBe(false);
		expect(resultCorrelatesToAction(result, request)).toBe(true);
		expect(resultCorrelatesToAction({ ...result, actionRequestId: "other" }, request)).toBe(false);
	});
});

describe("legacy adapters", () => {
	test("decodes current double-JSON payloads", () => {
		const payload = { topic: "DNS", questions: [] };
		const encoded = JSON.stringify(JSON.stringify(payload));
		expect(decodeLegacyTagPayload(encoded)).toEqual(payload);
		const tag = `<keating-quiz json=${encoded} />`;
		const document = legacyTagToUiDocument(tag, { id: "legacy-1" });
		expect(document?.kind).toBe("quiz");
		if (document?.kind !== "quiz") throw new Error("Expected a quiz document");
		expect(document.payload.topic).toBe("DNS");
		expect(isUiDocument(document)).toBe(true);
	});

	test("normalizes TUI/domain objects and preserves unknown tags as generic", () => {
		const goal = legacyPayloadToUiDocument("goal", { id: "g1", title: "Build", status: "active", steps: [] }, { id: "ui-g1", revision: 4 });
		expect(goal.kind).toBe("goal");
		expect(goal.revision).toBe(4);
		expect(isUiDocument(goal)).toBe(true);

		const fallback = legacyPayloadToUiDocument("future-widget", { value: 1 }, { id: "future-1" });
		expect(fallback.kind).toBe("generic");
		if (fallback.kind !== "generic") throw new Error("Expected a generic fallback document");
		expect(fallback.payload.originalKind).toBe("future-widget");
		expect(isUiDocument(fallback)).toBe(true);
	});
});

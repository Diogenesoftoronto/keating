import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { renderToStaticMarkup } from "react-dom/server";
import {
	questionResponse,
	type JudgementCaller,
	type JudgementOutcome,
	type JudgementRequest,
	type UiDocument,
	type UiQuestion,
} from "@keating/learner-contracts";
import {
	__resetChatAnswer,
	chatAnswerIntent,
	chatAnswerItem,
	chatAnswerLink,
	createTypedAnswerClassifier,
	mapChoiceAnswer,
	receiptIdOf,
	registerChatAnswerCard,
	rememberChatAnswer,
	routeTypedAnswer,
	typedAnswerRequest,
	type TypedAnswerClassifier,
} from "../keating/openui/chat-answer";
import { dispatchSharedUiAction, loadSharedUiActionState } from "../keating/openui/shared-actions";
import { KeatingOpenUIRenderer } from "../keating/openui/renderer";
import type { CanonicalKeatingOpenUIAction, KeatingOpenUIAction } from "../keating/openui/types";
import { createOpenUIActionLearnerResponse } from "../keating/learner-response";
import { KeatingStorage } from "../keating/storage";
import { LearnerResponseReview } from "../components/LearnerResponseReview";
import { NextQuestionChip } from "../components/chat/NextQuestionChip";
import { rememberNextQuestionSuggestion, resetNextQuestionSuggestions } from "../keating/judgement/next-question-suggestions";

const at = "2026-11-21T12:00:00.000Z";
const SESSION = "s-chat-answer";
const textQuestion: UiQuestion = { id: "vapor", kind: "short_answer", prompt: "What is it called when liquid water turns into water vapor?" };
const choiceQuestion: UiQuestion = {
	id: "phase", kind: "choice", prompt: "Which process turns liquid water into vapor?",
	choices: [{ id: "cond", label: "Condensation" }, { id: "evap", label: "Evaporation" }, { id: "prec", label: "Precipitation" }],
	correctAnswer: "evap",
};
const doc = (id: string, nodes: UiDocument["nodes"]): UiDocument => ({
	schemaVersion: 1, id, revision: 0, lifecycle: "ready", retention: "workspace", supportedSurfaces: ["web"], createdAt: at, updatedAt: at, nodes,
});
const textGroup = doc("doc-text", [{ type: "question-group", id: "check", topic: "the water cycle", questions: [textQuestion] }]);
const choiceGroup = doc("doc-choice", [{ type: "question-group", id: "check", questions: [choiceQuestion] }]);
const loneChoice = doc("doc-lone", [{ type: "question", ...choiceQuestion }]);

class MemoryStorage {
	data = new Map<string, string>();
	getItem(key: string) { return this.data.get(key) ?? null; }
	setItem(key: string, value: string) { this.data.set(key, value); }
	removeItem(key: string) { this.data.delete(key); }
}

let previousWindow: PropertyDescriptor | undefined, previousStorage: PropertyDescriptor | undefined;
let storage: MemoryStorage;
beforeEach(() => {
	(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
	storage = new MemoryStorage();
	// The judge is off for record materialization; these tests supply their own classifier.
	storage.setItem("keating:judgement-model", JSON.stringify({ backend: "off" }));
	previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
	Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
	Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } } });
	__resetChatAnswer();
	resetNextQuestionSuggestions();
});
afterEach(() => {
	if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else Reflect.deleteProperty(globalThis, "window");
	if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage); else Reflect.deleteProperty(globalThis, "localStorage");
	__resetChatAnswer();
});

/* ------------------------------------------------------------------ */

describe("choice mapping", () => {
	test.each([
		["B", "evap"], ["b", "evap"], ["b)", "evap"], ["(B)", "evap"], ["option B", "evap"], ["B.", "evap"], ["I think B", "evap"],
		["Evaporation", "evap"], ["evaporation!", "evap"], ["  EVAPORATION ", "evap"], ["B) Evaporation", "evap"], ["it's evaporation", "evap"],
		["a", "cond"], ["C", "prec"],
	])("%p maps to %p", (typed, id) => expect(mapChoiceAnswer(choiceQuestion, typed)).toBe(id));

	test.each(["D", "B) Condensation", "evaporation or condensation", "what does vapor mean?", "hint please", "let me think", "", "evapor"])(
		"%p maps to nothing", (typed) => expect(mapChoiceAnswer(choiceQuestion, typed)).toBeNull());

	test("a one-letter label that names another option is ambiguous", () => {
		const question: UiQuestion = { id: "q", kind: "choice", prompt: "Pick", choices: [{ id: "x", label: "B" }, { id: "y", label: "Other" }] };
		expect(mapChoiceAnswer(question, "B")).toBeNull();
		expect(mapChoiceAnswer(question, "A")).toBe("x");
	});
});

describe("eligible cards and intents", () => {
	test("single text and single choice items are typeable; multi-item and structured cards are not", () => {
		expect(chatAnswerItem(textGroup, "check")).toMatchObject({ container: "question-group", nodeId: "check" });
		expect(chatAnswerItem(loneChoice, "phase")).toMatchObject({ container: "question", nodeId: "phase" });
		expect(chatAnswerItem(doc("two", [{ type: "question-group", id: "g", questions: [textQuestion, choiceQuestion] }]), "g")).toBeNull();
		expect(chatAnswerItem(doc("multi", [{ type: "question", ...choiceQuestion, multiSelect: true }]), "phase")).toBeNull();
		expect(chatAnswerItem(doc("order", [{ type: "question", id: "o", kind: "ordering", prompt: "Order", items: ["a", "b"] }]), "o")).toBeNull();
		expect(chatAnswerItem(doc("blank", [{ type: "question", id: "f", kind: "fill_in", prompt: "Water ___ into vapor" }]), "f")).toBeNull();
	});

	test("intents are exactly what the card's own controls dispatch", () => {
		const group = chatAnswerItem(textGroup, "check")!;
		// QuestionGroup's Finish check sends the Question's response value for each item.
		expect(chatAnswerIntent(group, " evaporation ")).toEqual({ type: "submit-question-group", nodeId: "check",
			responses: [questionResponse(textQuestion, "evaporation", [], [], [], [], [])] });
		expect(chatAnswerIntent(chatAnswerItem(choiceGroup, "check")!, "B")).toEqual({ type: "submit-question-group", nodeId: "check",
			responses: [questionResponse(choiceQuestion, "", ["evap"], [], [], [], [])] });
		expect(chatAnswerIntent(chatAnswerItem(loneChoice, "phase")!, "B")).toEqual({ type: "choose-option", nodeId: "phase", optionIds: ["evap"] });
		expect(chatAnswerIntent(chatAnswerItem(choiceGroup, "check")!, "maybe the second one?")).toBeNull();
	});
});

/* ------------------------------------------------------------------ */

const backend = { backend: "local" as const, model: "fixture", calibrationSha256: "0".repeat(64) };
function judged(choice: string, probability: number, confidence: number, complete = true): JudgementOutcome {
	const options = ["answered", "open", "unrelated", "uncertain"];
	const rest = (1 - probability) / 3;
	const probabilities = Object.fromEntries(options.filter((option) => complete || option !== "uncertain")
		.map((option) => [option, option === choice ? probability : rest]));
	return { ok: true, response: { backend, answers: { checkpoint_attempt_state: { type: "choice", choice, probabilities, confidence } } } } as unknown as JudgementOutcome;
}

describe("classifier gating", () => {
	const requests: JudgementRequest[] = [];
	const classifier = (outcome: JudgementOutcome | (() => never) | null) => createTypedAnswerClassifier(() => outcome === null ? null
		: (async (request) => { requests.push(request); return typeof outcome === "function" ? outcome() : outcome; }) as JudgementCaller);

	test("asks the reviewer's attempt-state question about the card and the typed message", () => {
		const request = typedAnswerRequest(choiceQuestion, "B");
		expect(Object.keys(request.questions)).toEqual(["checkpoint_attempt_state"]);
		expect(request.questions.checkpoint_attempt_state).toMatchObject({ type: "choice" });
		expect(Object.keys((request.questions.checkpoint_attempt_state as { criteria: object }).criteria)).toEqual(["answered", "open", "unrelated", "uncertain"]);
		expect(request.state).toEqual({ immediately_preceding_tutor_question: "Which process turns liquid water into vapor?\nA) Condensation\nB) Evaporation\nC) Precipitation", current_learner_message: "B" });
	});

	test("only a confident 'answered' counts", async () => {
		expect(await classifier(judged("answered", 0.9, 0.8))(textQuestion, "evaporation")).toBe(true);
		expect(await classifier(judged("answered", 0.6, 0.6))(textQuestion, "evaporation")).toBe(true);
		expect(await classifier(judged("answered", 0.55, 0.9))(textQuestion, "evaporation")).toBe(false);
		expect(await classifier(judged("answered", 0.9, 0.4))(textQuestion, "evaporation")).toBe(false);
		expect(await classifier(judged("open", 0.9, 0.9))(textQuestion, "let me think")).toBe(false);
		expect(await classifier(judged("unrelated", 0.9, 0.9))(textQuestion, "what does vapor mean?")).toBe(false);
		expect(await classifier(judged("uncertain", 0.9, 0.9))(textQuestion, "hmm")).toBe(false);
		expect(await classifier(judged("answered", 0.9, 0.9, false))(textQuestion, "evaporation")).toBe(false);
		expect(requests.length).toBeGreaterThan(0);
	});

	test("judge off, unavailable, timed out or throwing reads as ordinary chat", async () => {
		expect(await classifier(null)(textQuestion, "evaporation")).toBe(false);
		expect(await classifier({ ok: false, error: { code: "backend-unavailable", retryable: false } })(textQuestion, "evaporation")).toBe(false);
		expect(await classifier({ ok: false, error: { code: "backend-timeout", retryable: false } })(textQuestion, "evaporation")).toBe(false);
		expect(await classifier(() => { throw new Error("network"); })(textQuestion, "evaporation")).toBe(false);
	});
});

/* ------------------------------------------------------------------ */

function fakeCard(document: UiDocument) {
	const submitted: unknown[] = [];
	const release = registerChatAnswerCard({
		sessionId: SESSION, documentId: document.id,
		current: () => ({ document, receipts: [] }),
		submit: (intent, message, link) => { submitted.push({ intent, message, link }); return true; },
	});
	return { submitted, release };
}
const route = (text: string, classify: TypedAnswerClassifier, presented: { documentId: string; nodeId: string } | undefined = { documentId: textGroup.id, nodeId: "check" }) =>
	routeTypedAnswer({ sessionId: SESSION, text, messages: [], work: undefined, presentation: () => presented, classify });

describe("composer routing", () => {
	test("an answer goes through the card; anything else stays chat with the card open", async () => {
		const card = fakeCard(textGroup);
		const asked: string[] = [];
		const classify: TypedAnswerClassifier = async (_question, message) => { asked.push(message); return message === "evaporation"; };
		expect(await route("let me think", classify)).toBe("chat");
		expect(await route("hint please", classify)).toBe("chat");
		expect(card.submitted).toEqual([]);
		expect(await route("evaporation", classify)).toBe("submitted");
		expect(card.submitted).toEqual([{ intent: chatAnswerIntent(chatAnswerItem(textGroup, "check")!, "evaporation"),
			message: "Answered 1 questions about the water cycle", link: { nodeId: "check", label: "the quick check" } }]);
		expect(asked).toEqual(["let me think", "hint please", "evaporation"]);
		card.release();
	});

	test("no single awaiting card, no mounted card, or an unmappable choice never calls the judge", async () => {
		let calls = 0;
		const classify: TypedAnswerClassifier = async () => { calls += 1; return true; };
		expect(await route("evaporation", classify, undefined)).toBe("chat");
		expect(await route("evaporation", classify)).toBe("chat");
		const card = fakeCard(choiceGroup);
		expect(await route("the wet one", classify, { documentId: choiceGroup.id, nodeId: "check" })).toBe("chat");
		expect(calls).toBe(0);
		expect(await route("b)", classify, { documentId: choiceGroup.id, nodeId: "check" })).toBe("submitted");
		expect(card.submitted).toHaveLength(1);
		card.release();
	});
});

/* ------------------------------------------------------------------ */

async function materialize(action: CanonicalKeatingOpenUIAction) {
	const database = new KeatingStorage();
	await database.init();
	await database.materializeCanonicalOpenUiAction(action.action, action.sourceDocument, at);
	await database.waitForQuestionJudgements();
	return (await database.getQuestionChecks()).map(({ question, answer, grading, source }) => ({ question, answer, grading, nodeId: source?.nodeId }));
}

describe("a typed answer is a card submission", () => {
	test("same canonical action, same question check, linked both ways", async () => {
		// A mounted card's submit is its handleSharedAction: dispatch, record the chat link, deliver with origin.
		const actions: KeatingOpenUIAction[] = [];
		const metadata = { id: textGroup.id, lifecycle: "workspace" as const, revision: 0, sessionId: SESSION };
		const release = registerChatAnswerCard({
			sessionId: SESSION, documentId: textGroup.id,
			current: () => { const state = loadSharedUiActionState(storage, textGroup); return { document: state.document, receipts: state.journal.receipts }; },
			submit: (intent, humanFriendlyMessage, link) => {
				const dispatched = dispatchSharedUiAction(storage, textGroup, intent, at, { sessionId: SESSION, humanFriendlyMessage });
				rememberChatAnswer(receiptIdOf(dispatched), { ...link, sessionId: SESSION, documentId: textGroup.id, at: Date.now() });
				actions.push({ kind: "canonical", type: dispatched.action.type, humanFriendlyMessage, params: {}, document: metadata,
					action: dispatched.action, sourceDocument: dispatched.sourceDocument, receipt: dispatched.receipt,
					...(chatAnswerLink(receiptIdOf(dispatched)) ? { origin: "chat" as const } : {}) });
				return true;
			},
		});
		expect(await route("Evaporation", async () => true)).toBe("submitted");
		expect(actions).toHaveLength(1);
		const typed = actions[0] as CanonicalKeatingOpenUIAction;
		expect(typed.kind).toBe("canonical");
		expect(typed.origin).toBe("chat");

		// The card's own Finish check, dispatched on a clean device.
		const cardStorage = new MemoryStorage();
		const card = dispatchSharedUiAction(cardStorage, textGroup, { type: "submit-question-group", nodeId: "check",
			responses: [questionResponse(textQuestion, "Evaporation", [], [], [], [], [])] }, at, { sessionId: SESSION, humanFriendlyMessage: typed.humanFriendlyMessage });
		const strip = ({ idempotencyKey: _key, ...rest }: Record<string, unknown>) => rest;
		expect(strip(typed.action as unknown as Record<string, unknown>)).toEqual(strip(card.action as unknown as Record<string, unknown>));
		expect(typed.humanFriendlyMessage).toBe("Answered 1 questions about the water cycle");
		const cardAction: CanonicalKeatingOpenUIAction = { ...typed, origin: undefined, action: card.action, receipt: card.receipt, sourceDocument: card.sourceDocument };
		expect(await materialize(typed)).toEqual(await materialize(cardAction));
		expect(await materialize(typed)).toEqual([{ question: textQuestion.prompt, answer: "Evaporation", grading: "pending", nodeId: "check" }]);

		// The delivered learner message is the card's, marked as typed in chat.
		const typedResponse = createOpenUIActionLearnerResponse(typed, { id: "openui:typed", submittedAt: at });
		const cardResponse = createOpenUIActionLearnerResponse({ ...cardAction, origin: undefined }, { id: "openui:card", submittedAt: at });
		expect(typedResponse.review).toEqual(cardResponse.review);
		expect(typedResponse.origin).toBe("chat");
		expect(cardResponse.origin).toBeUndefined();
		expect(typedResponse.agentInstruction).toStartWith(cardResponse.agentInstruction!);
		expect(typedResponse.agentInstruction).toContain("typed this answer in the chat");

		// Card side: the answer shows as entered there, with a link down to the message.
		const receiptId = receiptIdOf(typed.receipt);
		expect(chatAnswerLink(receiptId)).toMatchObject({ sessionId: SESSION, documentId: textGroup.id, nodeId: "check" });
		const cardHtml = renderToStaticMarkup(<KeatingOpenUIRenderer document={textGroup} metadata={metadata} />);
		expect(cardHtml).toContain("Check complete");
		expect(cardHtml).toContain("Evaporation");
		expect(cardHtml).toContain("Answered in chat");
		expect(cardHtml).toContain(`data-chat-answer-link="${receiptId}"`);

		// Message side: the backlink points at the card.
		const messageHtml = renderToStaticMarkup(<LearnerResponseReview response={{ ...typedResponse, id: `openui:${receiptId}` }} />);
		expect(messageHtml).toContain(`data-learner-response-id="openui:${receiptId}"`);
		expect(messageHtml).toContain(`data-chat-answer-backlink="${textGroup.id}"`);
		expect(messageHtml).toContain("Answer to the quick check");
		expect(renderToStaticMarkup(<LearnerResponseReview response={cardResponse} />)).not.toContain("Answer to");

		// A second typed message no longer finds an open card.
		expect(await route("Evaporation, final answer", async () => true)).toBe("chat");
		release();
	});

	test("a card answered by its own control shows no chat link", async () => {
		const metadata = { id: loneChoice.id, lifecycle: "workspace" as const, revision: 0, sessionId: SESSION };
		dispatchSharedUiAction(storage, loneChoice, { type: "choose-option", nodeId: "phase", optionIds: ["evap"] }, at, { sessionId: SESSION, humanFriendlyMessage: "Answered" });
		const html = renderToStaticMarkup(<KeatingOpenUIRenderer document={loneChoice} metadata={metadata} />);
		expect(html).toContain("Answer saved.");
		expect(html).not.toContain("Answered in chat");
	});
});

describe("Next question chip", () => {
	test("appears only under the reply the gate flagged, and not while a reply streams", () => {
		const chip = (timestamps: number[], running = false) => renderToStaticMarkup(<NextQuestionChip sessionId={SESSION} timestamps={timestamps} running={running} onNext={() => {}} />);
		expect(chip([100])).toBe("");
		rememberNextQuestionSuggestion(SESSION, 100);
		expect(chip([100])).toContain("Next question");
		expect(chip([100])).toContain("data-next-question");
		expect(chip([100], true)).toBe("");
		expect(chip([200])).toBe("");
		expect(renderToStaticMarkup(<NextQuestionChip sessionId="other" timestamps={[100]} running={false} onNext={() => {}} />)).toBe("");
	});
});

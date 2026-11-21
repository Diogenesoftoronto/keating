/**
 * A learner who types their answer to an open question card in the chat
 * composer, instead of in the card, gets the same graded record as Finish
 * check. Only one single-item card awaiting in the latest tutor message can be
 * answered this way, and only when the judge is confident the message is an
 * answer to it; anything else ("hint please", "let me think") stays chat.
 *
 * The card and the delivered learner message link to each other through a
 * small persisted record keyed by the canonical receipt id.
 */
import { useSyncExternalStore } from "react";
import type { Context } from "@earendil-works/pi-ai";
import {
	attemptedCheckpointQuestions,
	decodeAnswer,
	questionResponse,
	TEACHING_POLICY_THRESHOLDS,
	type ActiveWork,
	type ChoiceAnswer,
	type JudgementCaller,
	type JudgementRequest,
	type JudgementResponse,
	type UiActionReceipt,
	type UiDocument,
	type UiQuestion,
} from "@keating/learner-contracts";
import type { SharedUiActionIntent } from "./shared-actions";

/* ------------------------------------------------------------------ */
/* Which card, and which kind of answer                                */
/* ------------------------------------------------------------------ */

export interface ChatAnswerItem {
	/** A lone Question node, or a Question group holding exactly one question. */
	container: "question" | "question-group";
	nodeId: string;
	question: UiQuestion;
	/** Short learner-facing name of the card, for the backlink caption. */
	label: string;
	/** The card's own submit message, so both paths record the same text. */
	humanFriendlyMessage: string;
}

const STRUCTURED_KINDS = new Set(["ordering", "classification", "matching", "blanks", "fill_in", "slider", "multi_select"]);

/** Typed chat can only stand in for one free-text answer or one single choice. */
function typeableQuestion(question: UiQuestion): boolean {
	if (question.kind && STRUCTURED_KINDS.has(question.kind)) return false;
	if (question.choices) return question.choices.length > 0 && !question.multiSelect;
	return true;
}

export function chatAnswerItem(document: UiDocument, nodeId: string): ChatAnswerItem | null {
	const node = document.nodes.find((candidate) => candidate.id === nodeId);
	if (node?.type === "question" && typeableQuestion(node)) {
		return { container: "question", nodeId: node.id, question: node, label: node.header?.trim() || "the quick check", humanFriendlyMessage: `Answered: ${node.prompt}` };
	}
	if (node?.type === "question-group" && node.questions.length === 1 && typeableQuestion(node.questions[0]!)) {
		const question = node.questions[0]!;
		return {
			container: "question-group", nodeId: node.id, question,
			label: question.header?.trim() || node.title?.trim() || "the quick check",
			humanFriendlyMessage: `Answered ${node.questions.length} questions${node.topic ? ` about ${node.topic}` : ""}`,
		};
	}
	return null;
}

const normalize = (value: string) => value.normalize("NFKC").toLowerCase()
	.replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();
const LEAD_IN = /^(?:(?:i think|i'?d say|i guess|i choose|i pick|i'?ll go with|my answer is|the answer is|answer|it'?s|it is)\s*[:\-–—]?\s*)/iu;
const LETTER_ONLY = /^(?:option|choice|answer)?\s*\(?([a-z])\)?$/iu;
const LETTER_AND_LABEL = /^(?:option|choice|answer)?\s*\(?([a-z])\s*[.):\-–—]\s*(.+)$/iu;

/**
 * Map typed text to exactly one option: a letter ("B", "b)", "option B"), the
 * option's label (case and punctuation ignored), or a letter and label that
 * agree ("B) Evaporation"). Anything ambiguous or conflicting maps to nothing.
 */
export function mapChoiceAnswer(question: UiQuestion, text: string): string | null {
	const choices = question.choices ?? [];
	if (!choices.length) return null;
	const trimmed = text.trim().replace(/[.!]+$/u, "").trim().replace(LEAD_IN, "").trim();
	if (!trimmed) return null;
	const byLabel = (value: string) => {
		const wanted = normalize(value);
		if (!wanted) return null;
		const matches = choices.filter((choice) => normalize(choice.label) === wanted);
		return matches.length === 1 ? matches[0]!.id : null;
	};
	const byLetter = (letter: string) => {
		const index = letter.toLowerCase().charCodeAt(0) - 97;
		return index >= 0 && index < choices.length ? choices[index]!.id : null;
	};
	const labelled = byLabel(trimmed);
	const only = LETTER_ONLY.exec(trimmed);
	if (only) {
		const lettered = byLetter(only[1]!);
		// A one-letter label that names a different option is ambiguous.
		return labelled && labelled !== lettered ? null : lettered ?? labelled;
	}
	const pair = LETTER_AND_LABEL.exec(trimmed);
	if (pair && !labelled) {
		const lettered = byLetter(pair[1]!);
		return lettered && byLabel(pair[2]!) === lettered ? lettered : null;
	}
	return labelled;
}

/** The exact intent the card's own submit control would dispatch for this answer. */
export function chatAnswerIntent(item: ChatAnswerItem, text: string): SharedUiActionIntent | null {
	const answer = text.trim();
	if (!answer) return null;
	const { question } = item;
	if (question.choices) {
		const optionId = mapChoiceAnswer(question, answer);
		if (!optionId) return null;
		return item.container === "question"
			? { type: "choose-option", nodeId: item.nodeId, optionIds: [optionId] }
			: { type: "submit-question-group", nodeId: item.nodeId, responses: [questionResponse(question, "", [optionId], [], [], [])] };
	}
	return item.container === "question"
		? { type: "submit-answer", nodeId: item.nodeId, answer }
		: { type: "submit-question-group", nodeId: item.nodeId, responses: [questionResponse(question, answer, [], [], [], [])] };
}

/* ------------------------------------------------------------------ */
/* Is it an answer?                                                    */
/* ------------------------------------------------------------------ */

export const TYPED_ANSWER_TIMEOUT_MS = 4_000;
const ATTEMPT_KEY = "checkpoint_attempt_state";

function questionText(question: UiQuestion): string {
	const choices = question.choices?.map((choice, index) => `${String.fromCharCode(65 + index)}) ${choice.label}`) ?? [];
	return [question.prompt.trim(), ...choices].join("\n");
}

/** One Choice question: the same attempt-state judgement the reviewer uses after a single question. */
export function typedAnswerRequest(question: UiQuestion, learnerMessage: string): JudgementRequest {
	return {
		state: { immediately_preceding_tutor_question: questionText(question), current_learner_message: learnerMessage },
		questions: { [ATTEMPT_KEY]: attemptedCheckpointQuestions.checkpoint_attempt_state },
	};
}

/** The attempt-state answer, with every option scored, or null. */
export function attemptChoice(response: JudgementResponse): ChoiceAnswer | null {
	const question = attemptedCheckpointQuestions.checkpoint_attempt_state;
	const answer = decodeAnswer(question, response.answers[ATTEMPT_KEY]);
	if (answer?.type !== "choice") return null;
	const options = Object.keys(question.criteria);
	return options.every((option) => Object.hasOwn(answer.probabilities, option)) ? answer : null;
}

/** "answered" must be the top choice, with probability and confidence both at the fail line. */
export function isConfidentAnswer(response: JudgementResponse): boolean {
	const answer = attemptChoice(response);
	if (!answer || answer.choice !== "answered") return false;
	const value = answer.probabilities.answered!;
	return Math.min(value, answer.confidence) >= TEACHING_POLICY_THRESHOLDS.failAtLeast
		&& value === Math.max(...Object.values(answer.probabilities));
}

export type TypedAnswerClassifier = (question: UiQuestion, learnerMessage: string, signal?: AbortSignal) => Promise<boolean>;

/** Any failure (judge off, unavailable, timed out, malformed) reads as "not an answer". */
export function createTypedAnswerClassifier(makeCaller: () => JudgementCaller | null): TypedAnswerClassifier {
	return async (question, learnerMessage, signal) => {
		try {
			const call = makeCaller();
			if (!call) return false;
			const outcome = await call(typedAnswerRequest(question, learnerMessage), signal);
			return outcome.ok && isConfidentAnswer(outcome.response);
		} catch {
			return false;
		}
	};
}

/* ------------------------------------------------------------------ */
/* Mounted cards                                                       */
/* ------------------------------------------------------------------ */

export interface ChatAnswerCard {
	sessionId: string;
	documentId: string;
	/** The card's live document and receipts. */
	current(): { document: UiDocument; receipts: readonly UiActionReceipt[] };
	/** Dispatch through the card's own action path. False when the card refused it. */
	submit(intent: SharedUiActionIntent, humanFriendlyMessage: string, link: Omit<ChatAnswerLink, "sessionId" | "documentId" | "at">): boolean;
}

const cards = new Map<string, Set<ChatAnswerCard>>();
const cardKey = (sessionId: string, documentId: string) => `${sessionId}\u0000${documentId}`;

export function registerChatAnswerCard(card: ChatAnswerCard): () => void {
	const key = cardKey(card.sessionId, card.documentId);
	const set = cards.get(key) ?? new Set<ChatAnswerCard>();
	set.add(card);
	cards.set(key, set);
	return () => { set.delete(card); if (!set.size) cards.delete(key); };
}

/** The same document can be mounted twice (chat and materials panel); use the copy with the newest state. */
function mountedCard(sessionId: string, documentId: string): ChatAnswerCard | null {
	const set = cards.get(cardKey(sessionId, documentId));
	if (!set?.size) return null;
	return [...set].reduce((best, card) => card.current().document.revision > best.current().document.revision ? card : best);
}

const ANSWER_TYPES = new Set(["submit-answer", "choose-option", "submit-question-group"]);
function answered(receipts: readonly UiActionReceipt[], nodeId: string): boolean {
	return receipts.some((receipt) => receipt.state === "completed" && ANSWER_TYPES.has(receipt.action.type)
		&& "nodeId" in receipt.action && receipt.action.nodeId === nodeId);
}

/* ------------------------------------------------------------------ */
/* Links between the card and the message                              */
/* ------------------------------------------------------------------ */

export interface ChatAnswerLink {
	sessionId: string;
	documentId: string;
	nodeId: string;
	label: string;
	at: number;
}

const LINKS_KEY = "keating.chat-answer-links.v1";
const MAX_LINKS = 200;
let links: Record<string, ChatAnswerLink> | null = null;
const linkListeners = new Set<() => void>();
let linkVersion = 0;

function storage(): Pick<Storage, "getItem" | "setItem"> | null {
	try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

function readLinks(): Record<string, ChatAnswerLink> {
	if (links) return links;
	try {
		const parsed = JSON.parse(storage()?.getItem(LINKS_KEY) ?? "{}") as unknown;
		links = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, ChatAnswerLink> : {};
	} catch { links = {}; }
	return links;
}

/** Record that this receipt's answer was typed in the chat. */
export function rememberChatAnswer(receiptId: string, link: ChatAnswerLink): void {
	const next = { ...readLinks(), [receiptId]: link };
	const ids = Object.keys(next).sort((a, b) => next[a]!.at - next[b]!.at);
	for (const id of ids.slice(0, Math.max(0, ids.length - MAX_LINKS))) delete next[id];
	links = next;
	try { storage()?.setItem(LINKS_KEY, JSON.stringify(next)); } catch { /* The link is a convenience; the grade is saved regardless. */ }
	linkVersion += 1;
	for (const listener of linkListeners) listener();
}

export function chatAnswerLink(receiptId: string): ChatAnswerLink | null {
	return readLinks()[receiptId] ?? null;
}

const subscribeLinks = (listener: () => void) => { linkListeners.add(listener); return () => { linkListeners.delete(listener); }; };

/** Re-render when links change. */
export function useChatAnswerLinks(): number {
	return useSyncExternalStore(subscribeLinks, () => linkVersion, () => linkVersion);
}

/** Test seam. */
export function __resetChatAnswer(): void { links = null; cards.clear(); linkVersion += 1; for (const listener of linkListeners) listener(); }

/** The canonical receipt id, which is also the delivered learner message's id suffix. */
export const receiptIdOf = (receipt: Pick<UiActionReceipt, "action">) => `${receipt.action.documentId}-${receipt.action.idempotencyKey}`;
export const learnerMessageIdOf = (receiptId: string) => `openui:${receiptId}`;

/** Scroll a partner into view and pulse it once. */
export function revealLinked(target: Element | null | undefined): void {
	if (!(target instanceof HTMLElement)) return;
	const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
	target.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "center" });
	target.removeAttribute("data-link-flash");
	void target.offsetWidth;
	target.setAttribute("data-link-flash", "");
	setTimeout(() => target.removeAttribute("data-link-flash"), 1_600);
}

/** The partner element nearest to the control, preferring the same chat thread. */
export function findLinked(from: Element, selector: string): Element | null {
	const thread = from.closest("[data-chat-thread]");
	return thread?.querySelector(selector) ?? from.ownerDocument.querySelector(selector);
}

/* ------------------------------------------------------------------ */
/* Composer send                                                       */
/* ------------------------------------------------------------------ */

export interface TypedAnswerRoute {
	sessionId: string;
	text: string;
	/** The agent's transcript before this message. */
	messages: Context["messages"];
	work: ActiveWork | undefined;
	/** The single awaiting card the preceding tutor message presented, if any. */
	presentation: (messages: Context["messages"], work: ActiveWork | undefined) => { documentId: string; nodeId: string } | undefined;
	classify: TypedAnswerClassifier;
	signal?: AbortSignal;
}

/**
 * Submit a typed message through the open card when it is an answer to it.
 * Returns "submitted" only after the card accepted the action; otherwise the
 * caller sends the message as ordinary chat, exactly as before.
 */
export async function routeTypedAnswer(route: TypedAnswerRoute): Promise<"submitted" | "chat"> {
	const text = route.text.trim();
	if (!text || text.length > 2_000) return "chat";
	const pending = { role: "user", content: text, timestamp: Date.now() } as Context["messages"][number];
	const presented = route.presentation([...route.messages, pending], route.work);
	if (!presented) return "chat";
	const card = mountedCard(route.sessionId, presented.documentId);
	if (!card) return "chat";
	const before = card.current();
	if (answered(before.receipts, presented.nodeId)) return "chat";
	const item = chatAnswerItem(before.document, presented.nodeId);
	const intent = item && chatAnswerIntent(item, text);
	if (!item || !intent) return "chat";
	if (!await route.classify(item.question, text, route.signal) || route.signal?.aborted) return "chat";
	// The learner may have used the card, or left, while the judge ran.
	const live = mountedCard(route.sessionId, presented.documentId);
	if (!live || answered(live.current().receipts, presented.nodeId)) return "chat";
	return live.submit(intent, item.humanFriendlyMessage, { nodeId: item.nodeId, label: item.label }) ? "submitted" : "chat";
}

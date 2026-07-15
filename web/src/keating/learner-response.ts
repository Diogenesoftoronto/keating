import type { AnsweredQuestion } from "../components/QuestionRenderer";
import type { KeatingOpenUIAction } from "./openui/types";

export const LEARNER_RESPONSE_TAG = "keating-learner-response";

export interface LearnerResponseReviewItem {
	label: string;
	value: string;
}

export interface LearnerResponseReview {
	title: string;
	summary?: string;
	items: LearnerResponseReviewItem[];
}

interface LearnerResponseEnvelopeBase {
	version: 1;
	id: string;
	submittedAt: string;
	review: LearnerResponseReview;
	/** Guidance for the tutor. The transcript deliberately does not render this. */
	agentInstruction?: string;
}

export interface QuestionLearnerResponseEnvelope extends LearnerResponseEnvelopeBase {
	kind: "question";
	payload: {
		topic?: string;
		answers: AnsweredQuestion[];
		source: "legacy" | "openui";
		document?: KeatingOpenUIAction["document"];
	};
}

export interface OpenUIActionLearnerResponseEnvelope extends LearnerResponseEnvelopeBase {
	kind: "openui-action";
	payload: KeatingOpenUIAction;
}

export type LearnerResponseEnvelope =
	| QuestionLearnerResponseEnvelope
	| OpenUIActionLearnerResponseEnvelope;

interface EnvelopeOptions {
	id?: string;
	submittedAt?: string;
}

function responseIdentity(kind: LearnerResponseEnvelope["kind"], options?: EnvelopeOptions) {
	return {
		id: options?.id ?? globalThis.crypto?.randomUUID?.() ?? `${kind}-${Date.now()}`,
		submittedAt: options?.submittedAt ?? new Date().toISOString(),
	};
}

function pendingQuestionInstruction(topic?: string): string {
	return `Evaluate the pending diagnostic responses against the lesson. Call grade_question_checks with correct, partial, or incorrect verdicts${topic?.trim() ? ` for topic ${JSON.stringify(topic.trim())}` : " for the current lesson topic"}. Record a misconception only when the response supports it.`;
}

function questionReview(
	answers: AnsweredQuestion[],
	topic?: string,
): LearnerResponseReview {
	return {
		title: "Your response",
		summary: topic?.trim()
			? `${answers.length === 1 ? "Answer" : `${answers.length} answers`} submitted for ${topic.trim()}.`
			: `${answers.length === 1 ? "Answer" : `${answers.length} answers`} submitted.`,
		items: answers.map((answer, index) => ({
			label: answer.header?.trim() || answer.question.trim() || `Answer ${index + 1}`,
			value: answer.answer,
		})),
	};
}

export function createQuestionLearnerResponse(
	input: {
		answers: AnsweredQuestion[];
		topic?: string;
		source?: "legacy" | "openui";
		document?: KeatingOpenUIAction["document"];
	},
	options?: EnvelopeOptions,
): QuestionLearnerResponseEnvelope {
	const hasPending = input.answers.some((answer) => answer.grading === "pending");
	return {
		version: 1,
		kind: "question",
		...responseIdentity("question", options),
		review: questionReview(input.answers, input.topic),
		payload: {
			topic: input.topic,
			answers: input.answers,
			source: input.source ?? "legacy",
			document: input.document,
		},
		agentInstruction: hasPending ? pendingQuestionInstruction(input.topic) : undefined,
	};
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readableValue(value: unknown): string | null {
	if (typeof value === "string") return value.trim() || null;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (Array.isArray(value) && value.every((item) => ["string", "number", "boolean"].includes(typeof item))) {
		return value.map(String).join(", ");
	}
	return null;
}

function labelFromKey(key: string): string {
	return key
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[_-]+/g, " ")
		.replace(/^./, (character) => character.toUpperCase());
}

function genericActionItems(action: KeatingOpenUIAction): LearnerResponseReviewItem[] {
	const combined = { ...action.formState, ...action.params };
	return Object.entries(combined)
		.filter(([key]) => key !== "interaction")
		.flatMap(([key, value]) => {
			const readable = readableValue(value);
			return readable ? [{ label: labelFromKey(key), value: readable }] : [];
		})
		.slice(0, 8);
}

function openUIActionReview(action: KeatingOpenUIAction): LearnerResponseReview {
	const interaction = typeof action.params.interaction === "string"
		? action.params.interaction
		: action.type;

	if (interaction === "quiz") {
		const score = finiteNumber(action.params.score);
		const total = finiteNumber(action.params.total);
		const topic = readableValue(action.params.topic);
		const flagged = Array.isArray(action.params.flagged) ? action.params.flagged.length : 0;
		return {
			title: "Quiz completed",
			summary: topic ? `Results saved for ${topic}.` : "Results saved.",
			items: [
				...(score !== undefined
					? [{ label: "Score", value: total !== undefined ? `${score} of ${total}` : String(score) }]
					: []),
				...(flagged > 0 ? [{ label: "Marked for review", value: String(flagged) }] : []),
			],
		};
	}

	if (interaction === "flashcards") {
		const reviewed = finiteNumber(action.params.reviewed);
		const lapses = finiteNumber(action.params.lapses);
		return {
			title: "Flashcards reviewed",
			summary: "Review progress saved.",
			items: [
				...(reviewed !== undefined ? [{ label: "Cards reviewed", value: String(reviewed) }] : []),
				...(lapses !== undefined ? [{ label: "Difficult recalls", value: String(lapses) }] : []),
			],
		};
	}

	return {
		title: "Your response",
		summary: action.humanFriendlyMessage.trim() || "Response submitted.",
		items: genericActionItems(action),
	};
}

export function createOpenUIActionLearnerResponse(
	action: KeatingOpenUIAction,
	options?: EnvelopeOptions,
): LearnerResponseEnvelope {
	const answers = Array.isArray(action.params.answers)
		? action.params.answers.filter((answer): answer is AnsweredQuestion => {
			if (!answer || typeof answer !== "object") return false;
			const item = answer as Partial<AnsweredQuestion>;
			return typeof item.question === "string" && typeof item.answer === "string";
		})
		: [];
	if (action.params.interaction === "question" && answers.length > 0) {
		return createQuestionLearnerResponse({
			answers,
			topic: typeof action.params.topic === "string" ? action.params.topic : undefined,
			source: "openui",
			document: action.document,
		}, options);
	}

	return {
		version: 1,
		kind: "openui-action",
		...responseIdentity("openui-action", options),
		review: openUIActionReview(action),
		payload: action,
		agentInstruction: "Continue from this learner action using the complete structured payload.",
	};
}

export function serializeLearnerResponse(envelope: LearnerResponseEnvelope): string {
	return `<${LEARNER_RESPONSE_TAG} version="1">\n${JSON.stringify(envelope)}\n</${LEARNER_RESPONSE_TAG}>`;
}

export function parseLearnerResponse(text: string): LearnerResponseEnvelope | null {
	const pattern = new RegExp(`^\\s*<${LEARNER_RESPONSE_TAG}(?:\\s+version=["']1["'])?>\\s*([\\s\\S]*)\\s*</${LEARNER_RESPONSE_TAG}>\\s*$`);
	const match = text.match(pattern);
	if (!match) return null;
	try {
		const parsed = JSON.parse(match[1]) as Partial<LearnerResponseEnvelope>;
		if (
			parsed.version !== 1 ||
			(parsed.kind !== "question" && parsed.kind !== "openui-action") ||
			!parsed.review ||
			typeof parsed.review.title !== "string" ||
			!Array.isArray(parsed.review.items)
		) return null;
		return parsed as LearnerResponseEnvelope;
	} catch {
		return null;
	}
}

export function learnerResponseReviewText(text: string): string {
	const response = parseLearnerResponse(text);
	if (!response) return text;
	return [
		response.review.title,
		response.review.summary,
		...response.review.items.map((item) => `${item.label}: ${item.value}`),
	].filter(Boolean).join("\n");
}

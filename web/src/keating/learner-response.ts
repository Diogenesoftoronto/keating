import type { UiQuestion, UiQuestionGroupResponse } from "@keating/learner-contracts";
import type { AnsweredQuestion } from "../components/QuestionRenderer";
import type { CanonicalKeatingOpenUIAction, KeatingOpenUIAction } from "./openui/types";
import { formatQuizDuration } from "../components/quiz/game";

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

function questionGroupResponseValue(response: UiQuestionGroupResponse, question?: UiQuestion): string {
	switch (response.type) {
		case "text":
			return response.answer.trim();
		case "choice": {
			const choices = response.optionIds.map((optionId) =>
				question?.choices?.find((choice) => choice.id === optionId)?.label ?? optionId,
			);
			if (response.text?.trim()) choices.push(response.text.trim());
			return choices.join("; ");
		}
		case "blanks":
			return response.answers.join(", ");
		case "rows":
			return response.rows.map((row) => {
				const selection = question?.choices?.find((choice) => choice.id === row.optionId)?.label ?? row.optionId;
				return `${row.item}: ${selection}${row.reason?.trim() ? ` (${row.reason.trim()})` : ""}`;
			}).join("; ");
		case "order":
			return response.items.map((item, index) => `${index + 1}. ${item}`).join("; ");
	}
}

function canonicalQuestionGroupReview(action: CanonicalKeatingOpenUIAction): LearnerResponseReview | null {
	const submitted = action.action;
	if (submitted.type !== "submit-question-group") return null;
	const group = action.sourceDocument.nodes.find(
		(node) => node.type === "question-group" && node.id === submitted.nodeId,
	);
	if (!group || group.type !== "question-group") return null;
	const items = submitted.responses.map((response, index) => {
		const question = group.questions.find((candidate) => candidate.id === response.questionId);
		return {
			label: question?.header?.trim() || question?.prompt.trim() || `Answer ${index + 1}`,
			value: questionGroupResponseValue(response, question) || "No answer provided.",
		};
	});
	const count = items.length;
	return {
		title: "Your response",
		summary: `${count} ${count === 1 ? "question" : "questions"} answered${group.topic?.trim() ? ` about ${group.topic.trim()}` : ""}.`,
		items,
	};
}

function stringList(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function quizTimingReview(params: Record<string, unknown>): LearnerResponseReviewItem[] {
	const timing = params.timing && typeof params.timing === "object" ? params.timing as Record<string, unknown> : undefined;
	const totalMs = finiteNumber(timing?.totalMs);
	const timeouts = stringList(params.timedOutQuestionIds);
	return [
		...(totalMs !== undefined ? [{ label: "Total time", value: formatQuizDuration(totalMs) }] : []),
		...(timeouts.length ? [{ label: "Timed out", value: timeouts.join(", ") }] : []),
		...(params.examTimedOut === true ? [{ label: "Exam timer", value: "Time limit reached" }] : []),
	];
}

function openUIActionReview(action: KeatingOpenUIAction): LearnerResponseReview {
	if (action.kind === "canonical") {
		const questionGroup = canonicalQuestionGroupReview(action);
		if (questionGroup) return questionGroup;
	}
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
				...quizTimingReview(action.params),
				...(score !== undefined
					? [{ label: "Score", value: total !== undefined ? `${score} of ${total}` : String(score) }]
					: []),
				...(flagged > 0 ? [{ label: "Marked for review", value: String(flagged) }] : []),
			],
		};
	}

	if (interaction === "complete-language-practice") {
		const correct = finiteNumber(action.params.correct);
		const total = finiteNumber(action.params.objectiveTotal);
		const practiced = finiteNumber(action.params.pronunciationPracticed);
		const totalMs = finiteNumber(action.params.totalMs);
		return {
			title: "Language practice completed",
			summary: action.humanFriendlyMessage.trim() || "Practice saved.",
			items: [
				...(correct !== undefined && total !== undefined ? [{ label: "Checked answers", value: `${correct} of ${total}` }] : []),
				...(practiced !== undefined && practiced > 0 ? [{ label: "Pronunciation", value: `${practiced} practiced · self-reviewed` }] : []),
				...(totalMs !== undefined ? [{ label: "Time", value: formatQuizDuration(totalMs) }] : []),
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

	if (action.kind === "canonical" && action.action.type === "submit-task") {
    const submission = action.action;
    return {
      title: "Work submitted",
      summary: action.humanFriendlyMessage,
      items: [
        ...(submission.submission ? [{ label: "Submission", value: submission.submission }] : []),
        ...(submission.attachments ?? []).map((file) => ({ label: "Attached file", value: `${file.name} (${file.mimeType}, ${file.sizeBytes} bytes); saved on this device as ${file.id}` })),
      ],
    };
  }

	// A canonical quiz completion arrives as `complete-quiz`, not as an
	// `interaction` param. Surface the result id and the open-ended questions so
	// the teacher knows exactly what still needs `grade_quiz`.
	if (interaction === "complete-quiz") {
		const score = finiteNumber(action.params.score);
		const points = finiteNumber(action.params.partialCreditPoints);
		const answered = Array.isArray(action.params.answers) ? action.params.answers.length : undefined;
		const pending = stringList(action.params.pendingGradeQuestionIds);
		const skipped = stringList(action.params.skippedQuestionIds);
		const flagged = stringList(action.params.flaggedQuestionIds);
		const resultId = readableValue(action.params.resultId);
		return {
			title: "Quiz submitted",
			summary: pending.length > 0
				? `Objective questions are scored. ${pending.length} open-ended answer${pending.length === 1 ? "" : "s"} still need your judgement.`
				: "Results saved.",
			items: [
				...quizTimingReview(action.params),
				...(score !== undefined && answered !== undefined ? [{ label: "Auto-scored", value: `${score} of ${answered}` }] : []),
				...(points !== undefined ? [{ label: "Points", value: String(points) }] : []),
				...(skipped.length > 0 ? [{ label: "Skipped", value: skipped.join(", ") }] : []),
				...(flagged.length > 0 ? [{ label: "Flagged for review", value: flagged.join(", ") }] : []),
				...(pending.length > 0 && resultId
					? [{ label: "Needs grading", value: `Call grade_quiz with result_id ${resultId} for: ${pending.join(", ")}` }]
					: []),
			],
		};
	}

	// A component that failed to compile. The learner cannot act on this; the
	// teacher has to re-emit a corrected component.
	if (interaction === "regenerate") {
		const reason = readableValue(action.params.reason);
		const attempt = finiteNumber(action.params.attempt);
		const limit = finiteNumber(action.params.maxAttempts);
		return {
			title: "Interaction failed to build",
			summary: "The component you streamed could not be compiled, so the learner saw nothing. Re-emit a corrected version of it.",
			items: [
				...(reason ? [{ label: "Compiler error", value: reason }] : []),
				...(attempt !== undefined ? [{ label: "Attempt", value: limit !== undefined ? `${attempt} of ${limit}` : String(attempt) }] : []),
				{ label: "What to do", value: "Check the component's argument count and order against the OpenUI grammar, then stream the corrected component again. Do not apologize in prose or repeat the broken source." },
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
		agentInstruction: action.type === "complete-language-practice"
			? "Continue from the recorded language answers, attempts, and exact timings. Pronunciation entries record self-reviewed practice only: the audio stayed on the learner's device and pronunciation accuracy was not assessed. Do not infer a pronunciation score from completion."
			: "Continue from this learner action using the complete structured payload.",
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

/** Resolve historical envelopes against their structured payload before displaying them. */
export function resolvedLearnerResponseReview(response: LearnerResponseEnvelope): LearnerResponseReview {
	return response.kind === "openui-action" ? openUIActionReview(response.payload) : response.review;
}

export function learnerResponseReviewText(text: string): string {
	const response = parseLearnerResponse(text);
	if (!response) return text;
	const review = resolvedLearnerResponseReview(response);
	return [
		review.title,
		review.summary,
		...review.items.map((item) => `${item.label}: ${item.value}`),
	].filter(Boolean).join("\n");
}

function escapeMarkdownLabel(value: string): string {
	return value.replace(/([\\`*_{}\[\]()<>#+.!|])/g, "\\$1");
}

/** A compact, readable transcript view. The complete envelope remains available in Raw. */
export function learnerResponseReviewMarkdown(text: string): string {
	const response = parseLearnerResponse(text);
	if (!response) return text;
	const review = resolvedLearnerResponseReview(response);
	return [
		`### ${escapeMarkdownLabel(review.title)}`,
		review.summary,
		...review.items.flatMap((item) => [
			`**${escapeMarkdownLabel(item.label)}**`,
			item.value,
		]),
	].filter(Boolean).join("\n\n");
}

/**
 * Pure answer-state helpers for QuestionRenderer: initial state, serialization
 * of an answer into learner-facing text, answered-ness validation, and
 * matching-key scoring. No React; all functions are deterministic.
 */
import type { AnsweredQuestion, QuestionField } from "../QuestionRenderer";

export interface ClassificationAnswer {
	item: string;
	choice: string;
	reason: string;
}

/** Per-question answer state covering every question type. */
export interface BlankState {
	values: string[];
	selected: string[];
	text: string;
	classifications: ClassificationAnswer[];
}

export function blankCount(template: string): number {
	const matches = template.match(/_{3,}|\{\{blank\}\}/g);
	return matches ? matches.length : 0;
}

/** The empty (nothing answered yet) state for one question. */
export function createAnswerState(question: QuestionField): BlankState {
	return {
		values: Array(question.blanks?.length ?? blankCount(question.question)).fill(""),
		selected: [],
		text: "",
		classifications: (question.items ?? []).map((item) => ({ item, choice: "", reason: "" })),
	};
}

export function isClassificationQuestion(question: QuestionField): boolean {
	return question.type === "classification" && !!question.items?.length && !!question.choices?.length;
}

export function isMatchingQuestion(question: QuestionField): boolean {
	return question.type === "matching" && !!question.items?.length && !!question.choices?.length;
}

export function isBlanksQuestion(question: QuestionField): boolean {
	return question.type === "blanks" || !!(question.blanks && question.blanks.length > 0);
}

export function matchingCorrectness(
	question: QuestionField,
	rowIndex: number,
	choice: string,
): "correct" | "wrong" | null {
	const correct = question.correctMatches?.[rowIndex];
	if (!correct || !choice) return null;
	return choice.trim().toLowerCase() === correct.trim().toLowerCase() ? "correct" : "wrong";
}

/** Serializes one answer into the text shown in review and sent on submit. */
export function serializeQuestionAnswer(question: QuestionField, state: BlankState | undefined): string {
	if (!state) return "";
	if (isClassificationQuestion(question)) {
		return state.classifications
			.map(({ item, choice, reason }) => {
				const trimmed = reason.trim();
				return `${item}: ${choice}${trimmed ? ` - ${trimmed}` : ""}`;
			})
			.join("\n");
	}
	if (isMatchingQuestion(question)) {
		return state.classifications.map(({ item, choice }) => `${item}: ${choice}`).join("\n");
	}
	if (isBlanksQuestion(question)) {
		return state.values.filter(Boolean).join(" | ");
	}
	const parts = [...state.selected];
	const text = state.text.trim();
	if (text) parts.push(text);
	return parts.join(", ");
}

/** Whether a question has a complete answer, per its type's rules. */
export function isQuestionAnswered(question: QuestionField | undefined, state: BlankState | undefined): boolean {
	if (!question || !state) return false;
	if (isClassificationQuestion(question)) {
		return state.classifications.every(
			(row) => row.choice.trim().length > 0 && (!question.requireReasons || row.reason.trim().length > 0),
		);
	}
	if (isMatchingQuestion(question)) {
		const choices = state.classifications.map((row) => row.choice.trim()).filter(Boolean);
		const allRowsMatched = choices.length === state.classifications.length;
		const unique = new Set(choices).size === choices.length;
		return allRowsMatched && (!question.uniqueMatches || unique);
	}
	if (isBlanksQuestion(question)) {
		return state.values.every((v) => v.trim().length > 0);
	}
	return serializeQuestionAnswer(question, state).length > 0;
}

/** Builds the submitted record; matching questions with a key are auto-scored. */
export function buildAnsweredQuestion(question: QuestionField, state: BlankState | undefined): AnsweredQuestion {
	const matching = isMatchingQuestion(question) && question.correctMatches?.length
		? state?.classifications ?? []
		: null;
	const score = matching
		? matching.filter((row, rowIndex) => matchingCorrectness(question, rowIndex, row.choice) === "correct").length / matching.length
		: undefined;
	return {
		header: question.header,
		question: question.question,
		answer: serializeQuestionAnswer(question, state),
		score,
		grading: score === undefined ? "pending" : "auto",
	};
}

/* ── pure answer updaters (used by the reducer's update-answers action) ── */

type AnswerList = BlankState[];

function updateAt(answers: AnswerList, index: number, change: (state: BlankState) => BlankState): AnswerList {
	return answers.map((state, i) => (i === index ? change(state) : state));
}

/** Toggles a choice; single-select replaces (or clears when re-picked). */
export function toggleChoiceAnswer(answers: AnswerList, index: number, choice: string, multiSelect: boolean): AnswerList {
	return updateAt(answers, index, (state) => {
		if (multiSelect) {
			const selected = state.selected.includes(choice)
				? state.selected.filter((c) => c !== choice)
				: [...state.selected, choice];
			return { ...state, selected };
		}
		return { ...state, selected: state.selected[0] === choice ? [] : [choice] };
	});
}

export function setTextAnswer(answers: AnswerList, index: number, value: string): AnswerList {
	return updateAt(answers, index, (state) => ({ ...state, text: value }));
}

export function setClassificationAnswer(
	answers: AnswerList,
	index: number,
	rowIndex: number,
	field: "choice" | "reason",
	value: string,
): AnswerList {
	return updateAt(answers, index, (state) => ({
		...state,
		classifications: state.classifications.map((row, r) => (r === rowIndex ? { ...row, [field]: value } : row)),
	}));
}

/** Sets a matching row's choice; when `unique`, clears the same choice from other rows. */
export function setMatchingAnswer(
	answers: AnswerList,
	index: number,
	rowIndex: number,
	value: string,
	unique: boolean,
): AnswerList {
	return updateAt(answers, index, (state) => ({
		...state,
		classifications: state.classifications.map((row, r) => {
			if (r === rowIndex) return { ...row, choice: value };
			if (unique && value && row.choice === value) return { ...row, choice: "" };
			return row;
		}),
	}));
}

export function setBlankAnswer(answers: AnswerList, index: number, blankIdx: number, value: string): AnswerList {
	return updateAt(answers, index, (state) => {
		const values = [...state.values];
		values[blankIdx] = value;
		return { ...state, values };
	});
}

/* ── navigation decisions ── */

/** Next question index, or null when already on the last question. */
export function nextQuestionIndex(current: number, total: number): number | null {
	return current < total - 1 ? current + 1 : null;
}

/** Previous question index, or null when already on the first question. */
export function prevQuestionIndex(current: number): number | null {
	return current > 0 ? current - 1 : null;
}

/** What pressing Enter in an answer field does: advance, submit, or nothing. */
export function enterKeyAction(opts: {
	currentAnswered: boolean;
	isLast: boolean;
	allAnswered: boolean;
}): "next" | "submit" | "none" {
	if (!opts.currentAnswered) return "none";
	if (!opts.isLast) return "next";
	return opts.allAnswered ? "submit" : "none";
}

/** Label for the final button. */
export function questionSubmitLabel(submitLabel: string | undefined, total: number): string {
	return submitLabel ?? (total === 1 ? "Lock in answer" : "Finish round");
}

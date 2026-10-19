/**
 * Interaction state for QuestionRenderer: answers per question plus
 * submit/navigation/collapse/drag UI state, advanced by a pure reducer.
 */
import type { QuestionField } from "../QuestionRenderer";
import { type BlankState, createAnswerState } from "./question-answers";

export type QuestionInteractionState = {
	answers: BlankState[];
	submitted: boolean;
	current: number;
	collapsed: boolean;
	draggingMatch: string | null;
	dragOverRow: number | null;
};

export type QuestionInteractionAction =
	| { type: "update-answers"; update: (answers: BlankState[]) => BlankState[] }
	| { type: "submit" }
	| { type: "navigate"; current: number }
	| { type: "toggle-collapsed" }
	| { type: "drag-start"; value: string }
	| { type: "drag-over"; row: number | null }
	| { type: "drag-end" };

export function createQuestionInteractionState(questions: QuestionField[]): QuestionInteractionState {
	return {
		answers: questions.map(createAnswerState),
		submitted: false,
		current: 0,
		collapsed: false,
		draggingMatch: null,
		dragOverRow: null,
	};
}

export function questionInteractionReducer(
	state: QuestionInteractionState,
	action: QuestionInteractionAction,
): QuestionInteractionState {
	switch (action.type) {
		case "update-answers":
			return { ...state, answers: action.update(state.answers) };
		case "submit":
			return { ...state, submitted: true };
		case "navigate":
			return { ...state, current: action.current };
		case "toggle-collapsed":
			return { ...state, collapsed: !state.collapsed };
		case "drag-start":
			return { ...state, draggingMatch: action.value };
		case "drag-over":
			return { ...state, dragOverRow: action.row };
		case "drag-end":
			return { ...state, draggingMatch: null, dragOverRow: null };
	}
}

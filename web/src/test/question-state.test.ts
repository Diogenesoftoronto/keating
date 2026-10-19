import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
	createAnswerState,
	enterKeyAction,
	nextQuestionIndex,
	prevQuestionIndex,
	questionSubmitLabel,
	setBlankAnswer,
	setClassificationAnswer,
	setMatchingAnswer,
	setTextAnswer,
	toggleChoiceAnswer,
} from "../components/question/question-answers";
import {
	createQuestionInteractionState,
	questionInteractionReducer,
} from "../components/question/question-state";
import type { QuestionField } from "../components/QuestionRenderer";

const matching: QuestionField = { question: "m", type: "matching", items: ["a", "b", "c"], choices: ["X", "Y", "Z"] };
const choice: QuestionField = { question: "c", choices: ["a", "b"] };
const blanks: QuestionField = { question: "x ___ y ___" };

describe("answer updaters", () => {
	test("single select replaces and re-pick clears; multi select toggles", () => {
		let answers = [createAnswerState(choice)];
		answers = toggleChoiceAnswer(answers, 0, "a", false);
		expect(answers[0].selected).toEqual(["a"]);
		answers = toggleChoiceAnswer(answers, 0, "b", false);
		expect(answers[0].selected).toEqual(["b"]);
		answers = toggleChoiceAnswer(answers, 0, "b", false);
		expect(answers[0].selected).toEqual([]);
		answers = toggleChoiceAnswer(answers, 0, "a", true);
		answers = toggleChoiceAnswer(answers, 0, "b", true);
		expect(answers[0].selected).toEqual(["a", "b"]);
		answers = toggleChoiceAnswer(answers, 0, "a", true);
		expect(answers[0].selected).toEqual(["b"]);
	});

	test("unique matching moves a choice from the previous row", () => {
		let answers = [createAnswerState(matching)];
		answers = setMatchingAnswer(answers, 0, 0, "X", true);
		answers = setMatchingAnswer(answers, 0, 1, "X", true);
		expect(answers[0].classifications.map((r) => r.choice)).toEqual(["", "X", ""]);
		answers = setMatchingAnswer(answers, 0, 2, "X", false);
		expect(answers[0].classifications.map((r) => r.choice)).toEqual(["", "X", "X"]);
	});

	test("updaters only touch the targeted question and do not mutate", () => {
		const before = [createAnswerState(blanks), createAnswerState(choice)];
		const snapshot = structuredClone(before);
		const after = setBlankAnswer(before, 0, 1, "v");
		expect(before).toEqual(snapshot);
		expect(after[0].values).toEqual(["", "v"]);
		expect(after[1]).toBe(before[1]);
		expect(setTextAnswer(before, 1, "t")[1].text).toBe("t");
		expect(setClassificationAnswer([createAnswerState(matching)], 0, 1, "reason", "r")[0].classifications[1].reason).toBe("r");
	});

	test("property: unique matching never leaves a non-empty choice on two rows", () => {
		fc.assert(
			fc.property(
				fc.array(fc.tuple(fc.integer({ min: 0, max: 2 }), fc.constantFrom("", "X", "Y", "Z")), { maxLength: 12 }),
				(ops) => {
					let answers = [createAnswerState(matching)];
					for (const [row, value] of ops) answers = setMatchingAnswer(answers, 0, row, value, true);
					const used = answers[0].classifications.map((r) => r.choice).filter(Boolean);
					expect(new Set(used).size).toBe(used.length);
				},
			),
		);
	});
});

describe("navigation", () => {
	test("next/prev return null at the edges", () => {
		expect(nextQuestionIndex(2, 3)).toBeNull();
		expect(nextQuestionIndex(0, 3)).toBe(1);
		expect(prevQuestionIndex(0)).toBeNull();
		expect(prevQuestionIndex(2)).toBe(1);
	});

	test("property: repeated navigation never leaves [0, total-1]", () => {
		fc.assert(
			fc.property(fc.integer({ min: 1, max: 8 }), fc.array(fc.boolean(), { maxLength: 30 }), (total, moves) => {
				let index = 0;
				for (const forward of moves) {
					const next = forward ? nextQuestionIndex(index, total) : prevQuestionIndex(index);
					if (next !== null) index = next;
					expect(index).toBeGreaterThanOrEqual(0);
					expect(index).toBeLessThanOrEqual(total - 1);
				}
			}),
		);
	});

	test("enter key action table", () => {
		expect(enterKeyAction({ currentAnswered: false, isLast: false, allAnswered: true })).toBe("none");
		expect(enterKeyAction({ currentAnswered: true, isLast: false, allAnswered: false })).toBe("next");
		expect(enterKeyAction({ currentAnswered: true, isLast: true, allAnswered: true })).toBe("submit");
		expect(enterKeyAction({ currentAnswered: true, isLast: true, allAnswered: false })).toBe("none");
	});

	test("submit label", () => {
		expect(questionSubmitLabel("Go", 3)).toBe("Go");
		expect(questionSubmitLabel(undefined, 1)).toBe("Lock in answer");
		expect(questionSubmitLabel(undefined, 2)).toBe("Finish round");
	});
});

describe("questionInteractionReducer", () => {
	test("submit, navigate, collapse and drag transitions", () => {
		let state = createQuestionInteractionState([choice, matching]);
		expect(state.answers).toHaveLength(2);
		state = questionInteractionReducer(state, { type: "navigate", current: 1 });
		expect(state.current).toBe(1);
		state = questionInteractionReducer(state, { type: "toggle-collapsed" });
		expect(state.collapsed).toBe(true);
		state = questionInteractionReducer(state, { type: "drag-start", value: "X" });
		state = questionInteractionReducer(state, { type: "drag-over", row: 2 });
		expect(state).toMatchObject({ draggingMatch: "X", dragOverRow: 2 });
		state = questionInteractionReducer(state, { type: "drag-end" });
		expect(state).toMatchObject({ draggingMatch: null, dragOverRow: null });
		state = questionInteractionReducer(state, { type: "submit" });
		expect(state.submitted).toBe(true);
	});
});

import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
	type BlankState,
	buildAnsweredQuestion,
	createAnswerState,
	isQuestionAnswered,
	matchingCorrectness,
	serializeQuestionAnswer,
} from "../components/question/question-answers";
import type { QuestionField } from "../components/QuestionRenderer";

const choice: QuestionField = { question: "Pick", type: "choice", choices: ["a", "b", "c"], multiSelect: true };
const text: QuestionField = { question: "Explain", type: "text", allowText: true };
const blanks: QuestionField = { question: "A ___ and {{blank}}", type: "blanks" };
const classification: QuestionField = {
	question: "Sort",
	type: "classification",
	items: ["x", "y"],
	choices: ["p", "q"],
	requireReasons: true,
};
const matching: QuestionField = {
	question: "Match",
	type: "matching",
	items: ["one", "two"],
	choices: ["A", "B"],
	uniqueMatches: true,
	correctMatches: ["A", "B"],
};
const allTypes: QuestionField[] = [choice, text, blanks, classification, matching];

const withState = (q: QuestionField, patch: Partial<BlankState>): BlankState => ({ ...createAnswerState(q), ...patch });

describe("createAnswerState", () => {
	test("sizes blanks from the template and rows from items", () => {
		expect(createAnswerState(blanks).values).toEqual(["", ""]);
		expect(createAnswerState({ ...blanks, blanks: [{}, {}, {}] }).values).toHaveLength(3);
		expect(createAnswerState(matching).classifications).toEqual([
			{ item: "one", choice: "", reason: "" },
			{ item: "two", choice: "", reason: "" },
		]);
	});
});

describe("serializeQuestionAnswer", () => {
	test("choice and free text join selected then trimmed text", () => {
		expect(serializeQuestionAnswer(choice, withState(choice, { selected: ["a", "c"], text: "  more " }))).toBe("a, c, more");
		expect(serializeQuestionAnswer(text, withState(text, { text: "  hi  " }))).toBe("hi");
	});
	test("blanks drop empty values and join with a pipe", () => {
		expect(serializeQuestionAnswer(blanks, withState(blanks, { values: ["x", ""] }))).toBe("x");
		expect(serializeQuestionAnswer(blanks, withState(blanks, { values: ["x", "y"] }))).toBe("x | y");
	});
	test("classification appends trimmed reasons", () => {
		const state = withState(classification, {
			classifications: [
				{ item: "x", choice: "p", reason: " because " },
				{ item: "y", choice: "q", reason: "  " },
			],
		});
		expect(serializeQuestionAnswer(classification, state)).toBe("x: p - because\ny: q");
	});
	test("matching lists item: choice per line", () => {
		const state = withState(matching, {
			classifications: [
				{ item: "one", choice: "A", reason: "" },
				{ item: "two", choice: "", reason: "" },
			],
		});
		expect(serializeQuestionAnswer(matching, state)).toBe("one: A\ntwo: ");
	});
	test("missing state serializes to the empty string", () => {
		expect(serializeQuestionAnswer(choice, undefined)).toBe("");
	});
});

describe("isQuestionAnswered", () => {
	test("choice/text need a selection or non-blank text", () => {
		expect(isQuestionAnswered(choice, withState(choice, { selected: ["a"] }))).toBe(true);
		expect(isQuestionAnswered(text, withState(text, { text: "   " }))).toBe(false);
		expect(isQuestionAnswered(text, withState(text, { text: "x" }))).toBe(true);
	});
	test("blanks need every blank non-blank", () => {
		expect(isQuestionAnswered(blanks, withState(blanks, { values: ["x", ""] }))).toBe(false);
		expect(isQuestionAnswered(blanks, withState(blanks, { values: ["x", "y"] }))).toBe(true);
	});
	test("classification honours requireReasons", () => {
		const rows = [
			{ item: "x", choice: "p", reason: "" },
			{ item: "y", choice: "q", reason: "" },
		];
		expect(isQuestionAnswered(classification, withState(classification, { classifications: rows }))).toBe(false);
		expect(isQuestionAnswered({ ...classification, requireReasons: false }, withState(classification, { classifications: rows }))).toBe(true);
	});
	test("matching requires all rows and, when unique, distinct choices", () => {
		const dup = [
			{ item: "one", choice: "A", reason: "" },
			{ item: "two", choice: "A", reason: "" },
		];
		expect(isQuestionAnswered(matching, withState(matching, { classifications: dup }))).toBe(false);
		expect(isQuestionAnswered({ ...matching, uniqueMatches: false }, withState(matching, { classifications: dup }))).toBe(true);
	});
	test("missing question or state is unanswered", () => {
		expect(isQuestionAnswered(undefined, createAnswerState(choice))).toBe(false);
		expect(isQuestionAnswered(choice, undefined)).toBe(false);
	});
});

describe("matching scoring", () => {
	test("correctness compares case/space-insensitively", () => {
		expect(matchingCorrectness(matching, 0, " a ")).toBe("correct");
		expect(matchingCorrectness(matching, 0, "B")).toBe("wrong");
		expect(matchingCorrectness(matching, 0, "")).toBeNull();
	});
	test("keyed matching is auto-graded; others stay pending", () => {
		const state = withState(matching, {
			classifications: [
				{ item: "one", choice: "A", reason: "" },
				{ item: "two", choice: "A", reason: "" },
			],
		});
		expect(buildAnsweredQuestion(matching, state)).toMatchObject({ score: 0.5, grading: "auto" });
		expect(buildAnsweredQuestion(choice, withState(choice, { selected: ["a"] }))).toEqual({
			header: undefined,
			question: "Pick",
			answer: "a",
			score: undefined,
			grading: "pending",
		});
	});
});

describe("properties", () => {
	test("the empty answer state is unanswered and serializes consistently for every type", () => {
		for (const q of allTypes) {
			expect(isQuestionAnswered(q, createAnswerState(q))).toBe(false);
		}
	});

	const text1 = fc.string({ maxLength: 12 });
	const stateArb = fc.record({
		values: fc.array(text1, { maxLength: 4 }),
		selected: fc.array(text1, { maxLength: 4 }),
		text: text1,
		classifications: fc.array(fc.record({ item: text1, choice: text1, reason: text1 }), { maxLength: 4 }),
	});

	test("serialization is deterministic and never mutates state", () => {
		fc.assert(
			fc.property(fc.constantFrom(...allTypes), stateArb, (q, state) => {
				const snapshot = structuredClone(state);
				const first = serializeQuestionAnswer(q, state);
				expect(serializeQuestionAnswer(q, state)).toBe(first);
				expect(state).toEqual(snapshot);
			}),
		);
	});

	test("an answered question always serializes to something", () => {
		fc.assert(
			fc.property(fc.constantFrom(choice, text), stateArb, (q, state) => {
				if (isQuestionAnswered(q, state)) {
					expect(serializeQuestionAnswer(q, state).length).toBeGreaterThan(0);
				}
			}),
		);
	});
});

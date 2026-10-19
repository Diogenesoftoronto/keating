import { expect, test } from "bun:test";
import fc from "fast-check";
import { questionResponse } from "../src/question-response.js";
import { levenshtein } from "../src/text-distance.js";
import type { UiQuestion, UiQuestionGroupResponse } from "../src/ui.js";

// Frozen pre-extraction implementations serve as cross-platform behavior oracles.
function oldMobileResponse(
  question: UiQuestion,
  answer: string,
  selected: string[],
  blankAnswers: string[],
  rowSelections: string[],
  rowReasons: string[],
  order: string[],
): UiQuestionGroupResponse {
  if (question.kind === "ordering") return { questionId: question.id, type: "order", items: order };
  if (question.kind === "classification" || question.kind === "matching") return {
    questionId: question.id,
    type: "rows",
    rows: (question.items ?? []).map((item, index) => ({ item, optionId: rowSelections[index] ?? "", ...(question.requireReasons ? { reason: rowReasons[index] ?? "" } : {}) })),
  };
  if (question.kind === "blanks" || question.kind === "fill_in") return { questionId: question.id, type: "blanks", answers: blankAnswers };
  if (question.choices) return { questionId: question.id, type: "choice", optionIds: selected, ...(question.allowText ? { text: answer } : {}) };
  return { questionId: question.id, type: "text", answer };
}
function oldWebResponse(node: UiQuestion, answer: string, selected: string[], blankAnswers: string[], rowSelections: string[], rowReasons: string[], order: string[] = []): UiQuestionGroupResponse {
	if (node.kind === "ordering") return { questionId: node.id, type: "order", items: order };
	if (node.kind === "classification" || node.kind === "matching") return {
		questionId: node.id,
		type: "rows",
		rows: (node.items ?? []).map((item, index) => ({ item, optionId: rowSelections[index] ?? "", ...(node.requireReasons ? { reason: rowReasons[index] ?? "" } : {}) })),
	};
	if (node.kind === "blanks" || node.kind === "fill_in") return { questionId: node.id, type: "blanks", answers: blankAnswers };
	if (node.choices) return { questionId: node.id, type: "choice", optionIds: selected, ...(node.allowText ? { text: answer } : {}) };
	return { questionId: node.id, type: "text", answer };
}
const strings = fc.array(fc.string(), { maxLength: 8 });
const question: fc.Arbitrary<UiQuestion> = fc.record({
  id: fc.string(), prompt: fc.string(),
  kind: fc.option(fc.constantFrom("ordering", "classification", "matching", "blanks", "fill_in", "choice", "text", "multi_select", "slider", "short_answer", "true_false", "transfer", "multiple_choice", "dropdown"), { nil: undefined }),
  items: fc.option(strings, { nil: undefined }),
  choices: fc.option(fc.array(fc.record({ id: fc.string(), label: fc.string() }), { maxLength: 8 }), { nil: undefined }),
  requireReasons: fc.option(fc.boolean(), { nil: undefined }),
  allowText: fc.option(fc.boolean(), { nil: undefined }),
});

test("question serialization matches both prior platforms for every answer shape", () => {
  fc.assert(fc.property(question, fc.string(), strings, strings, strings, strings, strings,
    (q, answer, selected, blanks, rows, reasons, order) => {
      const actual = questionResponse(q, answer, selected, blanks, rows, reasons, order);
      expect(actual).toEqual(oldMobileResponse(q, answer, selected, blanks, rows, reasons, order));
      expect(actual).toEqual(oldWebResponse(q, answer, selected, blanks, rows, reasons, order));
      expect(questionResponse(q, answer, selected, blanks, rows, reasons)).toEqual(oldWebResponse(q, answer, selected, blanks, rows, reasons));
    }), { numRuns: 1000 });
});

test("edit distance is a bounded metric over UTF-16 strings", () => {
  const text = fc.oneof(fc.string({ maxLength: 24 }), fc.array(fc.integer({ min: 0, max: 65535 }), { maxLength: 24 }).map(xs => String.fromCharCode(...xs)));
  fc.assert(fc.property(text, text, text, (a, b, c) => {
    const d = levenshtein(a, b);
    expect(levenshtein(a, a)).toBe(0);
    expect(d).toBe(levenshtein(b, a));
    expect(d).toBeGreaterThanOrEqual(Math.abs(a.length - b.length));
    expect(d).toBeLessThanOrEqual(Math.max(a.length, b.length));
    expect(d).toBeLessThanOrEqual(levenshtein(a, c) + levenshtein(c, b));
  }), { numRuns: 500 });
});

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QuestionCompletionReview } from "../components/question/QuestionCompletionReview";
import { createAnswerState } from "../components/question/question-answers";
import type { QuestionField } from "../components/QuestionRenderer";

describe("QuestionCompletionReview", () => {
	test("renders plain answers with the header and completion mark", () => {
		const q: QuestionField = { header: "Goal", question: "Pick", choices: ["a"], allowText: false };
		const state = { ...createAnswerState(q), selected: ["a"] };
		const html = renderToStaticMarkup(<QuestionCompletionReview questions={[q]} answers={[state]} />);
		expect(html).toContain("Round complete");
		expect(html).toContain("Review answers");
		expect(html).toContain("Goal: ");
		expect(html).toContain("<strong>a</strong>");
	});

	test("shows the correct answer next to a wrong keyed match", () => {
		const q: QuestionField = {
			question: "Match",
			type: "matching",
			items: ["one", "two"],
			choices: ["A", "B"],
			correctMatches: ["A", "B"],
		};
		const state = {
			...createAnswerState(q),
			classifications: [
				{ item: "one", choice: "A", reason: "" },
				{ item: "two", choice: "A", reason: "" },
			],
		};
		const html = renderToStaticMarkup(<QuestionCompletionReview questions={[q]} answers={[state]} />);
		expect(html).toContain("Correct: B");
		expect(html).not.toContain("Correct: A");
	});
});

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QuestionCard } from "../components/quiz/QuestionCard";
import { QuizNavigation } from "../components/quiz/QuizNavigation";
import { QuizResultsView } from "../components/quiz/QuizResultsView";
import type { Quiz, QuizQuestion } from "../keating/core";

const noop = () => {};
const base = (extra: Partial<QuizQuestion>): QuizQuestion =>
	({ id: "q1", question: "Pick one", type: "multiple_choice", level: "recall", correctAnswer: "B", options: ["A", "B"], explanation: "Because B.", ...extra }) as QuizQuestion;

function card(q: QuizQuestion, answer: string, revealed: boolean) {
	return renderToStaticMarkup(
		<QuestionCard q={q} index={0} answer={answer} onChange={noop} revealed={revealed} bookmarked={false} onToggleBookmark={noop} onSpeak={noop} />,
	);
}

describe("QuestionCard", () => {
	test("live multiple choice shows tiles and the action buttons, no result badge", () => {
		const html = card(base({}), "", false);
		expect(html).toContain("Pick one");
		expect(html).toContain("activity-answer-grid");
		expect(html).toContain('aria-label="Read question aloud"');
		expect(html).toContain('aria-label="Bookmark question"');
		expect(html).not.toContain("Correct");
	});

	test("revealed wrong answer shows Incorrect, no partial credit for all-or-nothing types", () => {
		const html = card(base({}), "A", true);
		expect(html).toContain("Incorrect");
		expect(html).not.toContain("Partial credit");
	});

	test("revealed multi-select with a partial score shows the partial credit badge", () => {
		const q = base({ type: "multi_select", correctAnswers: ["A", "B"], options: ["A", "B", "C", "D"], correctAnswer: "A,B" });
		expect(card(q, "A", true)).toContain("Partial credit: 50%");
	});

	test("revealed short answer shows the key, the pending-review note and the rubric", () => {
		const q = base({ type: "short_answer", correctAnswer: "friction", rubric: "Mention the wall", options: undefined });
		const html = card(q, "friction", true);
		expect(html).toContain("friction");
		expect(html).toContain("Teacher review pending");
		expect(html).toContain("Mention the wall");
		expect(html).toContain('aria-label="Your answer"');
	});

	test("slider and dropdown use the question as their label", () => {
		expect(card(base({ type: "slider", correctAnswer: "5", min: 0, max: 10, options: undefined }), "5", false)).toContain('type="range"');
		expect(card(base({ type: "dropdown" }), "", false)).toContain("Select an answer...");
	});
});

describe("QuizNavigation", () => {
	const props = { isFirst: false, isLast: false, isPending: false, currentAnswered: true, allAnswered: false, submitted: false, unansweredCount: 2, onPrev: noop, onNext: noop, onFinish: noop };

	test("middle question offers lock-in or skip", () => {
		expect(renderToStaticMarkup(<QuizNavigation {...props} />)).toContain("Lock in &amp; next");
		expect(renderToStaticMarkup(<QuizNavigation {...props} currentAnswered={false} />)).toContain("Skip for now");
	});

	test("last question shows remaining count and disables finish until all answered", () => {
		const html = renderToStaticMarkup(<QuizNavigation {...props} isLast />);
		expect(html).toContain("2 left");
		expect(html).toContain("2 unanswered");
		expect(html).toContain("disabled");
		const done = renderToStaticMarkup(<QuizNavigation {...props} isLast allAnswered unansweredCount={0} />);
		expect(done).toContain("Finish round");
	});

	test("first question disables back", () => {
		expect(renderToStaticMarkup(<QuizNavigation {...props} isFirst />)).toMatch(/<button[^>]*disabled[^>]*>.*Back/s);
	});
});

describe("QuizResultsView", () => {
	test("summarizes the round, flags and retake", () => {
		const q = base({});
		const quiz = { topic: "T", slug: "t", questions: [q] } as unknown as Quiz;
		const html = renderToStaticMarkup(
			<QuizResultsView
				normalizedQuiz={quiz}
				visibleQuestions={[q]}
				answers={{ q1: "B" }}
				totalScored={1}
				rawScore={1}
				percent={100}
				partialCreditPoints={1}
				pendingReviewCount={0}
				finalTotalMs={65_000}
				finalPerQuestionMs={{ q1: 5000 }}
				timedOutIds={new Set(["q1"])}
				bookmarkIds={["q1"]}
				reframeModes={{}}
				fetchedStats={null}
				onChangeAnswer={noop}
				onToggleBookmark={noop}
				onSpeak={noop}
				onRequestRemediation={noop}
				onRetake={noop}
			/>,
		);
		expect(html).toContain("Clean sweep");
		expect(html).toContain("1 of 1 correct");
		expect(html).toContain("100% objective score");
		expect(html).toContain("1 timed out");
		expect(html).toContain("1 flagged");
		expect(html).toContain("Retake");
	});
});

describe("QuizRenderer wiring", () => {
	test("first render shows the topic, first question, progress and a disabled-free next button", async () => {
		const { QuizRenderer } = await import("../components/QuizRenderer");
		const quiz = {
			topic: "Fluids",
			slug: "fluids",
			questions: [base({ id: "q1", question: "First?" }), base({ id: "q2", question: "Second?" })],
		} as unknown as Quiz;
		const html = renderToStaticMarkup(<QuizRenderer quiz={quiz} topicStats={null} defaultShaderPreset="still" />);
		expect(html).toContain('aria-label="Quiz: Fluids"');
		expect(html).toContain("First?");
		expect(html).not.toContain("Second?");
		expect(html).toContain("Skip for now");
		expect(html).toContain('aria-label="Quiz questions"');
	});

	test("an empty quiz renders the empty state", async () => {
		const { QuizRenderer } = await import("../components/QuizRenderer");
		const html = renderToStaticMarkup(<QuizRenderer quiz={{ topic: "T", slug: "t", questions: [] } as unknown as Quiz} topicStats={null} />);
		expect(html).toContain("No quiz questions yet.");
	});
});

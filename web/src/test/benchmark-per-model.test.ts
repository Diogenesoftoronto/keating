import { test, expect } from "bun:test";
import {
	benchmarkPerModel,
	benchModelLabel,
	extractSessionTurnOutcomes,
	perModelBreakdownToMarkdown,
	quizRecordsToOutcomes,
	runBenchmarkSuite,
	DEFAULT_WEIGHTS,
	DEFAULT_POLICY,
} from "../keating/core";

test("extractSessionTurnOutcomes attributes inferred signals to the session model", () => {
	const outcomes = extractSessionTurnOutcomes([
		{
			id: "s1",
			title: "derivative",
			model: { provider: "anthropic", id: "claude-sonnet-5", name: "Claude Sonnet 5" },
			messages: [
				{ role: "user", content: "I am confused about why the derivative is a limit." },
				{ role: "assistant", content: "Let's rebuild it from secants." },
				{ role: "user", content: "got it, that makes sense now" },
			],
		},
	]);

	expect(outcomes.length).toBe(2);
	expect(outcomes[0]!.model).toBe("anthropic/Claude Sonnet 5");
	expect(outcomes[0]!.feedbackSignal).toBe("confused");
	expect(outcomes[1]!.feedbackSignal).toBe("thumbs-up");
});

test("quizRecordsToOutcomes converts graded quizzes and maps sessions to models", () => {
	const modelBySessionId = new Map([["s1", "openai/gpt-5"]]);
	const outcomes = quizRecordsToOutcomes(
		[
			{ topic: "derivative", score: 4, totalQuestions: 5, sessionId: "s1" },
			{ topic: "derivative", score: 1, totalQuestions: 5 },
			{ topic: "derivative", score: 3, totalQuestions: 0 },
		],
		modelBySessionId
	);

	expect(outcomes.length).toBe(2);
	expect(outcomes[0]!.quizScore).toBeCloseTo(0.8);
	expect(outcomes[0]!.model).toBe("openai/gpt-5");
	expect(outcomes[0]!.feedbackSignal).toBe("thumbs-up");
	expect(outcomes[1]!.model).toBe("unattributed");
	expect(outcomes[1]!.feedbackSignal).toBe("thumbs-down");
});

test("benchmarkPerModel groups outcomes by model and ranks by score", () => {
	const strong = quizRecordsToOutcomes(
		[{ topic: "derivative", score: 5, totalQuestions: 5, sessionId: "a" }],
		new Map([["a", "model-strong"]])
	);
	const weak = quizRecordsToOutcomes(
		[{ topic: "derivative", score: 1, totalQuestions: 5, sessionId: "b" }],
		new Map([["b", "model-weak"]])
	);

	const breakdown = benchmarkPerModel(DEFAULT_POLICY, [...strong, ...weak]);

	expect(breakdown.length).toBe(2);
	expect(breakdown[0]!.model).toBe("model-strong");
	expect(breakdown[0]!.overallScore).toBeGreaterThan(breakdown[1]!.overallScore);
	expect(breakdown[0]!.quizAverage).toBe(1);

	const markdown = perModelBreakdownToMarkdown(breakdown);
	expect(markdown).toContain("## Per-Model Results");
	expect(markdown).toContain("model-strong");
	expect(markdown).toContain("model-weak");
});

test("quiz outcomes raise the browser benchmark score", () => {
	const low = runBenchmarkSuite(
		DEFAULT_POLICY,
		"derivative",
		20260401,
		3,
		DEFAULT_WEIGHTS,
		quizRecordsToOutcomes([{ topic: "derivative", score: 1, totalQuestions: 5 }])
	);
	const high = runBenchmarkSuite(
		DEFAULT_POLICY,
		"derivative",
		20260401,
		3,
		DEFAULT_WEIGHTS,
		quizRecordsToOutcomes([{ topic: "derivative", score: 5, totalQuestions: 5 }])
	);

	expect(high.overallScore).toBeGreaterThan(low.overallScore);
});

test("benchModelLabel falls back gracefully", () => {
	expect(benchModelLabel(undefined)).toBe("unattributed");
	expect(benchModelLabel({ provider: "anthropic" })).toBe("anthropic");
	expect(benchModelLabel({ id: "gpt-5" })).toBe("gpt-5");
});

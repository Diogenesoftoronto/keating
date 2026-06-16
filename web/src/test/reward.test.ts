import { describe, expect, it } from "bun:test";
import {
	JUDGE_BLEND,
	KTO_BAD_THRESHOLD,
	buildGrpoPrompts,
	buildKtoExamples,
	buildPreferencePairs,
	buildDpoChatExamples,
	buildDpoTextExamples,
	applyJudgeScores,
	computeRewardStats,
	computeSessionRewardedTurns,
	judgeComposite,
	type RewardedTurn,
} from "../keating/reward";
import { DEFAULT_WEIGHTS } from "../keating/core";

function turn(overrides: Partial<RewardedTurn>): RewardedTurn {
	return {
		sessionId: "s1",
		context: [{ role: "user", content: "Teach recursion" }],
		completion: "Recursion uses a base case.",
		reward: 0.5,
		signals: {},
		scored: false,
		...overrides,
	};
}

describe("reward annotated turns", () => {
	it("joins explicit feedback by messageId timestamp scoped to session", () => {
		const turns = computeSessionRewardedTurns({
			sessionId: "s1",
			title: "recursion",
			messages: [
				{ role: "user", content: "u1", timestamp: 1000 },
				{ role: "assistant", content: "a1 long enough", timestamp: 2000 },
				{ role: "user", content: "next neutral", timestamp: 3000 },
				{ role: "assistant", content: "a2 long enough", timestamp: 4000 },
			],
			feedback: [{ id: "f1", topic: "recursion", signal: "thumbs-down", createdAt: 2500, messageId: "assistant-3-2000", sessionId: "s1" }],
			quizResults: [],
			usedFeedbackIds: new Set(),
		});
		expect(turns[0].signals.explicit?.joinedBy).toBe("messageId");
		expect(turns[0].reward).toBeLessThanOrEqual(KTO_BAD_THRESHOLD);
		expect(turns[1].scored).toBe(false);
	});

	it("uses timestamp-window fallback only before the next user turn", () => {
		const messages = [
			{ role: "user" as const, content: "u1", timestamp: 1000 },
			{ role: "assistant" as const, content: "a1 long enough", timestamp: 2000 },
			{ role: "user" as const, content: "neutral", timestamp: 3000 },
		];
		const joined = computeSessionRewardedTurns({
			sessionId: "s1",
			messages,
			feedback: [{ id: "f1", topic: "x", signal: "thumbs-up", createdAt: 2500 }],
			quizResults: [],
			usedFeedbackIds: new Set(),
		});
		const late = computeSessionRewardedTurns({
			sessionId: "s1",
			messages,
			feedback: [{ id: "f2", topic: "x", signal: "thumbs-up", createdAt: 3500 }],
			quizResults: [],
			usedFeedbackIds: new Set(),
		});
		expect(joined[0].signals.explicit?.joinedBy).toBe("timestampWindow");
		expect(late[0].signals.explicit).toBeUndefined();
	});

	it("infers next-turn learner signals", () => {
		for (const [text, expected] of [
			["I'm still confused", 0.35],
			["got it, makes sense", 0.85],
			["tell me another fact", null],
		] as const) {
			const turns = computeSessionRewardedTurns({
				sessionId: "s1",
				title: "recursion",
				messages: [
					{ role: "user", content: "teach", timestamp: 1000 },
					{ role: "assistant", content: "answer", timestamp: 2000 },
					{ role: "user", content: text, timestamp: 3000 },
				],
				feedback: [],
				quizResults: [],
				usedFeedbackIds: new Set(),
			});
			if (expected === null) expect(turns[0].scored).toBe(false);
			else expect(turns[0].reward).toBeCloseTo(expected);
		}
	});

	it("joins quiz results by sessionId to the last prior assistant and blends present signals", () => {
		const turns = computeSessionRewardedTurns({
			sessionId: "s1",
			messages: [
				{ role: "user", content: "u1", timestamp: 1000 },
				{ role: "assistant", content: "a1", timestamp: 2000 },
			],
			feedback: [{ id: "f1", topic: "x", signal: "thumbs-up", createdAt: 2100, messageId: "assistant-0-2000", sessionId: "s1" }],
			quizResults: [{ id: "q1", topic: "x", createdAt: 2500, score: 1, weightedScore: 0.5, totalQuestions: 2, sessionId: "s1" }],
			usedFeedbackIds: new Set(),
		});
		expect(turns[0].signals.quiz?.joinedBy).toBe("sessionId");
		expect(turns[0].reward).toBeCloseTo(((0.85 * 0.6) + (0.5 * 0.25)) / 0.85);
	});

	it("builds KTO examples from thresholds and drops mid-band or unscored turns", () => {
		const examples = buildKtoExamples([
			turn({ reward: 0.85, scored: true }),
			turn({ reward: 0.5, scored: true }),
			turn({ reward: 0.15, scored: true }),
			turn({ reward: 0.1, scored: false }),
		]);
		expect(examples.map((example) => example.label)).toEqual([true, false]);
	});

	it("builds all preference pairs for identical prompts with a large enough reward gap", () => {
		const context = [{ role: "user" as const, content: "same" }];
		const pairs = buildPreferencePairs([
			turn({ context, completion: "good", reward: 0.85, scored: true }),
			turn({ context, completion: "ok", reward: 0.5, scored: true }),
			turn({ context, completion: "bad", reward: 0.2, scored: true }),
		]);
		expect(buildDpoChatExamples(pairs)).toEqual([
			{ prompt: context, chosen: "good", rejected: "ok" },
			{ prompt: context, chosen: "good", rejected: "bad" },
			{ prompt: context, chosen: "ok", rejected: "bad" },
		]);
		expect(pairs.map((pair) => pair.rewardGap)).toEqual([0.35, 0.6499999999999999, 0.3]);
		expect(buildPreferencePairs([
			turn({ context, completion: "a", reward: 0.6, scored: true }),
			turn({ context, completion: "b", reward: 0.4, scored: true }),
		])).toEqual([]);
	});

	it("formats text-prompt DPO examples for trainers that do not accept chat arrays", () => {
		const context = [
			{ role: "system" as const, content: "persona" },
			{ role: "user" as const, content: "same" },
		];
		const pairs = buildPreferencePairs([
			turn({ context, completion: "good", reward: 0.85, scored: true }),
			turn({ context, completion: "bad", reward: 0.2, scored: true }),
		]);
		expect(buildDpoTextExamples(pairs)).toEqual([{
			prompt: "System: persona\n\nUser: same",
			chosen: "good",
			rejected: "bad",
		}]);
	});

	it("keeps full prior context with persona in order", () => {
		const turns = computeSessionRewardedTurns({
			sessionId: "s1",
			persona: "system persona",
			messages: [
				{ role: "user", content: "u1", timestamp: 1000 },
				{ role: "assistant", content: "a1", timestamp: 2000 },
				{ role: "user", content: "u2", timestamp: 3000 },
				{ role: "assistant", content: "a2", timestamp: 4000 },
				{ role: "user", content: "u3", timestamp: 5000 },
				{ role: "assistant", content: "a3", timestamp: 6000 },
			],
			feedback: [],
			quizResults: [],
			usedFeedbackIds: new Set(),
		});
		expect(turns[2].context).toEqual([
			{ role: "system", content: "system persona" },
			{ role: "user", content: "u1" },
			{ role: "assistant", content: "a1" },
			{ role: "user", content: "u2" },
			{ role: "assistant", content: "a2" },
			{ role: "user", content: "u3" },
		]);
	});

	it("deduplicates GRPO prompts by context", () => {
		const shared = [{ role: "user" as const, content: "same" }];
		expect(buildGrpoPrompts([
			turn({ context: shared }),
			turn({ context: shared, completion: "retry" }),
			turn({ context: [{ role: "user", content: "different" }] }),
		])).toHaveLength(2);
	});

	it("summarizes reward stats", () => {
		const stats = computeRewardStats([
			turn({ reward: 0.1, scored: true, signals: { explicit: { score: 0.15 } } }),
			turn({ reward: 0.55, scored: true, signals: { inferred: { score: 0.85 }, quiz: { score: 0.5 } } }),
			turn({ reward: 0.9, scored: false }),
		]);
		expect(stats.scored).toBe(2);
		expect(stats.unscored).toBe(1);
		expect(stats.bySource).toEqual({ explicit: 1, inferred: 1, quiz: 1, judge: 0 });
		expect(stats.distribution).toEqual([1, 0, 1, 0, 1]);
	});

	it("applies judge scores with blended reward math", () => {
		const score = { masteryGain: 1, retention: 1, engagement: 1, transfer: 1, confusion: 0 };
		const composite = judgeComposite(score);
		expect(composite).toBe(DEFAULT_WEIGHTS.masteryGain + DEFAULT_WEIGHTS.retention + DEFAULT_WEIGHTS.engagement + DEFAULT_WEIGHTS.transfer);
		const turns = [
			turn({ reward: 0.5, scored: true }),
			turn({ reward: 0.2, scored: true }),
		];
		applyJudgeScores(turns, [score, null]);
		expect(turns[0].reward).toBeCloseTo((1 - JUDGE_BLEND) * 0.5 + JUDGE_BLEND * composite);
		expect(turns[0].signals.judge?.score).toBe(composite);
		expect(turns[1].reward).toBe(0.2);
	});
});

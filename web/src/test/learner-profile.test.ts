import { describe, expect, it } from "bun:test";

import { deriveLearnerProfile } from "../keating/learner-profile";

describe("derived learner profile", () => {
	it("prioritizes demonstrated performance over positive sentiment", () => {
		const profile = deriveLearnerProfile([
			{ topic: "recursion", kind: "feedback", score: 0.85, weight: 0.25, createdAt: 1 },
			{ topic: "recursion", kind: "feedback", score: 0.35, weight: 0.25, createdAt: 2, note: "Lost at the base case." },
			{ topic: "recursion", kind: "quiz", score: 0.2, weight: 1.2, createdAt: 3 },
		]);

		expect(profile.topics[0]).toMatchObject({
			topic: "recursion",
			status: "needs-review",
		});
		expect(profile.topics[0]?.mastery).toBeLessThan(0.4);
		expect(profile.topics[0]?.reportedChallenges).toEqual(["Lost at the base case."]);
		expect(profile.weaknesses).toEqual(["recursion"]);
	});

	it("keeps retention distinct and gives long-interval review more confidence", () => {
		const profile = deriveLearnerProfile([
			{ topic: "dns", kind: "review", score: 0.9, weight: 1.2, createdAt: 10 },
			{ topic: "dns", kind: "review", score: 0.75, weight: 0.8, createdAt: 20 },
		]);

		expect(profile.topics[0]?.retention).toBeCloseTo(0.84);
		expect(profile.topics[0]?.mastery).toBeCloseTo(0.84);
		expect(profile.topics[0]?.status).toBe("strong");
	});

	it("does not make unobserved topics look strong", () => {
		expect(deriveLearnerProfile([])).toEqual({ topics: [], strengths: [], weaknesses: [] });
	});

	it("keeps a single excellent result provisional rather than calling it a strength", () => {
		const profile = deriveLearnerProfile([
			{ topic: "calculus", kind: "quiz", score: 1, weight: 1.2, createdAt: 1 },
		]);

		expect(profile.topics[0]?.status).toBe("developing");
		expect(profile.strengths).toEqual([]);
		expect(profile.weaknesses).toEqual([]);
	});
});

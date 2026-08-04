import { describe, expect, it } from "bun:test";

import { buildComingUpQueue } from "../keating/coming-up";
import type { FlashcardDeck, LearnerState, Verification } from "../keating/storage";

const NOW = Date.UTC(2026, 7, 3, 12);
const DAY = 86_400_000;

function learnerState(overrides: Partial<LearnerState> = {}): LearnerState {
	return {
		schemaVersion: 3,
		topicsExplored: [],
		feedbackHistory: [],
		strengths: [],
		weaknesses: [],
		topicProfiles: [],
		sessionsCount: 0,
		sessions: [],
		profileBeliefs: [],
		studyPriorities: [],
		...overrides,
	};
}

function deck(id: string, dueOffsets: number[]): FlashcardDeck {
	return {
		id,
		topic: id === "algebra" ? "Linear algebra" : "Calculus",
		slug: id,
		title: `${id} deck`,
		cards: dueOffsets.map((offset, index) => ({
			id: `${id}-${index}`,
			front: `Question ${index}`,
			back: `Answer ${index}`,
			srs: { ease: 2.5, intervalDays: 1, reps: 1, lapses: 0, dueAt: NOW + offset, lastReviewedAt: NOW - DAY, lastRating: 2 },
			createdAt: NOW - DAY,
			updatedAt: NOW - DAY,
		})),
		createdAt: NOW - DAY,
		updatedAt: NOW - DAY,
	};
}

describe("Coming Up queue", () => {
	it("recommends due work for Focus and sorts overdue work first", () => {
		const queue = buildComingUpQueue({
			decks: [deck("calculus", [-100]), deck("algebra", [-2 * DAY, 2 * DAY])],
			verifications: [],
			learnerState: learnerState(),
			now: NOW,
		});

		expect(queue.lanes.focus.map((item) => item.targetId)).toEqual(["algebra", "calculus"]);
		expect(queue.dueCardCount).toBe(2);
		expect(queue.overdueCardCount).toBe(1);
		expect(queue.dueDeckIds).toEqual(["algebra", "calculus"]);
	});

	it("keeps overdue evidence visible when the learner moves it to Low priority", () => {
		const queue = buildComingUpQueue({
			decks: [deck("algebra", [-3 * DAY])],
			verifications: [],
			learnerState: learnerState({
				studyPriorities: [{ targetId: "algebra", targetType: "deck", priority: "low", updatedAt: NOW }],
			}),
			now: NOW,
		});

		expect(queue.lanes.low[0]).toMatchObject({ targetId: "algebra", dueCount: 1, overdueCount: 1, prioritySource: "learner" });
		expect(queue.dueDeckIds).toEqual(["algebra"]);
	});

	it("adds open checks and uncovered needs-review topics without duplicating deck topics", () => {
		const checks: Verification[] = [{ id: "check-1", topic: "Stoicism", checklist: "- Explain the dichotomy of control", completed: false, createdAt: NOW - 8 * DAY }];
		const queue = buildComingUpQueue({
			decks: [deck("algebra", [2 * DAY])],
			verifications: checks,
			learnerState: learnerState({
				topicProfiles: [
					{ topic: "Linear algebra", mastery: 0.3, retention: null, confidence: 0.5, evidenceCount: 2, lastEvidenceAt: NOW, reportedChallenges: ["matrix multiplication"], status: "needs-review" },
					{ topic: "Poetry", mastery: 0.2, retention: 0.3, confidence: 0.5, evidenceCount: 3, lastEvidenceAt: NOW, reportedChallenges: [], status: "needs-review" },
				],
			}),
			now: NOW,
		});

		expect(queue.items.filter((item) => item.topic === "Linear algebra")).toHaveLength(1);
		expect(queue.items.some((item) => item.id === "topic:Poetry")).toBe(true);
		expect(queue.items.find((item) => item.id === "verification:check-1")?.priority).toBe("focus");
	});
});

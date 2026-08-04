import { describe, expect, it } from "bun:test";
import {
	buildLearnerProfileCoverageGaps,
	composeSessionStartSystemPrompt,
	runSessionStartHooks,
	type SessionStartHook,
} from "../keating/session-start-hooks";

describe("session-start hooks", () => {
	it("runs hooks in order and isolates individual failures", async () => {
		const calls: string[] = [];
		const hooks: SessionStartHook[] = [
			{ id: "profile", run: async () => { calls.push("profile"); return "Profile context"; } },
			{ id: "broken", run: async () => { calls.push("broken"); throw new Error("offline"); } },
			{ id: "goals", run: async () => { calls.push("goals"); return "Goal context"; } },
		];
		const context = await runSessionStartHooks({} as any, hooks);
		expect(calls).toEqual(["profile", "broken", "goals"]);
		expect(context).toContain("Profile context");
		expect(context).toContain("Goal context");
		expect(context).not.toContain("offline");
	});

	it("returns no appendix when hooks have no context", async () => {
		const context = await runSessionStartHooks({} as any, [
			{ id: "empty", run: async () => "" },
		]);
		expect(context).toBe("");
	});

	it("loads the complete learner profile, evidence, flashcards, and every goal automatically", async () => {
		let sessionStarts = 0;
		const now = Date.now();
		const storage = {
			recordSessionStart: async () => { sessionStarts += 1; },
			getGoals: async () => [
				{
					id: "goal-active",
					title: "Ship a compiler",
					status: "active",
					steps: [{ id: "step-1", title: "Parse expressions", status: "in_progress" }],
				},
				{
					id: "goal-completed",
					title: "Finish the tokenizer",
					status: "completed",
					steps: [{ id: "step-old", title: "Tokenize numbers", status: "done" }],
				},
			],
			getLearnerState: async () => ({
			schemaVersion: 3,
				sessionsCount: 3,
				topicsExplored: ["syntax", "operator precedence"],
				feedbackHistory: [{
					id: "feedback-oldest",
					topic: "syntax",
					signal: "thumbs-up",
					createdAt: now - 10_000,
					evidence: "The earliest feedback must not be sliced away.",
				}],
				strengths: ["syntax"],
				weaknesses: ["precedence"],
				lastSessionAt: now - 1_000,
				sessions: [{
					id: "session-oldest",
					startedAt: now - 20_000,
					endedAt: now - 19_000,
					topicsCovered: ["syntax"],
				}],
				profileBeliefs: [{
					id: "belief-1",
					category: "communication-preference",
					value: "prefers concise explanations followed by code",
					source: "explicit",
					confidence: 1,
					evidence: "Please keep it concise and show code.",
					createdAt: now,
					updatedAt: now,
				}],
				topicProfiles: [{
					topic: "operator precedence",
					status: "needs-review",
					mastery: 0.4,
					retention: 0.3,
					confidence: 0.7,
					evidenceCount: 2,
					lastEvidenceAt: now,
					reportedChallenges: [],
				}],
				studyPriorities: [{
					targetId: "deck-1",
					targetType: "deck",
					priority: "focus",
					updatedAt: now,
				}],
			}),
			getQuizResults: async () => [{
				id: "quiz-oldest",
				topic: "syntax",
				createdAt: now - 5_000,
				score: 4,
				totalQuestions: 5,
				answers: { "quiz-question-1": "The learner's complete saved answer." },
				partialCredits: { "quiz-question-1": 1 },
				timing: { totalMs: 12_000, perQuestionMs: { "quiz-question-1": 12_000 } },
				flaggedQuestionIds: ["quiz-question-1"],
				pendingGradeQuestionIds: ["quiz-open-ended"],
			}],
			getQuestionChecks: async () => [{
				id: "check-pending",
				topic: "operator precedence",
				question: "Why does multiplication bind first?",
				answer: "Because of the grammar.",
				grading: "pending",
				createdAt: now,
			}],
			getCardReviews: async () => [{
				id: "review-1",
				deckId: "deck-1",
				cardId: "card-reviewed",
				topic: "syntax",
				slug: "syntax",
				rating: 2,
				appliedIntervalDays: 6,
				easeAfter: 2.5,
				createdAt: now,
			}],
			getDecks: async () => [{
				id: "deck-1",
				topic: "syntax",
				slug: "syntax",
				title: "Syntax deck",
				cards: [
					{ id: "card-reviewed", front: "Reviewed", back: "Yes", srs: {}, createdAt: now, updatedAt: now },
					{ id: "card-unreviewed", front: "Fresh", back: "No", srs: {}, createdAt: now, updatedAt: now },
				],
				createdAt: now,
				updatedAt: now,
			}],
		};

		const context = await runSessionStartHooks(storage as any);
		expect(sessionStarts).toBe(1);
		expect(context).toContain("operator precedence");
		expect(context).toContain("prefers concise explanations followed by code");
		expect(context).toContain("Parse expressions");
		expect(context).toContain("goal-completed");
		expect(context).toContain("feedback-oldest");
		expect(context).toContain("session-oldest");
		expect(context).toContain("quiz-oldest");
		expect(context).toContain("The learner's complete saved answer.");
		expect(context).toContain("check-pending");
		expect(context).toContain("card-unreviewed");
		expect(context).toContain('"priority":"focus"');
		expect(context).toContain("Never change or misrepresent the evidence-based flashcard due dates");
		expect(context).toContain('"ungradedQuizQuestionIds":["quiz-oldest:quiz-open-ended"]');
		expect(context).toContain('"ungradedQuestionCheckIds":["check-pending"]');
		expect(context).toContain('"cardsWithoutReviewEvidence":["deck-1:card-unreviewed"]');
		expect(context).not.toContain("capability");
	});

	it("reports absent evidence without dropping the durable records that do exist", () => {
		const gaps = buildLearnerProfileCoverageGaps({
			learnerState: {
				topicsExplored: ["known", "unmeasured"],
				topicProfiles: [{
					topic: "known",
					mastery: 0.8,
					retention: null,
					confidence: 0.5,
					evidenceCount: 1,
					lastEvidenceAt: 1,
					reportedChallenges: [],
					status: "developing",
				}],
			profileBeliefs: [],
			studyPriorities: [],
			} as any,
			goals: [{ id: "empty-goal", steps: [] }] as any,
			quizResults: [{ id: "quiz-result", pendingGradeQuestionIds: ["pending-quiz-question"] }] as any,
			questionChecks: [{ id: "pending-check" }] as any,
			cardReviews: [],
			decks: [{ id: "fresh-deck", cards: [{ id: "fresh-card" }] }] as any,
		});

		expect(gaps).toEqual({
			missingProfileBeliefCategories: [
				"motivation",
				"communication-preference",
				"learning-preference",
				"interest",
			],
			topicsWithoutPerformanceEvidence: ["known", "unmeasured"],
			topicsWithoutRetentionEvidence: ["known", "unmeasured"],
			ungradedQuizQuestionIds: ["quiz-result:pending-quiz-question"],
			ungradedQuestionCheckIds: ["pending-check"],
			goalsWithoutCurriculumSteps: ["empty-goal"],
			cardsWithoutReviewEvidence: ["fresh-deck:fresh-card"],
		});
	});

	it("composes session context into rebuilt prompts without duplication", () => {
		const firstContext = "\n\n## Session-start context (loaded automatically)\n\nProfile one";
		const secondContext = "\n\n## Session-start context (loaded automatically)\n\nProfile two";
		const initial = composeSessionStartSystemPrompt("Persona one\n\nProtocol", firstContext);
		const rebuilt = composeSessionStartSystemPrompt(`${initial}\n\nSpeech guidance`, secondContext);

		expect(initial).toContain("Profile one");
		expect(rebuilt).toContain("Profile two");
		expect(rebuilt).not.toContain("Profile one");
		expect(rebuilt.match(/## Session-start context/g)?.length).toBe(1);
	});

	it("leaves a rebuilt prompt clean before session context is available", () => {
		expect(composeSessionStartSystemPrompt("Persona\n\nProtocol\n", "")).toBe("Persona\n\nProtocol");
	});

	it("does not erase an already composed appendix when context is temporarily unavailable", () => {
		const composed = "Persona\n\n## Session-start context (loaded automatically)\n\nProfile";
		expect(composeSessionStartSystemPrompt(composed, "")).toBe(composed);
	});
});

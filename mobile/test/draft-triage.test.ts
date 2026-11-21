import { expect, test } from "bun:test";
import type { JudgementCaller, JudgementRequest, PortableLearnerData } from "@keating/learner-contracts";
import { createMobileTeachingDraftRound } from "../src/lib/judgement/teaching-drafts";

const time = Date.parse("2026-10-01T10:00:00Z");
const empty = (): PortableLearnerData => ({ generatedAt: new Date(time).toISOString(), sessions: [], artifacts: [], goals: [], questionChecks: [], quizResults: [], decks: [], cardReviews: [], studyPriorities: [], feedbackEvents: [], usageEvents: [], topicEvidence: [], benchmarks: [], evolutions: [], learnerProfile: { topicsExplored: [], strengths: [], weaknesses: [], sessionsCount: 0 } });

const triageJudge = (draftNeeded: number, calls: JudgementRequest[]): JudgementCaller => async request => {
  calls.push(request);
  const thinking = request.questions.thinking_level;
  if (thinking?.type !== "score") return { ok: false, error: { code: "backend-unavailable", retryable: false } };
  return { ok: true, response: { backend: { backend: "fixture", model: "fixture-v1", calibrationSha256: null }, answers: {
    draft_needed: { type: "noul", noul: draftNeeded },
    thinking_level: { type: "score", score: 1, confidence: 0.9,
      probabilities: Object.fromEntries(thinking.criteria.map((_, index) => [String(index), index === 1 ? 0.97 : 0.01])),
      legend: Object.fromEntries(thinking.criteria.map((criterion, index) => [String(index), criterion])) },
  } } };
};

test("a simple native turn is answered directly at the triaged thinking level", async () => {
  const calls: JudgementRequest[] = [];
  const levels: unknown[] = [];
  let released = 0;
  const round = createMobileTeachingDraftRound({ judge: triageJudge(0.05, calls), current: () => true, evidence: async () => empty(),
    onReleased: () => { released++; },
    request: async (_settings, _key, _messages, options) => { levels.push(options?.reasoningLevel); return { text: "Hello!", calls: [], assistantTurn: null, usage: null }; },
  });
  const result = await round({ provider: "openai", model: "fixture", customBaseUrl: "" }, "key",
    [{ id: "user", role: "user", content: "hi there", createdAt: time }], { reasoningLevel: "high" });
  expect(result.text).toBe("Hello!");
  expect(calls).toHaveLength(1);
  expect(levels).toEqual(["low"]);
  expect(released).toBe(1);
});

test("an uncertain native turn goes through the draft pipeline", async () => {
  const calls: JudgementRequest[] = [];
  const round = createMobileTeachingDraftRound({ judge: triageJudge(0.8, calls), current: () => true, evidence: async () => empty(),
    onReleased: () => {}, request: async () => ({ text: "Draft", calls: [], assistantTurn: null, usage: null }),
  });
  await round({ provider: "openai", model: "fixture", customBaseUrl: "" }, "key",
    [{ id: "user", role: "user", content: "Prove there are infinitely many primes", createdAt: time }], { reasoningLevel: "high" });
  expect(calls.length).toBeGreaterThan(1);
  expect(Object.keys(calls[0]!.questions)).toEqual(["draft_needed", "thinking_level"]);
});

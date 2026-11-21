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
  // Planning may start alongside triage, but nothing is drafted or reviewed.
  expect(calls.filter(request => "draft_needed" in request.questions)).toHaveLength(1);
  expect(calls.some(request => "reply" in (request.state as object))).toBe(false);
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

test("a focused native tool loop plans once and reviews every round", async () => {
  const { acceptingTeachingJudge } = await import("./helpers/judgement-fixtures");
  const { runMobileToolLoop } = await import("../src/lib/provider-tool-loop");
  const requests: JudgementRequest[] = [];
  let committed = 0;
  const round = createMobileTeachingDraftRound({ triage: false, current: () => true, evidence: async () => empty(), onReleased: () => {},
    judgementModel: { id: "fixture", requestTokens: 64_000, stateQuestionTokens: 6000 },
    judge: async (request, signal) => {
      requests.push(request);
      const outcome = await acceptingTeachingJudge(request, signal);
      if (!outcome.ok || !request.questions.identity_invented) return outcome;
      return { ok: true, response: { ...outcome.response, answers: { ...outcome.response.answers, identity_invented: { type: "noul", noul: 0 } } } };
    },
    request: async (_settings, _key, _messages, options) => options?.continuation
      ? { text: "Here is your quiz.", calls: [], assistantTurn: null, usage: null }
      : { text: "", calls: [{ id: "call-1", name: "generate_practice_quiz", arguments: { topic: "Division" } }],
        assistantTurn: { provider: "openai", previousResponseId: "response-1" }, usage: null },
  });
  const result = await runMobileToolLoop({ provider: "openai", model: "fixture", customBaseUrl: "" }, null,
    [{ id: "user", role: "user", content: "Give me a practice quiz on division.", createdAt: time }], {
      sessionId: "plan-once", triggeringMessageId: "user", createdAt: 1, requestRound: round,
      executeTool: async (name, _args, context) => ({ ok: true, toolName: name, idempotencyKey: context.idempotencyKey, output: { ok: 1 }, effects: [] }),
      commitToolCall: async () => { committed++; },
    });
  expect(result).toMatchObject({ text: "Here is your quiz.", toolCalls: 1 });
  expect(committed).toBe(1);
  expect(requests.filter(request => "draft_standard" in request.questions)).toHaveLength(1);
  expect(requests.filter(request => "reply" in (request.state as object)).length).toBeGreaterThanOrEqual(2);
});

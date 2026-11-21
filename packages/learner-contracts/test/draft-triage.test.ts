import { describe, expect, test } from "bun:test";
import { decideTeachingTriage, teachingTriageRequest, triageRequiresDraft, type JudgementOutcome, type TeachingPolicyTurn } from "../src/index.js";

const turn = (overrides: Partial<TeachingPolicyTurn> = {}): TeachingPolicyTurn => ({
  learnerMessage: "thanks!", conversation: [{ role: "assistant", content: "Four factorial is 24." }],
  learnerEvidence: [], availableTools: [], toolResults: [], sources: [], assessment: "unknown",
  improvementRuns: null, domain: "unknown", ...overrides,
} as TeachingPolicyTurn);

const LEGEND = teachingTriageRequest(turn()).questions.thinking_level;
const outcome = (draftNeeded: number, level: number): JudgementOutcome => {
  if (LEGEND?.type !== "score") throw new Error("fixture");
  const probabilities = Object.fromEntries(LEGEND.criteria.map((_, index) => [String(index), index === level ? 0.9 : 0.1 / 3]));
  return { ok: true, response: { backend: { backend: "fixture", model: "fixture", calibrationSha256: null }, answers: {
    draft_needed: { type: "noul", noul: draftNeeded },
    thinking_level: { type: "score", score: level, confidence: 0.9, probabilities,
      legend: Object.fromEntries(LEGEND.criteria.map((criterion, index) => [String(index), criterion])) },
  } } };
};

describe("draft triage", () => {
  test("a confident simple turn is answered directly at the chosen thinking level", () => {
    expect(decideTeachingTriage(outcome(0.05, 0), "high")).toEqual({ route: "direct", reasoning: "off", draftProbability: 0.05 });
    expect(decideTeachingTriage(outcome(0.1, 1), "high")).toMatchObject({ route: "direct", reasoning: "low" });
    expect(decideTeachingTriage(outcome(0.1, 2), "low")).toMatchObject({ route: "direct", reasoning: "low" });
  });

  test("doubt, substantial thinking, or a failed check drafts", () => {
    expect(decideTeachingTriage(outcome(0.5, 0), "high").route).toBe("draft");
    expect(decideTeachingTriage(outcome(0.05, 3), "high").route).toBe("draft");
    expect(decideTeachingTriage({ ok: false, error: { code: "backend-unavailable", retryable: false } }, "high").route).toBe("draft");
    const partial = outcome(0.05, 0);
    if (partial.ok) delete (partial.response.answers as Record<string, unknown>).thinking_level;
    expect(decideTeachingTriage(partial, "high").route).toBe("draft");
  });

  test("submissions, open activities and assessment always draft", () => {
    expect(triageRequiresDraft(turn())).toBe(false);
    expect(triageRequiresDraft(turn({ assessment: "practice" }))).toBe(true);
    expect(triageRequiresDraft(turn({ learnerMessage: "  " }))).toBe(true);
    expect(triageRequiresDraft(turn({ pendingSubmissions: [{ kind: "quiz", id: "q", questionIds: ["a"] }] } as Partial<TeachingPolicyTurn>))).toBe(true);
    expect(triageRequiresDraft(turn({ activeWork: { plan: null, focus: null, truncated: false,
      openInteractions: [{ documentId: "d", nodeId: "n", component: "Question", presentedAt: 1, itemId: null, state: "awaiting" }] } }))).toBe(true);
  });

  test("the request carries only the latest exchange, clipped", () => {
    const request = teachingTriageRequest(turn({ learnerMessage: "x".repeat(10_000) }));
    const state = request.state as { turn: { latestLearnerMessage: string; previousTutorMessage: string } };
    expect(state.turn.latestLearnerMessage.length).toBeLessThan(4_100);
    expect(state.turn.previousTutorMessage).toBe("Four factorial is 24.");
    expect(Object.keys(request.questions)).toEqual(["draft_needed", "thinking_level"]);
  });
});

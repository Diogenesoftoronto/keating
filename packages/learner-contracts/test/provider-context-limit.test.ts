import { describe, expect, test } from "bun:test";
import { runTeachingDrafts } from "../src/judgement/teaching-drafts.js";
import type { JudgementCaller, JudgementError, JudgementRequest } from "../src/judgement/contracts.js";
import type { TeachingPolicyTurn } from "../src/judgement/teaching-policy-types.js";
import { makeTeachingDraftJudge, teachingDraftTurn } from "./fixtures/teaching-drafts.js";

const overflow: JudgementError = { code: "context-limit-exceeded", retryable: false };
const conversation: TeachingPolicyTurn["conversation"] = Array.from({ length: 20 }, (_, index) => ({
  role: index % 2 ? "assistant" : "user", content: `Observation ${index}. ${"private synthetic record ".repeat(32)}`,
}));
const turn = { ...teachingDraftTurn, conversation };
const reviewer = { id: "fixture-v1", stateQuestionTokens: 32_000, requestTokens: 64_000 };
const accept = makeTeachingDraftJudge();
const generated = async () => ({ reply: { text: "Division splits a quantity into equal groups.", toolCalls: [] }, value: "answer" });
const turnOf = (request: JudgementRequest) => (request.state as { turn: TeachingPolicyTurn }).turn;

describe("a provider token limit that the host estimate missed", () => {
  test.each(["jev-1.14.0", "judgement", "judgement-jev/jev-1.14.0"])("keeps full fitting input above the token estimate for %s", async id => {
    const longHistory = [{ role: "user" as const, content: "Earlier instruction." }, { role: "assistant" as const, content: "四角形".repeat(11_000) }];
    const seen: JudgementRequest[] = [];
    const result = await runTeachingDrafts({ turn: { ...turn, conversation: longHistory }, judgementModel: { ...reviewer, id },
      judge: async (request, signal) => { seen.push(request); return accept(request, signal); }, generate: generated, maxAttempts: 1 });
    expect(result.status).toBe("released");
    expect(result.receipt.stateHistory![0]!.state.estimatedStateQuestionTokens).toBeGreaterThan(32_000);
    expect(result.receipt.stateHistory![0]!.state.budgetTokens).toBe(32_000);
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every(request => turnOf(request).conversation.length === longHistory.length)).toBe(true);
    expect(result.receipt.slides).toEqual([]);
  });

  test("honors an explicitly smaller operator budget even for a known hosted Jev", async () => {
    const result = await runTeachingDrafts({ turn, judgementModel: { ...reviewer, id: "jev-1.14.0", stateQuestionTokens: 2_000 },
      judge: async (request, signal) => {
        expect(turnOf(request).conversation.length).toBeLessThan(conversation.length);
        return accept(request, signal);
      }, generate: generated, maxAttempts: 1 });
    expect(result.status).toBe("released");
    expect(result.receipt.slides!.length).toBeGreaterThan(0);
  });

  test("recovers every review step with the intact current request and a recent suffix", async () => {
    const observations: { request: JudgementRequest; fit: boolean }[] = [];
    const judge: JudgementCaller = async (request, signal) => {
      const fit = turnOf(request).conversation.length <= 10;
      observations.push({ request, fit });
      return fit ? accept(request, signal) : { ok: false, error: overflow };
    };
    const result = await runTeachingDrafts({ turn, judgementModel: reviewer, judge, parallelDrafts: true, generate: generated });
    expect(result.status).toBe("released");
    expect(result.receipt.attempts.map(attempt => attempt.status)).toEqual(["pass", "pass"]);
    expect(result.receipt.selectorProbabilities).toBeDefined();
    expect(result.receipt.slides?.some(slide => slide.reason === "provider-context-limit")).toBe(true);
    expect(result.receipt.slides?.every(slide => slide.before.budgetTokens === 32_000 && slide.after?.budgetTokens === 32_000)).toBe(true);
    expect(result.receipt.stateHistory).toHaveLength(observations.length);
    expect(observations[0]!.request.state).toMatchObject({ turn: { conversation } });
    for (const { request, fit } of observations) {
      const actual = turnOf(request);
      expect(actual.learnerMessage).toBe(turn.learnerMessage);
      const start = conversation.length - actual.conversation.length;
      expect(actual.conversation).toEqual(conversation.slice(start));
      if (fit) expect(actual.earlierLearnerExcerpts?.[0]).toStartWith("Observation 0.");
    }
    expect(JSON.stringify(result.receipt)).not.toContain("private synthetic record");
  });

  test("splits a rejected question batch over identical history and merges its answers", async () => {
    const plans: string[] = [];
    const allPlanQuestions = new Set<string>();
    const judge: JudgementCaller = async (request, signal) => {
      expect(turnOf(request).conversation).toEqual(conversation);
      const keys = Object.keys(request.questions);
      if (request.questions.draft_standard && allPlanQuestions.size === 0) {
        for (const id of keys) allPlanQuestions.add(id);
      }
      if (keys.length > 16) return { ok: false, error: overflow };
      if (!("reply" in (request.state as object))) plans.push(...keys);
      return accept(request, signal);
    };
    const result = await runTeachingDrafts({ turn, judgementModel: reviewer, judge, maxAttempts: 1, generate: generated });
    expect(result.status).toBe("released");
    expect(new Set(plans)).toEqual(allPlanQuestions);
    expect(plans.length).toBe(allPlanQuestions.size);
    expect(result.receipt.slides).toEqual([]);
  });

  test("preserves the full state on an unrelated service failure", async () => {
    let calls = 0;
    const result = await runTeachingDrafts({ turn, judgementModel: reviewer, generate: generated, judge: async request => {
      calls++;
      expect(turnOf(request).conversation).toEqual(conversation);
      return { ok: false, error: { code: "backend-unavailable", retryable: false } };
    } });
    expect(result.receipt.reason).toBe("backend-unavailable");
    expect(calls).toBe(1);
    expect(result.receipt.slides).toEqual([]);
  });

  test("withholds an irreducible request after the same state also fails with a single question", async () => {
    const sent: number[] = [];
    const result = await runTeachingDrafts({ turn: teachingDraftTurn, judgementModel: reviewer, generate: async () => {
      throw new Error("The tutor must only run after planning succeeds.");
    }, judge: async request => {
      expect(turnOf(request).learnerMessage).toBe(teachingDraftTurn.learnerMessage);
      sent.push(Object.keys(request.questions).length);
      return { ok: false, error: overflow };
    } });
    expect(result.status).toBe("withheld");
    expect(result.receipt.reason).toBe("context-limit-exceeded");
    expect(sent).toHaveLength(2);
    expect(sent[0]).toBeGreaterThan(1);
    expect(sent[1]).toBe(1);
    expect(result.receipt.attempts).toHaveLength(0);
  });
});

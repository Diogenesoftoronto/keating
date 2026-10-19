/** Behavioral boundaries for draft release, judge identity, effort, and best-effort receipts. */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { blocksRelease, runTeachingDrafts, teachingDraftAttemptLimit } from "../src/judgement/teaching-drafts.js";
import type { JudgementAnswer, JudgementCaller, JudgementRequest } from "../src/judgement/contracts.js";
import type { TeachingPolicyCheck } from "../src/judgement/teaching-policy-types.js";
import { teachingDraftTurn } from "./fixtures/teaching-drafts.js";

type Overrides = Record<string, string | number>;
function successfulJudge(overrides: (request: JudgementRequest) => Overrides = () => ({})): JudgementCaller {
  return async request => {
    const chosen = overrides(request);
    const answers: Record<string, JudgementAnswer> = {};
    for (const [id, question] of Object.entries(request.questions)) {
      if (question.type === "choice") {
        const choice = typeof chosen[id] === "string" ? chosen[id] as string
          : id === "draft_standard" ? "supported" : Object.keys(question.criteria)[0]!;
        answers[id] = { type: "choice", choice, confidence: 1,
          probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, Number(key === choice)])) };
      } else if (question.type === "score") {
        const level = typeof chosen[id] === "number" ? chosen[id] as number : 0;
        answers[id] = { type: "score", score: level, confidence: 1,
          legend: Object.fromEntries(question.criteria.map((text, index) => [String(index), text])),
          probabilities: Object.fromEntries(question.criteria.map((_, index) => [String(index), Number(index === level)])) };
      } else answers[id] = { type: "noul", noul: typeof chosen[id] === "number" ? chosen[id] as number : id.startsWith("quality_") ? .99 : .01 };
    }
    return { ok: true, response: { answers,
      backend: { backend: "fixture", model: "fixture-v1", calibrationSha256: null }, usage: { inputTokens: 13, outputTokens: 5 } } };
  };
}
const reply = { text: "Divide twelve counters into three equal groups: four in each group.", toolCalls: [] };
const generate = async () => ({ reply, value: "four" });
const advisory = [
  "explanation_missing", "direct_answer_missing", "practice_missing", "direct_help_withheld",
  "diagnostic_interview_forced", "known_context_reasked", "gap_ignored", "checkpoint_not_interactive",
  "improvement_interrupts", "transport_exposed", "code_example_missing", "code_trace_missing",
  "math_formalism_missing", "philosophy_alternative_missing", "philosophy_limit_missing",
  "science_prediction_missing", "history_timeline_missing", "politics_framework_missing", "art_work_missing", "art_effect_missing",
  "quality_progress", "quality_scope",
];
const uncertain = ["learner_voice_replaced", "checkpoint_answer_leaked", "checkpoint_repeated", "checkpoint_continued",
  "practice_withheld", "unsolicited_assessment", "housekeeping_delegated"];
const check = (id: string, overrides: Partial<TeachingPolicyCheck> = {}): TeachingPolicyCheck => ({
  id, source: "jev", severity: "major", status: "unknown", probability: .5, ...overrides,
});

describe("public release eligibility", () => {
  test.each(advisory)("presentation score %s ranks prose without vetoing release", id => {
    for (const status of ["unknown", "fail"] as const) {
      for (const probability of [0, .5, 1]) expect(blocksRelease(check(id, { status, probability }))).toBe(false);
    }
  });
  test.each(uncertain)("uncertainty about %s is advisory only below the concern threshold", id => {
    expect(blocksRelease(check(id, { probability: 0 }))).toBe(false);
    expect(blocksRelease(check(id, { probability: .799999 }))).toBe(false);
    expect(blocksRelease(check(id, { probability: .8 }))).toBe(true);
    expect(blocksRelease(check(id, { probability: 1 }))).toBe(true);
    expect(blocksRelease(check(id, { status: "fail", probability: .5 }))).toBe(true);
  });
  test("untrusted probabilities never turn a missing review into an advisory pass", () => {
    for (const id of [...advisory, ...uncertain]) {
      for (const probability of [null, NaN, Infinity, -Infinity, -.01, 1.01]) {
        expect(blocksRelease(check(id, { probability }))).toBe(true);
      }
    }
  });
  test("host failures and critical concerns cannot be waived by presentation scores", () => {
    fc.assert(fc.property(fc.constantFrom(...advisory, ...uncertain), fc.double({ min: 0, max: 1, noNaN: true }),
      fc.constantFrom("unknown" as const, "fail" as const), (id, probability, status) => {
        expect(blocksRelease(check(id, { probability, status, source: "deterministic" }))).toBe(true);
        expect(blocksRelease(check(id, { probability, status, severity: "critical" }))).toBe(true);
      }), { numRuns: 60 });
  });
  test("passing checks do not block and unrelated semantic concerns still require review", () => {
    expect(blocksRelease(check("host_schema", { source: "deterministic", severity: "critical", probability: null, status: "pass" }))).toBe(false);
    expect(blocksRelease(check("identity_invented"))).toBe(true);
  });
});

describe("draft budgets and reasoning choices", () => {
  test("fractional budgets produce floored and bounded integer attempt limits", () => {
    for (const [budget, expected] of [[-8, 1], [0, 1], [.9, 1], [1.9, 1], [9.9, 9], [10.1, 10]] as const) {
      expect(teachingDraftAttemptLimit(budget)).toBe(expected);
      expect(teachingDraftAttemptLimit(budget, "extended")).toBe(expected);
    }
    expect(() => teachingDraftAttemptLimit(-Infinity)).toThrow();
  });
  test.each([
    [[0, 0, 0], "off"], [[1, 0, 0], "low"], [[0, 1, 0], "low"], [[0, 0, 1], "low"],
    [[1, 1, 0], "medium"], [[2, 0, 0], "medium"], [[0, 2, 0], "medium"], [[0, 0, 2], "medium"],
    [[2, 2, 0], "high"], [[0, 2, 2], "high"], [[3, 0, 0], "high"], [[0, 0, 3], "high"],
  ] as const)("declared reasoning needs %j select %s effort", async (levels, expected) => {
    const efforts: string[] = [];
    const result = await runTeachingDrafts({ turn: teachingDraftTurn, maxAttempts: 1,
      judge: successfulJudge(() => ({ draft_reasoning_steps: levels[0], draft_reasoning_synthesis: levels[1], draft_reasoning_verification: levels[2] })),
      generate: async input => { efforts.push(input.reasoning); return generate(); } });
    expect(efforts).toEqual([expected]);
    expect(result.status).toBe("released");
    expect(result.receipt.reasoning).toBe(expected);
  });
  test.each(["off", "low", "medium", "high"] as const)("caller reasoning ceiling %s is honored", async maxReasoning => {
    const result = await runTeachingDrafts({ turn: teachingDraftTurn, maxAttempts: 1, maxReasoning,
      judge: successfulJudge(() => ({ draft_reasoning_steps: 3 })), generate });
    expect(result.status).toBe("released");
    expect(result.receipt.reasoning).toBe(maxReasoning);
  });
});

describe("review identity and release receipt", () => {
  test.each(["", "judgement", "fixture-latest"])("an unpinned planning model %j cannot dispatch generation", async model => {
    const base = successfulJudge(); let generated = false;
    const result = await runTeachingDrafts({ turn: teachingDraftTurn, generate: async () => { generated = true; return generate(); },
      judge: async (request, signal) => {
        const outcome = await base(request, signal);
        if (!outcome.ok) return outcome;
        return { ...outcome, response: { ...outcome.response, backend: { ...outcome.response.backend, model } } };
      } });
    expect(generated).toBe(false);
    expect(result.status).toBe("withheld");
    expect(result.receipt.reason).toBe("response-malformed");
    expect(result.reply).toBeUndefined();
  });
  test("a changed reviewer identity cannot certify a later draft", async () => {
    const base = successfulJudge();
    const result = await runTeachingDrafts({ turn: teachingDraftTurn, maxAttempts: 1, generate,
      judge: async (request, signal) => {
        const outcome = await base(request, signal);
        if (!outcome.ok || !request.questions.quality_progress) return outcome;
        return { ...outcome, response: { ...outcome.response, backend: { ...outcome.response.backend, model: "another-v1" } } };
      } });
    expect(result.status).toBe("released");
    expect(result.receipt.reason).toBe("best-effort-draft");
    expect(result.receipt.judgeModel).toBe("fixture-v1");
    expect(result.receipt.attempts[0]?.status).toBe("unknown");
    expect(result.receipt.attempts[0]?.checks.filter(item => item.source === "jev").every(item => item.probability === null)).toBe(true);
  });
  test("caller receives reviewed text and complete token totals without private content in the receipt", async () => {
    const result = await runTeachingDrafts({ turn: teachingDraftTurn, maxAttempts: 1, judge: successfulJudge(), generate });
    expect(result.status).toBe("released");
    expect(result.reply).toEqual(reply);
    expect(result.value).toBe("four");
    expect(result.receipt).toMatchObject({ phase: "released", selectedAttempt: 1, reason: null,
      judgeUsage: { inputTokens: 26, outputTokens: 10 }, selectorProbabilities: null, selectionCandidateAttempts: [1], selectionOmittedForBudget: [] });
    expect(JSON.stringify(result.receipt)).not.toContain(reply.text);
  });
});


describe("best-effort text ranking", () => {
  test("both usefulness scores rank completed text and receipts retain rejected candidates honestly", async () => {
    let attempt = 0;
    const result = await runTeachingDrafts({ turn: teachingDraftTurn, refinement: "extended", maxAttempts: 3,
      judge: successfulJudge(() => ({ retention_overclaimed: .99,
        quality_progress: attempt === 1 ? 1 : attempt === 2 ? .625 : .2,
        quality_scope: attempt === 1 ? 0 : attempt === 2 ? .625 : .2 })),
      generate: async () => { attempt++; return { reply: { text: `Complete explanation ${attempt}`, toolCalls: [] }, value: { answer: attempt } }; } });
    expect(result.status).toBe("released");
    expect(result.value).toEqual({ answer: 2 });
    expect(result.reply?.text).toBe("Complete explanation 2");
    expect(result.receipt).toMatchObject({ reason: "best-effort-draft", selectedAttempt: 2, selectionCandidateAttempts: [1, 2, 3], selectorProbabilities: null });
    expect(result.receipt.attempts.map(entry => entry.status)).toEqual(["fail", "fail", "fail"]);
    expect(result.receipt.attempts.every(entry => entry.checks.some(item => item.id === "retention_overclaimed" && item.status === "fail"))).toBe(true);
  });
  test("equal best-effort quality releases the earlier complete draft", async () => {
    let attempt = 0;
    const result = await runTeachingDrafts({ turn: teachingDraftTurn, refinement: "extended", maxAttempts: 2,
      judge: successfulJudge(() => ({ retention_overclaimed: .99,
        quality_progress: attempt === 1 ? .75 : .25, quality_scope: attempt === 1 ? .25 : .75 })),
      generate: async () => ({ reply: { text: `Equal-quality answer ${++attempt}`, toolCalls: [] }, value: attempt }) });
    expect(result.status).toBe("released");
    expect(result.reply?.text).toBe("Equal-quality answer 1");
    expect(result.value).toBe(1);
    expect(result.receipt.selectedAttempt).toBe(1);
    expect(result.receipt.selectionCandidateAttempts).toEqual([1, 2]);
  });
  test("empty prose and a failed or unknown host check never enter best-effort candidates", async () => {
    for (const status of ["fail", "unknown"] as const) {
      let attempt = 0;
      const result = await runTeachingDrafts({ turn: teachingDraftTurn, refinement: "extended", maxAttempts: 3,
        judge: successfulJudge(() => ({ retention_overclaimed: .99 })),
        check: candidate => candidate.text === "Unchecked claim" ? [{ id: "host_evidence", source: "deterministic", severity: "major", status, probability: null }] : [],
        generate: async () => {
          attempt++;
          return { reply: { text: attempt === 1 ? "Safely grounded hint" : attempt === 2 ? " \n\t " : "Unchecked claim", toolCalls: [] }, value: attempt };
        } });
      expect(result.status).toBe("released");
      expect(result.reply?.text).toBe("Safely grounded hint");
      expect(result.value).toBe(1);
      expect(result.receipt.selectionCandidateAttempts).toEqual([1]);
      expect(result.receipt.attempts[2]?.checks).toContainEqual({ id: "host_evidence", source: "deterministic", severity: "major", status, probability: null });
    }
  });
});


describe("review confidence diagnostics", () => {
  test.each([["concise", .55], ["supported", .6], ["deep", .65]] as const)("%s quality boundary is visible without vetoing valid prose", async (standard, threshold) => {
    for (const [quality, status] of [[threshold, "pass"], [threshold - .01, "unknown"], [.2, "fail"], [.21, "unknown"]] as const) {
      const result = await runTeachingDrafts({ turn: teachingDraftTurn, maxAttempts: 1,
        judge: successfulJudge(() => ({ draft_standard: standard, quality_progress: quality, quality_scope: quality })), generate });
      expect(result.status).toBe("released");
      expect(result.reply).toEqual(reply);
      expect(result.receipt.qualityThreshold).toBe(threshold);
      expect(result.receipt.attempts[0]?.checks.filter(item => item.id.startsWith("quality_")))
        .toEqual(["quality_progress", "quality_scope"].map(id => ({ id, source: "jev", severity: "major", status, probability: 1 - quality })));
    }
  });
  test.each(["draft_reasoning_steps", "draft_reasoning_synthesis", "draft_reasoning_verification"])("an incomplete or mismatched %s answer falls back to default effort", async id => {
    for (const corruption of ["missing", "legend", "levels"] as const) {
      const base = successfulJudge(() => ({ draft_reasoning_steps: 3, draft_reasoning_synthesis: 3, draft_reasoning_verification: 3 }));
      const result = await runTeachingDrafts({ turn: teachingDraftTurn, maxAttempts: 1, generate,
        judge: async (request, signal) => {
          const outcome = await base(request, signal);
          if (!outcome.ok || !request.questions[id]) return outcome;
          const answers = { ...outcome.response.answers };
          const answer = answers[id];
          if (corruption === "missing") delete answers[id];
          else if (answer?.type === "score") answers[id] = corruption === "legend"
            ? { ...answer, legend: { ...answer.legend, "0": "An unrelated assessment scale" } }
            : { ...answer, probabilities: { "3": 1 } };
          return { ...outcome, response: { ...outcome.response, answers } };
        } });
      expect(result.status).toBe("released");
      expect(result.receipt.reasoning).toBe("medium");
    }
  });
});


describe("best-effort recovery after interruption", () => {
  test.each([
    [[.25, .875], 2], [[.75, .75], 1],
  ] as const)("a later reviewer failure retains the best completed prose for qualities %j", async (qualities, expected) => {
    let attempt = 0;
    const base = successfulJudge(() => ({ retention_overclaimed: .99,
      quality_progress: qualities[attempt - 1] ?? .99, quality_scope: qualities[attempt - 1] ?? .99 }));
    const result = await runTeachingDrafts({ turn: teachingDraftTurn, refinement: "extended", maxAttempts: 4,
      judge: async (request, signal) => {
        if (attempt === 3 && request.questions.quality_progress) throw new Error("Reviewer transport failed");
        return base(request, signal);
      },
      generate: async () => ({ reply: { text: `Grounded explanation ${++attempt}`, toolCalls: [] }, value: { answer: attempt } }) });
    expect(attempt).toBe(3);
    expect(result.status).toBe("released");
    expect(result.reply).toEqual({ text: `Grounded explanation ${expected}`, toolCalls: [] });
    expect(result.value).toEqual({ answer: expected });
    expect(result.receipt).toMatchObject({ phase: "released", reason: "best-effort-draft", attempt: 3, selectedAttempt: expected });
    expect(result.receipt.attempts.map(entry => ({ attempt: entry.attempt, status: entry.status })))
      .toEqual([{ attempt: 1, status: "fail" }, { attempt: 2, status: "fail" }]);
    expect(result.receipt.attempts.every(entry => entry.checks.some(item => item.id === "retention_overclaimed" && item.status === "fail"))).toBe(true);
  });
  test("a deadline during a later generation retains the best reviewed text without inventing a pass", async () => {
    let attempt = 0;
    const result = await runTeachingDrafts({ turn: teachingDraftTurn, refinement: "extended", maxAttempts: 4, timeoutMs: 250,
      judge: successfulJudge(() => ({ retention_overclaimed: .99,
        quality_progress: attempt === 2 ? .875 : .25, quality_scope: attempt === 2 ? .875 : .25 })),
      generate: async () => {
        if (++attempt === 3) return new Promise<never>(() => {});
        return { reply: { text: `Useful division hint ${attempt}`, toolCalls: [] }, value: attempt };
      } });
    expect(attempt).toBe(3);
    expect(result.status).toBe("released");
    expect(result.value).toBe(2);
    expect(result.reply).toEqual({ text: "Useful division hint 2", toolCalls: [] });
    expect(result.receipt).toMatchObject({ reason: "best-effort-draft", selectedAttempt: 2, phase: "released" });
    expect(result.receipt.attempts.map(entry => entry.status)).toEqual(["fail", "fail"]);
    expect(result.receipt.attempts[1]?.checks).toContainEqual({ id: "retention_overclaimed", source: "jev", severity: "critical", status: "fail", probability: .99 });
  });
});

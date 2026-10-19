import { describe, expect, test } from "bun:test";
import { blocksRelease, runTeachingDrafts, teachingDraftAttemptLimit } from "../src/judgement/teaching-drafts.js";
import type { JudgementAnswer, JudgementCaller, JudgementRequest } from "../src/judgement/contracts.js";
import type { TeachingPolicyTurn } from "../src/judgement/teaching-policy-types.js";

const turn: TeachingPolicyTurn = { learnerMessage: "Help me with this code.", conversation: [], learnerEvidence: [], availableTools: [], toolResults: [], sources: [], assessment: "none", improvementRuns: 0, domain: "unknown" };
type Scores = Record<string, string | number | undefined>;
function judge(scores: (request: JudgementRequest) => Scores = () => ({})): JudgementCaller {
  return async request => {
    const override = scores(request);
    const answers: Record<string, JudgementAnswer> = {};
    for (const [id, question] of Object.entries(request.questions)) {
      if (question.type === "choice") {
        const choice = typeof override[id] === "string" ? override[id] as string
          : id === "draft_standard" ? "supported" : Object.keys(question.criteria)[0]!;
        answers[id] = { type: "choice", choice, confidence: 1, probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, Number(key === choice)])) };
      } else if (question.type === "score") {
        answers[id] = { type: "score", score: 0, legend: Object.fromEntries(question.criteria.map((text, index) => [String(index), text])),
          probabilities: Object.fromEntries(question.criteria.map((_, index) => [String(index), Number(index === 0)])), confidence: 1 };
      } else {
        answers[id] = { type: "noul", noul: typeof override[id] === "number" ? override[id] as number : id.startsWith("quality_") ? .99 : .01 };
      }
    }
    return { ok: true, response: { backend: { backend: "fixture", model: "fixture-v1", calibrationSha256: null }, answers } };
  };
}
const generate = async () => ({ reply: { text: "A concrete hint for the learner's next step.", toolCalls: [] }, value: "approved" });

describe("ordinary teaching draft release", () => {
  test("a useful unpaired reply releases once without chasing uncertain style or stronger reasoning", async () => {
    let generated = 0;
    const result = await runTeachingDrafts({ turn, judge: judge(() => ({ draft_standard: "deep", checkpoint_continued: .61,
      checkpoint_repeated: .28, checkpoint_not_interactive: .69, explanation_missing: .44, quality_scope: .3 })),
      generate: async () => { generated++; return generate(); } });
    expect(generated).toBe(1);
    expect(result.status).toBe("released");
    expect(result.receipt.maxAttempts).toBe(10);
    expect(result.receipt.standard).toBe("deep");
    expect(result.receipt.attempts[0]!.checks.find(check => check.id === "checkpoint_continued"))
      .toMatchObject({ probability: .61, status: "unknown" });
  });

  test.each([undefined, 10, 50])("ordinary semantic failures receive at most one repair with budget %s", async maxAttempts => {
    let generated = 0;
    const result = await runTeachingDrafts({ turn, maxAttempts, judge: judge(() => ({ retention_overclaimed: .99 })),
      generate: async () => { generated++; return { reply: { text: "PRIVATE rejected response", toolCalls: [] }, value: "PRIVATE" }; } });
    expect(generated).toBe(2);
    expect(result.receipt.maxAttempts).toBe(10);
    expect(result.status).toBe("released");
    expect(result.value).toBe("PRIVATE");
    expect(result.receipt.reason).toBe("best-effort-draft");
    expect(JSON.stringify(result.receipt)).not.toContain("PRIVATE");
  });

  test("extended refinement is an explicit separate budget; invalid budgets fail closed", () => {
    expect(teachingDraftAttemptLimit()).toBe(10);
    expect(teachingDraftAttemptLimit(1)).toBe(1);
    expect(teachingDraftAttemptLimit(50)).toBe(10);
    expect(teachingDraftAttemptLimit(undefined, "extended")).toBe(10);
    expect(teachingDraftAttemptLimit(50, "extended")).toBe(10);
    expect(() => teachingDraftAttemptLimit(Number.NaN)).toThrow("invalid-teaching-draft-budget");
    expect(() => teachingDraftAttemptLimit(Infinity)).toThrow("invalid-teaching-draft-budget");
  });

  test("the attached coding pattern repairs the real failure and releases by attempt three", async () => {
    let generated = 0;
    const reviewQuestions: string[][] = [];
    const coding = "```keating-ui\n" + JSON.stringify({ schemaVersion: 1, id: "challenge", revision: 0, lifecycle: "ready", supportedSurfaces: ["web"],
      createdAt: "2026-10-12T00:00:00Z", updatedAt: "2026-10-12T00:00:00Z", nodes: [{ type: "coding-challenge", id: "sum", title: "Add two numbers", prompt: "Return a + b.", language: "javascript", entrypoint: "add", starterCode: "function add(a, b) { return 0; }", tests: [{ id: "one", label: "Small values", args: [1, 2], expected: 3 }] }] }) + "\n```";
    const result = await runTeachingDrafts({ turn, random: () => 0,
      judge: judge(request => {
        if (!request.questions.quality_progress) return { executable_code: .99, learning_task: .99 };
        reviewQuestions.push(Object.keys(request.questions));
        return generated === 1 ? { mastery_overclaimed: .82, unsolicited_animation: .86 }
          : { checkpoint_continued: .25, checkpoint_not_interactive: .49, unsolicited_assessment: .25,
            research_skipped: .29, history_primary_source_missing: .27, science_prediction_missing: .38,
            art_work_missing: .3, code_trace_missing: .85 };
      }),
      generate: async input => {
        generated++;
        if (generated === 2) expect(input.feedback.map(check => check.id)).toContain("mastery_overclaimed");
        if (generated === 3) expect(input.feedback).toEqual([]);
        expect(input.synthesis).toBeUndefined();
        return { reply: { text: generated === 3 ? "Use the + operator to combine a and b." : coding, toolCalls: [] }, value: generated };
      },
    });
    expect(generated).toBe(2);
    expect(result.status).toBe("released");
    expect(result.value).toBe(2);
    expect(result.receipt.attempts.map(attempt => attempt.status)).toEqual(["fail", "pass"]);
    expect(result.receipt.attempts[1]!.checks.find(check => check.id === "code_trace_missing"))
      .toMatchObject({ probability: .85, status: "fail" });
    for (const questions of reviewQuestions) {
      expect(questions).toContain("code_example_missing");
      expect(questions).toContain("tool_success_invented");
      expect(questions).not.toContain("research_skipped");
      expect(questions).not.toContain("history_primary_source_missing");
      expect(questions).not.toContain("science_prediction_missing");
      expect(questions).not.toContain("art_work_missing");
    }
  });

  test.each([.99, .45])("required or uncertain research planning preserves evidence checks (%s)", async fresh_sources_needed => {
    const result = await runTeachingDrafts({ turn, maxAttempts: 1, judge: judge(() => ({ fresh_sources_needed, research_skipped: .35 })), generate });
    expect(result.status).toBe("released");
    expect(result.receipt.attempts[0]!.checks.find(check => check.id === "research_skipped"))
      .toMatchObject({ probability: .35, status: "unknown" });
  });

  test.each([
    "identity_invented", "instruction_override", "tool_success_invented", "sensitive_inference",
    "mastery_overclaimed", "retention_overclaimed", "transfer_overclaimed", "synthetic_efficacy_claim",
    "source_contradicted", "assessed_work_completed", "profile_evidence_invented", "feedback_invented",
    "observed_preference_overrides_declared", "preference_graded", "alternative_answer_rejected", "unsolicited_animation",
  ])("uncertain semantic evidence releases text with an honest receipt: %s", async id => {
    const result = await runTeachingDrafts({ turn, maxAttempts: 1, judge: judge(() => ({ [id]: .5 })), generate });
    expect(result.status).toBe("released");
    expect(result.receipt.attempt).toBe(1);
    expect(result.receipt.reason).toBe("best-effort-draft");
    expect(result.receipt.attempts[0]!.checks.find(check => check.id === id)?.status).toBe("unknown");
  });

  test("semantic checkpoint concerns remain recorded in best effort", async () => {
    const confirmed = await runTeachingDrafts({ turn, maxAttempts: 1, judge: judge(() => ({ checkpoint_answer_leaked: .95 })), generate });
    expect(confirmed.status).toBe("released");
    const assessed = await runTeachingDrafts({ turn: { ...turn, assessment: "assessed" }, maxAttempts: 1,
      judge: judge(() => ({ checkpoint_answer_leaked: .4 })), generate });
    expect(assessed.status).toBe("released");
    expect(assessed.receipt.attempts[0]!.checks.find(check => check.id === "checkpoint_answer_leaked")?.severity).toBe("critical");
  });

  test("missing or malformed review releases structurally valid text without inventing a pass", async () => {
    for (const missing of [true, false]) {
      const base = judge();
      const result = await runTeachingDrafts({ turn, maxAttempts: 1, generate, judge: async (request, signal) => {
        const result = await base(request, signal);
        if (result.ok && request.questions.checkpoint_continued) {
          const answers = result.response.answers as Record<string, JudgementAnswer>;
          if (missing) delete answers.checkpoint_continued;
          else answers.checkpoint_continued = { type: "noul", noul: Number.NaN };
        }
        return result;
      } });
      expect(result.status).toBe("released");
      expect(result.receipt.attempts[0]!.checks.find(check => check.id === "checkpoint_continued")?.status).toBe("unknown");
    }
    expect(blocksRelease({ id: "checkpoint_continued", source: "deterministic", severity: "major", status: "unknown", probability: .3 })).toBe(true);
  });
  test("ordinary activity guidance does not require a competing prose draft", async () => {
    let count = 0;
    const result = await runTeachingDrafts({ turn, judge: judge(() => ({ learning_task: .99, executable_code: .99 })),
      generate: async () => { count++; return generate(); } });
    expect(count).toBe(1);
    expect(result.receipt.interaction?.paired).toBe(false);
  });

  test("structural failures switch to text recovery on the third attempt", async () => {
    const recoveries: number[] = [];
    const result = await runTeachingDrafts({ turn, judge: judge(), generate: async input => {
      if (input.textOnlyRecovery) recoveries.push(input.attempt);
      return input.textOnlyRecovery ? generate()
        : { reply: { text: "Operation", toolCalls: [{ name: "unauthorized", arguments: {} }] }, value: "unsafe" };
    } });
    expect(result.status).toBe("released");
    expect(result.value).toBe("approved");
    expect(result.receipt.attempt).toBe(3);
    expect(recoveries).toEqual([3]);
  });

  test("only unusable responses enter the tail and no turn exceeds ten attempts", async () => {
    for (const recoverAt of [4, 10, 11]) {
      let count = 0;
      const result = await runTeachingDrafts({ turn, maxAttempts: 50, judge: judge(), generate: async input => {
        count++;
        if (input.attempt >= recoverAt) return generate();
        throw new Error("generation unavailable");
      } });
      expect(count).toBe(Math.min(recoverAt, 10));
      expect(result.status).toBe(recoverAt <= 10 ? "released" : "withheld");
    }
  });

  test("a failed structural repair still retains the first usable best effort", async () => {
    let count = 0;
    const result = await runTeachingDrafts({ turn, judge: judge(() => ({ source_contradicted: .99 })),
      generate: async () => { count++; return count === 1 ? generate()
        : { reply: { text: "Unsafe tool", toolCalls: [{ name: "unauthorized", arguments: {} }] }, value: "unsafe" }; } });
    expect(count).toBe(2);
    expect(result.status).toBe("released");
    expect(result.value).toBe("approved");
    expect(result.receipt.selectedAttempt).toBe(1);
    expect(result.receipt.reason).toBe("best-effort-draft");
  });

  test("a generation failure during the one repair retains text without consuming the tail", async () => {
    let count = 0;
    const result = await runTeachingDrafts({ turn, judge: judge(() => ({ source_contradicted: .99 })),
      generate: async () => { if (++count === 1) return generate(); throw Error("unavailable repair"); } });
    expect(count).toBe(2);
    expect(result.status).toBe("released");
    expect(result.receipt.selectedAttempt).toBe(1);
    expect(result.receipt.attempts[1]!.status).toBe("generation-error");
  });

});

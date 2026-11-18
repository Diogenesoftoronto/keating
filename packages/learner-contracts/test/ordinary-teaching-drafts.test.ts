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
    const result = await runTeachingDrafts({ turn, judge: judge(() => ({ draft_standard: "deep", checkpoint_continued: .35,
      checkpoint_repeated: .28, checkpoint_not_interactive: .69, explanation_missing: .44, quality_scope: .3 })),
      generate: async () => { generated++; return generate(); } });
    expect(generated).toBe(1);
    expect(result.status).toBe("released");
    expect(result.receipt.maxAttempts).toBe(10);
    expect(result.receipt.standard).toBe("deep");
    expect(result.receipt.attempts[0]!.checks.find(check => check.id === "checkpoint_continued"))
      .toMatchObject({ probability: .35, status: "pass" });
    expect(result.receipt.attempts[0]!.checks.find(check => check.id === "checkpoint_not_interactive"))
      .toMatchObject({ probability: .69, status: "fail" });
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
      .toMatchObject({ probability: .35, status: "pass" });
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

  test("a gray-zone blocking concern gets one repair that also carries a likely prose-only question", async () => {
    // Shape of a real receipt: unlinked source plus a question asked in prose.
    const feedback: string[][] = [];
    const result = await runTeachingDrafts({ turn,
      judge: judge(request => String((request.state as { reply?: { text?: string } }).reply?.text).includes("repaired") ? {}
        : { source_link_missing: .47, checkpoint_not_interactive: .62 }),
      generate: async input => {
        feedback.push(input.feedback.map(entry => entry.id));
        return { reply: { text: feedback.length > 1 ? "A repaired reply." : "A first reply.", toolCalls: [] }, value: `draft-${feedback.length}` };
      } });
    expect(feedback).toEqual([[], ["source_link_missing", "checkpoint_not_interactive"]]);
    expect(result).toMatchObject({ status: "released", value: "draft-2" });
    expect(result.receipt.reason).not.toBe("best-effort-draft");
  });

  test("an unanswered review does not spend a repair", async () => {
    let generated = 0;
    const result = await runTeachingDrafts({ turn, judge: async (request, signal) => (request.state as { reply?: unknown }).reply
      ? { ok: false, error: { code: "backend-unavailable", retryable: false } } : judge()(request, signal),
      generate: async () => { generated++; return generate(); } });
    expect(generated).toBe(1);
    expect(result.receipt.reason).toBe("best-effort-draft");
  });

  test("a confirmed checkpoint leak cannot be released through best effort", async () => {
    const confirmed = await runTeachingDrafts({ turn, maxAttempts: 1, judge: judge(() => ({ checkpoint_answer_leaked: .95 })), generate });
    expect(confirmed.status).toBe("withheld");
    const assessed = await runTeachingDrafts({ turn: { ...turn, assessment: "assessed" }, maxAttempts: 1,
      judge: judge(() => ({ checkpoint_answer_leaked: .4 })), generate });
    expect(assessed.status).toBe("released");
    expect(assessed.receipt.attempts[0]!.checks.find(check => check.id === "checkpoint_answer_leaked")?.severity).toBe("critical");
  });

  describe("recovery before checkpoint review", () => {
    const checkpoint = 'Try the next case.\n\n```openui lifecycle=ephemeral id=example\n'
      + 'root = LearningSurface([q], "Choose a path", "", "ephemeral")\n'
      + 'q = Question([{header: "Next topic", question: "Which path would you like?", type: "choice", choices: ["Poetry", "Essays"]}], "ephemeral")\n```';
    const raw = checkpoint + "\n\nTake your pick and tell me why.";
    const candidate = async () => ({ reply: { text: raw, toolCalls: [] }, value: { providerId: "fixture" } });

    test.each([true, false])("the tutor gets one repair for a requested learner response left in prose; repair valid %s", async validRepair => {
      const text = "Which learning path would you like to choose?";
      const feedback: string[][] = [];
      const result = await runTeachingDrafts({ turn, maxAttempts: 5, judge: judge(request => {
        const state = request.state as { reply?: { text: string } };
        return { learning_task: .99, learner_response_due: .95, checkpoint_not_interactive: state.reply?.text === text ? .97 : .01,
          draft_choice: "draft_2" };
      }), generate: async input => {
        feedback.push(input.feedback.map(x => x.id));
        return { reply: { text: input.attempt === 1 ? text : validRepair ? checkpoint : "```openui\ninvalid", toolCalls: [] }, value: input.attempt };
      } });
      expect(feedback).toEqual([[], ["checkpoint_not_interactive"]]);
      expect(result).toMatchObject({ status: "released", reply: { text: validRepair ? checkpoint : text }, value: validRepair ? 2 : 1 });
    });

    test.each(["plain", "no learner response", "tool", "useful prose"])("a recommendation alone does not spend a repair: %s", async mode => {
      const calls = mode === "tool" ? [{ name: "read", arguments: {} }] : [];
      const result = await runTeachingDrafts({ turn: { ...turn, availableTools: ["read"] }, judge: judge(() => ({
        learning_task: .99, prediction_opportunity: .95, learner_response_due: mode === "no learner response" ? .01 : .95,
        plain_reply_requested: mode === "plain" ? .99 : .01, checkpoint_not_interactive: mode === "useful prose" ? .01 : .97,
      })), generate: async () => ({ reply: { text: calls.length ? "" : "A concise answer.", toolCalls: calls }, value: 1 }) });
      expect(result.receipt.attempts).toHaveLength(1);
      expect(result).toMatchObject({ status: "released", value: 1 });
    });

    test("an existing checkpoint is kept when only the prose-question reviewer disagrees", async () => {
      const result = await runTeachingDrafts({ turn, judge: judge(() => ({
        learning_task: .99, learner_response_due: .95, checkpoint_not_interactive: .97,
      })), generate: async () => ({ reply: { text: checkpoint, toolCalls: [] }, value: 1 }) });
      expect(result.receipt.attempts).toHaveLength(1);
      expect(result.reply?.text).toBe(checkpoint);
    });

    test("a terminal checkpoint also needs an answered leak check in a narrowed review", async () => {
      const result = await runTeachingDrafts({ turn, maxAttempts: 1, ruleIds: [],
        judge: judge(() => ({ checkpoint_answer_leaked: .5 })), generate: async () => ({ reply: { text: checkpoint, toolCalls: [] }, value: 1 }) });
      expect(result.status).toBe("withheld");
      expect(result.receipt.attempts[0]?.trimmedCheckpointSuffix).toBeUndefined();
      expect(result.receipt.attempts[0]?.checks.find(check => check.id === "checkpoint_answer_leaked")?.status).toBe("unknown");
    });

    test.each([["ordinary", .49, "released"], ["extended", .49, "withheld"], ["ordinary", .64, "withheld"]] as const)(
      "%s gate handles repetition probability %s on a repaired checkpoint", async (refinement, checkpoint_repeated, status) => {
        const result = await runTeachingDrafts({ turn, maxAttempts: 1, refinement, judge: judge(() => ({ checkpoint_repeated })), generate: candidate });
        expect(result.status).toBe(status);
        expect(result.receipt.attempts[0]?.checks.find(c => c.id === "checkpoint_repeated")?.probability).toBe(checkpoint_repeated);
      });

    test("a failed mandatory review cannot publish an intact checkpoint through best effort", async () => {
      for (const scores of [{ checkpoint_repeated: .71 }, { checkpoint_continued: .5 }, { tool_success_invented: .9 }]) {
        const result = await runTeachingDrafts({ turn, maxAttempts: 1, judge: judge(() => scores),
          generate: async () => ({ reply: { text: checkpoint, toolCalls: [] }, value: 1 }) });
        expect(result.status).toBe("withheld");
      }
    });

    test("an ordinary selector can consider uncertain repetition when comparing otherwise useful approved replies", async () => {
      let selector = "";
      const result = await runTeachingDrafts({ turn, maxAttempts: 2, collectAllAttempts: true,
        generate: async input => ({ reply: { text: checkpoint.replace("Try the next case.", "Option " + input.attempt), toolCalls: [] }, value: 1 }),
        judge: judge(req => { if (req.questions.draft_choice) selector = JSON.stringify(req.questions.draft_choice); return { checkpoint_repeated: .48 }; }) });
      expect(result.status).toBe("released");
      expect(selector).toContain("surrounding introduction");
    });

    test("semantic review, host validation and publication see the same trimmed response; inspection still sees raw output", async () => {
      const reviewed: string[] = [], validated: string[] = [], generated: string[] = [];
      const result = await runTeachingDrafts({ turn, maxAttempts: 1, ruleIds: [], generate: async input => {
        expect(input.variant).toBe("default");
        return candidate();
      },
      onDraftContent: entry => { generated.push(entry.text); },
      judge: judge(req => {
        const state = req.state as { reply?: { text: string } };
        if (state.reply) {
          reviewed.push(state.reply.text);
          expect(req.questions.checkpoint_answer_leaked).toBeDefined();
          expect(req.questions.tool_success_invented).toBeDefined();
        }
        return {};
      }), check: reply => { validated.push(reply.text); return []; } });
      expect(generated).toEqual([raw]);
      expect(reviewed).toEqual([checkpoint]);
      expect(validated).toEqual([checkpoint]);
      expect(result).toMatchObject({ status: "released", reply: { text: checkpoint, toolCalls: [] }, value: { providerId: "fixture" } });
      expect(result.receipt).toMatchObject({ selectedAttempt: 1, attempts: [{ trimmedCheckpointSuffix: true, status: "pass" }] });
      expect(JSON.stringify(result.receipt)).not.toContain("Poetry");
    });

    test.each(["answer-leak", "unknown-leak", "host", "unsupported-claim", "unreviewed"])("a repaired candidate cannot bypass %s through best effort", async mode => {
      const base = judge(() => ({ checkpoint_answer_leaked: mode === "answer-leak" ? .95 : mode === "unknown-leak" ? .48 : .01,
        tool_success_invented: mode === "unsupported-claim" ? .95 : .01 }));
      const result = await runTeachingDrafts({ turn, maxAttempts: 1, generate: candidate,
        judge: async (req, signal) => mode === "unreviewed" && req.questions.quality_progress
          ? { ok: false, error: { code: "backend-unavailable", retryable: false } } : base(req, signal),
        check: () => mode === "host" ? [{ id: "host-evidence", source: "deterministic", severity: "critical", status: "fail", probability: 1 }] : [],
      });
      expect(result.status).toBe("withheld");
      expect(result.reply).toBeUndefined();
      expect(result.receipt.selectedAttempt).toBeNull();
      expect(result.receipt.attempts[0]?.trimmedCheckpointSuffix).toBe(true);
    });
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

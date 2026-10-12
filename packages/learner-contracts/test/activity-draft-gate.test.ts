import { describe, expect, test } from "bun:test";
import { activityObservationFeatures, projectActivityObservations, type ActivitySelectionInput } from "../src/judgement/activity-observations.js";
import type { JudgementAnswer, JudgementCaller, JudgementRequest } from "../src/judgement/contracts.js";
import { runTeachingDrafts } from "../src/judgement/teaching-drafts.js";
import type { TeachingPolicyTurn } from "../src/judgement/teaching-policy-types.js";
import type { ActivitySelectionReceipt } from "../src/judgement/activity-learning.js";

const turn: TeachingPolicyTurn = { learnerMessage: "Please explain this PRIVATE request", conversation: [],
  learnerEvidence: [], availableTools: [], toolResults: [], sources: [], assessment: "none", improvementRuns: 0, domain: "general" };
function judge(choice = "draft_1"): JudgementCaller {
  return async (request: JudgementRequest) => ({ ok: true, response: {
    backend: { backend: "fixture", model: "fixture-v1", calibrationSha256: null },
    answers: Object.fromEntries(Object.entries(request.questions).map(([id, question]): [string, JudgementAnswer] => {
      if (question.type === "choice") {
        const selected = id === "draft_standard" ? "supported" : choice;
        return [id, { type: "choice", choice: selected, confidence: .99,
          probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === selected ? 1 : 0])) }];
      }
      if (question.type === "score") return [id, { type: "score", score: 0, confidence: 1,
        legend: Object.fromEntries(question.criteria.map((entry, index) => [index, entry])),
        probabilities: Object.fromEntries(question.criteria.map((_, index) => [index, index === 0 ? 1 : 0])) }];
      return [id, { type: "noul", noul: id.startsWith("quality_") ? .99 : id === "learner_stuck" ? .5 : .01 }];
    })),
  } });
}
const generate = async ({ attempt }: { attempt: number }) => ({ reply: { text: `PRIVATE candidate ${attempt}`, toolCalls: [] }, value: attempt });
function receipt(selectedAttempt: number): ActivitySelectionReceipt {
  return { version: 1, status: "active", target: "next-linked-objective-score", model: "v3.5_default", asOf: 1000,
    baselineAttempt: 1, selectedAttempt, counts: { exposures: 30, labelled: 30, train: 24, validation: 6, candidates: 2 },
    validation: { kind: "squared-error", modelLoss: .1, baselineLoss: .2, passed: true },
    predictedScores: [{ attempt: 1, score: .3 }, { attempt: 2, score: .8 }], reasons: [],
    scope: "chronological-within-learner", causal: false, unaidedLearning: "unknown" };
}

describe("activity observations", () => {
  test("ambiguous interpretations remain probabilities and absent observations remain unknown", () => {
    const result = projectActivityObservations(turn, { ok: true, response: {
      backend: { backend: "fixture", model: "fixture-v1", calibrationSha256: null },
      answers: { learner_stuck: { type: "noul", noul: .5 }, practice_requested: { type: "noul", noul: 0 } },
    } });
    expect(result.inferred.learner_stuck).toBe(.5);
    expect(result.inferred.practice_requested).toBe(0);
    expect(result.inferred.explanation_requested).toBeNull();
    expect(result.observed.focusCorrect).toBeNull();
    const features = activityObservationFeatures(result);
    expect(features).toHaveLength(22);
    expect(features.slice(8, 16)).toEqual([0, 1, 0, 0, 1, 0, 0, 0]);
    expect(features.slice(16)).toEqual([-1, -1, -1, -1, 0, 0]);
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
});

describe("optional activity selection cannot weaken the draft gate", () => {
  test("default background mode never calls or awaits a hosted selector and records the released choice", async () => {
    let called = false;
    const result = await runTeachingDrafts({ turn, judge: judge(), generate, recordActivity: true,
      activityLearning: () => { called = true; return new Promise(() => {}); } });
    expect(called).toBe(false);
    expect(result.status).toBe("released");
    expect(result.value).toBe(1);
    expect(result.activitySelection?.candidate.reply).toEqual(result.reply!);
    expect(result.activitySelection?.receipt.validation).toBeNull();
    expect(result.activitySelection?.receipt.predictedScores).toEqual([]);
  });

  test("recording a baseline does not publish a host-rejected response", async () => {
    const result = await runTeachingDrafts({ turn, judge: judge(), generate, recordActivity: true,
      check: () => [{ id: "host", source: "deterministic", severity: "critical", status: "fail", probability: 1 }] });
    expect(result.status).toBe("withheld");
    expect(result.activitySelection).toBeUndefined();
  });

  test("background observation never records tool calls as learner activities", async () => {
    const result = await runTeachingDrafts({ turn: { ...turn, availableTools: ["read"] }, judge: judge(), recordActivity: true,
      generate: async () => ({ value: 1, reply: { text: "Reading the requested source.", toolCalls: [{ name: "read", arguments: { path: "lesson.md" } }] } }) });
    expect(result.status).toBe("released");
    expect(result.activitySelection).toBeUndefined();
  });

  test("a supported selection releases exactly the reviewed alternative with content-free progress", async () => {
    const progress: unknown[] = [];
    const result = await runTeachingDrafts({ activityLearningMode: "live", turn, judge: judge(), generate, onProgress: value => progress.push(value),
      activityLearning: async input => {
        expect(input.baselineAttempt).toBe(1);
        expect(input.candidates).toHaveLength(2);
        return { attempt: 2, receipt: { ...receipt(2), untrustedExtra: "PRIVATE receipt payload" } };
      } });
    expect(result.status).toBe("released");
    expect(result.value).toBe(2);
    expect(result.reply?.text).toBe("PRIVATE candidate 2");
    expect(result.activitySelection?.candidate.reply).toEqual(result.reply!);
    expect(result.receipt.selectedAttempt).toBe(2);
    expect(result.receipt.activityLearning?.selectedAttempt).toBe(2);
    expect(JSON.stringify(progress)).not.toContain("PRIVATE");
    expect(JSON.stringify(result.receipt)).not.toContain("PRIVATE");
  });

  test("an unapproved attempt returned by a selector cannot replace the baseline", async () => {
    const result = await runTeachingDrafts({ activityLearningMode: "live", turn, judge: judge(), generate,
      activityLearning: async () => ({ attempt: 999, receipt: receipt(999) }) });
    expect(result.status).toBe("released");
    expect(result.value).toBe(1);
    expect(result.activitySelection).toBeUndefined();
  });

  test("a validation failure cannot switch even to a checked alternative", async () => {
    const result = await runTeachingDrafts({ activityLearningMode: "live", turn, judge: judge(), generate,
      activityLearning: async () => ({ attempt: 2, receipt: { ...receipt(2), status: "baseline-retained",
        validation: { kind: "squared-error", modelLoss: .3, baselineLoss: .2, passed: false } } }) });
    expect(result.status).toBe("released");
    expect(result.value).toBe(1);
    expect(result.activitySelection).toBeUndefined();
  });

  test("predictor failure preserves the semantic choice and gets detached approved candidates", async () => {
    let input: ActivitySelectionInput | undefined;
    const result = await runTeachingDrafts({ activityLearningMode: "live", turn, judge: judge(), generate,
      activityLearning: async value => {
        input = value;
        (value.candidates[0]!.reply as { text: string }).text = "UNREVIEWED";
        throw new Error("provider unavailable");
      } });
    expect(input?.observations.inferred.learner_stuck).toBe(.5);
    expect(input?.candidates.map(candidate => candidate.attempt)).toEqual([1, 2]);
    expect(result.status).toBe("released");
    expect(result.value).toBe(1);
    expect(result.reply?.text).toBe("PRIVATE candidate 1");
    expect(result.activitySelection).toBeUndefined();
  });

  test("comparison fallback releases a reviewed draft without calling the predictor", async () => {
    let called = false;
    const result = await runTeachingDrafts({ activityLearningMode: "live", turn, judge: judge("no_match"), generate,
      activityLearning: async () => { called = true; throw new Error("should not run"); } });
    expect(result.status).toBe("released");
    expect(result.receipt.reason).toBe("selection-quality-fallback");
    expect(called).toBe(false);
  });

  test("host-rejected candidates never call the predictor", async () => {
    let called = false;
    const result = await runTeachingDrafts({ activityLearningMode: "live", turn, judge: judge(), generate,
      check: () => [{ id: "runtime_tool_schema", source: "deterministic", severity: "critical", status: "fail", probability: 1 }],
      activityLearning: async () => { called = true; throw new Error("should not run"); } });
    expect(result.status).toBe("withheld");
    expect(called).toBe(false);
  });

  test("cancelling during prediction cannot publish an approved reply", async () => {
    const controller = new AbortController();
    const result = await runTeachingDrafts({ activityLearningMode: "live", turn, judge: judge(), generate, signal: controller.signal,
      activityLearning: async () => { controller.abort(); throw new Error("stopped"); } });
    expect(result.status).toBe("cancelled");
    expect(result.reply).toBeUndefined();
    expect(result.activitySelection).toBeUndefined();
  });

  test("tool operations retain the semantic choice and never enter activity ranking", async () => {
    let called = false;
    const result = await runTeachingDrafts({ activityLearningMode: "live", turn: { ...turn, availableTools: ["read"] }, judge: judge(),
      generate: async ({ attempt }) => ({ value: attempt, reply: { text: "I will read the supplied material.",
        toolCalls: [{ name: "read", arguments: { path: "lesson.md" } }] } }),
      activityLearning: async () => { called = true; throw new Error("should not run"); } });
    expect(result.status).toBe("released");
    expect(result.value).toBe(1);
    expect(called).toBe(false);
  });

  test("optional timeout keeps an already approved reply inside the total budget", async () => {
    const result = await runTeachingDrafts({ activityLearningMode: "live", turn, judge: judge(), generate, timeoutMs: 850,
      activityLearning: async () => new Promise(() => {}) });
    expect(result.status).toBe("released");
    expect(result.value).toBe(1);
  });

  test("skips optional work when no safe time remains", async () => {
    let clock = 0;
    let called = false;
    const semantic = judge();
    const result = await runTeachingDrafts({ activityLearningMode: "live", turn, generate, timeoutMs: 1000, now: () => clock,
      judge: async (request, signal) => { if (request.questions.draft_choice) clock = 800; return semantic(request, signal); },
      activityLearning: async () => { called = true; throw new Error("should not run"); } });
    expect(result.status).toBe("released");
    expect(called).toBe(false);
  });
});

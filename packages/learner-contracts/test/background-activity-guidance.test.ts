import { expect, test } from "bun:test";
import { applyBackgroundActivityGuidance } from "../src/judgement/background-activity-guidance.js";
import { BACKGROUND_ACTIVITY_POLICY, type BackgroundActivityPolicy } from "../src/judgement/background-activity-policy.js";
import { ACTIVITY_QUESTION_FINGERPRINT, activityObservationFeatures, projectActivityObservations } from "../src/judgement/activity-observations.js";
import { teachingPolicyDecisionRequest, projectTeachingPolicyDecision } from "../src/judgement/teaching-policy.js";
import { runTeachingDrafts } from "../src/judgement/teaching-drafts.js";
import type { JudgementAnswer, JudgementCaller } from "../src/judgement/contracts.js";
import type { TeachingPolicyTurn } from "../src/judgement/teaching-policy-types.js";

const turn: TeachingPolicyTurn = { learnerMessage: "Explain how these categories differ.", conversation: [], learnerEvidence: [],
  availableTools: [], toolResults: [], sources: [], assessment: "none", improvementRuns: 0, domain: "general" };
const judge: JudgementCaller = async request => ({ ok: true, response: {
  backend: { backend: "fixture", model: "fixture-v1", calibrationSha256: null },
  answers: Object.fromEntries(Object.entries(request.questions).map(([id, question]): [string, JudgementAnswer] => {
    if (question.type === "choice") {
      const selected = id === "draft_standard" ? "supported" : "draft_1";
      return [id, { type: "choice", choice: selected, confidence: 1,
        probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, Number(key === selected)])) }];
    }
    if (question.type === "score") return [id, { type: "score", score: 0, confidence: 1,
      legend: Object.fromEntries(question.criteria.map((entry, index) => [index, entry])),
      probabilities: Object.fromEntries(question.criteria.map((_, index) => [index, Number(index === 0)])) }];
    return [id, { type: "noul", noul: id.startsWith("quality_") || id === "learning_task" || id === "category_distinction" ? .99 : .01 }];
  })),
} });

async function fixture() {
  const outcome = await judge(teachingPolicyDecisionRequest(turn));
  const observations = projectActivityObservations(turn, outcome), features = activityObservationFeatures(observations);
  const plan = projectTeachingPolicyDecision(turn, outcome);
  const createdAt = Date.now() - 1000;
  // A validated artifact fixture exercises serving, not research-quality claims.
  const policy: BackgroundActivityPolicy = { version: 1, featureVersion: BACKGROUND_ACTIVITY_POLICY.featureVersion,
    questionFingerprint: ACTIVITY_QUESTION_FINGERPRINT, model: "v3.5_default", judgeModel: "fixture-v1", createdAt,
    expiresAt: createdAt + BACKGROUND_ACTIVITY_POLICY.ttlMs, kinds: ["prose", "question"],
    bounds: { min: [...features], max: [...features] }, prototypes: [{ features: [...features], scores: [.2, .8] }],
    trainRows: 24, validation: { kind: "squared-error", modelLoss: .1, localLoss: .1, baselineLoss: .2, rows: 6, coveredRows: 6, passed: true },
    target: "next-linked-objective-score", scope: "chronological-within-learner", causal: false };
  return { observations, plan, policy };
}

test("saved preferences guide only existing permitted activities and preserve the original plan", async () => {
  const { plan, observations, policy } = await fixture(), original = structuredClone(plan);
  const guided = applyBackgroundActivityGuidance(plan, observations, policy);
  expect(guided.guidance?.preferredKind).toBe("question");
  expect(guided.plan.directives.at(-1)).toContain("preferring a question");
  expect(guided.plan.allowedTools).toEqual(plan.allowedTools);
  expect(guided.plan.decisions).toEqual(plan.decisions);
  expect(plan).toEqual(original);
  policy.kinds = ["prose", "simulation"];
  expect(applyBackgroundActivityGuidance(plan, observations, policy).guidance).toBeUndefined();
});

test("saved prose preference cannot override explicit practice, continuation, or pending grading", async () => {
  const { plan, observations, policy } = await fixture();
  policy.prototypes[0].scores = [.9, .1];
  const practice = { ...plan, decisions: { ...plan.decisions, practice_requested: true } };
  expect(applyBackgroundActivityGuidance(practice, observations, policy).guidance).toBeUndefined();
  for (const action of ["continue", "grade-first", "none"] as const) {
    const held = { ...plan, interaction: { ...plan.interaction, action } };
    expect(applyBackgroundActivityGuidance(held, observations, policy).plan).toBe(held);
    expect(applyBackgroundActivityGuidance(held, observations, policy).guidance).toBeUndefined();
  }
});

test("stale policy and changed question meanings fall back before generation", async () => {
  const { plan, observations, policy } = await fixture();
  expect(applyBackgroundActivityGuidance(plan, observations, policy, policy.expiresAt).guidance).toBeUndefined();
  expect(applyBackgroundActivityGuidance(plan, { ...observations, questionFingerprint: "changed" }, policy).guidance).toBeUndefined();
  expect(applyBackgroundActivityGuidance(plan, observations, { ...policy, questionFingerprint: "changed" }).guidance).toBeUndefined();
});

test("an update during planning cannot change this turn's captured policy", async () => {
  const { policy } = await fixture();
  const prompts: string[] = [];
  let selectorPreference: unknown;
  const pending = runTeachingDrafts({ turn, backgroundActivityPolicy: policy, recordActivity: true,
    judge: async (request, signal) => {
      if (request.questions.draft_standard) policy.prototypes[0].scores = [.99, .01];
      if (request.questions.draft_choice) selectorPreference = (request.state as Record<string, unknown>).backgroundPreference;
      return judge(request, signal);
    },
    generate: async input => { prompts.push(input.systemPrompt); return { value: input.attempt,
      reply: { text: "Here is a concrete explanation of the distinction.", toolCalls: [] } }; },
    activityLearning: async () => { throw Error("Hosted ranking must never run in background mode."); },
  });
  const result = await pending;
  expect(result.status).toBe("released");
  expect(result.receipt.backgroundActivity?.preferredKind).toBe("question");
  expect(prompts.every(prompt => prompt.includes("preferring a question"))).toBe(true);
  expect((selectorPreference as { preferredKind: string }).preferredKind).toBe("question");
  expect(result.activitySelection?.candidate.reply).toEqual(result.reply!);
});

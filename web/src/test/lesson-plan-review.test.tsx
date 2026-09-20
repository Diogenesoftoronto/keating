import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { JudgementRequest, JudgementResponse } from "@keating/learner-contracts";
import { saveAndReviewLessonPlan, renderedLessonPlanInput } from "../keating/judgement/lesson-plan-review";
import type { WebJudgementRuntime } from "../keating/judgement/runtime";
import type { LessonPlan } from "../keating/storage";
import { LessonPlanJudgementReview } from "../components/LessonPlanJudgementReview";

const plan = { id: "generated-plan", title: "Halves", overview: "Explain equal parts.", items: [{ id: "draw", title: "Draw halves", detail: "Draw two equal parts.", outcomes: ["Identify one half"], dependsOn: ["equal-parts"] }] };
const backend = { backend: "system-one" as const, model: "jev-plan-fixture", calibrationSha256: null };
function fixture(preference: "off" | "local" | "hosted" = "hosted") {
  const plans: LessonPlan[] = []; let calls = 0; const events: string[] = [];
  const runtime: WebJudgementRuntime = { settings: { backend: preference, localModelId: "local-test", gatewayPath: "/api/judgement" }, policy: { calibration: { entries: {} }, tiers: [{ key: backend, call: async (request: JudgementRequest) => {
    calls++; events.push("inference"); expect(plans).toHaveLength(1);
    const response: JudgementResponse = { backend, answers: Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
      if (question.type !== "choice") throw Error("Expected Choice"); const keys = Object.keys(question.criteria);
      return [id, { type: "choice", choice: keys[0], confidence: 1, probabilities: Object.fromEntries(keys.map((key, i) => [key, i === 0 ? 1 : 0])) }];
    })) }; return { ok: true, response };
  } }] } };
  const storage = { saveLessonPlan: async (topic: string, content: string, metadata?: Record<string, unknown>) => {
    events.push("saved"); const saved = { id: "saved-plan", topic, content, metadata, createdAt: 1, updatedAt: 1, sessionId: "own-session" }; plans.push(saved); return saved;
  }, getLessonPlans: async () => plans };
  return { plans, storage, runtime, events, calls: () => calls };
}
test("actual browser adapter saves exact authored plan before asynchronous review and validates persisted source", async () => {
  const f = fixture(), input = renderedLessonPlanInput(plan);
  expect(input.content).toContain("Prerequisites: equal-parts"); expect(input.content).toContain("Outcome: Identify one half");
  const result = await saveAndReviewLessonPlan({ input, storage: f.storage, runtime: f.runtime, currentInput: () => input, onSaved: () => f.events.push("saved-notification") });
  expect(f.events).toEqual(["saved", "saved-notification", "inference", "inference"]);
  expect(result.review.status).toBe("estimated"); expect(result.saved.content).toBe(input.content); expect(f.plans[0].content).toBe(input.content);
  const stale = fixture();
  const rejected = await saveAndReviewLessonPlan({ input, storage: stale.storage, runtime: stale.runtime, currentInput: () => ({ ...input, content: "changed" }) });
  expect(rejected.review).toMatchObject({ status: "unavailable", reason: "stale" }); expect(stale.plans).toHaveLength(1);
});
test("off/local modes never use hosted inference and failed saving never dispatches", async () => {
  const input = renderedLessonPlanInput(plan);
  for (const mode of ["off", "local"] as const) {
    const f = fixture(mode); const result = await saveAndReviewLessonPlan({ input, storage: f.storage, runtime: f.runtime, currentInput: () => input });
    expect(f.calls()).toBe(0); expect(f.plans).toHaveLength(1); expect(result.review.status).not.toBe("estimated");
  }
  const failed = fixture();
  await expect(saveAndReviewLessonPlan({ input, storage: { ...failed.storage, saveLessonPlan: async () => { throw Error("disk unavailable"); } }, runtime: failed.runtime, currentInput: () => input })).rejects.toThrow("disk unavailable");
  expect(failed.calls()).toBe(0);
});
test("review control is passive, disabled during generation and excludes progress from sent plan text", () => {
  const html = renderToStaticMarkup(<LessonPlanJudgementReview plan={plan} disabled />);
  expect(html).toContain("Save &amp; review plan"); expect(html).toContain("disabled"); expect(html).toContain("complete and active");
  const withProgress = { ...plan, privateNotes: "DO NOT SEND", items: plan.items.map(item => ({ ...item, status: "done", learnerAnswer: "PRIVATE ANSWER" })) };
  expect(renderedLessonPlanInput(withProgress)).toEqual(renderedLessonPlanInput(plan));
});

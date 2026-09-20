import { reviewLessonPlan, type LessonPlanReview, type LessonPlanReviewInput } from "../../../../shared/pedagogy/lesson-plan-judgement";
import { createWebJudgementRuntime, type WebJudgementRuntime } from "./runtime";
import { createJudgementOperationCaller } from "./operation";
import type { LessonPlan } from "../storage";

export interface ReviewablePlanItem { id: string; title: string; detail?: string; outcomes?: readonly string[]; dependsOn?: readonly string[]; children?: readonly ReviewablePlanItem[] }
export interface ReviewableStudyPlan { id: string; title: string; overview?: string; items: readonly ReviewablePlanItem[]; relatedPlans?: readonly { planId: string; title: string; relation?: string; detail?: string }[] }
/** Authored fields only. Completion/progress state and other learner work are excluded. */
export function renderedLessonPlanInput(plan: ReviewableStudyPlan): LessonPlanReviewInput {
  const lines = [`# ${plan.title}`, "", ...(plan.overview ? [plan.overview, ""] : [])];
  const visit = (items: readonly ReviewablePlanItem[], depth: number) => {
    for (const item of items) {
      lines.push(`${"#".repeat(Math.min(depth + 2, 6))} ${item.title} [${item.id}]`);
      if (item.detail) lines.push(item.detail);
      for (const outcome of item.outcomes ?? []) lines.push(`Outcome: ${outcome}`);
      if (item.dependsOn?.length) lines.push(`Prerequisites: ${item.dependsOn.join(", ")}`);
      lines.push(""); if (item.children) visit(item.children, depth + 1);
    }
  };
  visit(plan.items, 0);
  for (const link of plan.relatedPlans ?? []) lines.push(`Linked plan (${link.relation ?? "related"}): ${link.title} [${link.planId}]. ${link.detail ?? ""} Contents not supplied.`);
  return { id: plan.id, title: plan.title, content: lines.join("\n") };
}
export interface LessonPlanReviewStorage {
  saveLessonPlan(topic: string, content: string, metadata?: Record<string, unknown>): Promise<LessonPlan>;
  getLessonPlans(topic?: string): Promise<LessonPlan[]>;
}
/** Save completes before runtime construction or inference; failures never undo the saved plan. */
export async function saveAndReviewLessonPlan(options: {
  input: LessonPlanReviewInput; storage: LessonPlanReviewStorage; runtime?: WebJudgementRuntime; signal?: AbortSignal;
  currentInput: () => LessonPlanReviewInput | null; onSaved?: (plan: LessonPlan) => void;
}): Promise<{ saved: LessonPlan; review: LessonPlanReview }> {
  const input = { ...options.input };
  const saved = await options.storage.saveLessonPlan(input.title, input.content, { type: "lesson-plan", sourcePlanId: input.id, judgementReviewRequested: true });
  options.onSaved?.(saved);
  const runtime = options.runtime ?? createWebJudgementRuntime();
  const call = createJudgementOperationCaller({ runtime,
    diagnostics: { origin: "lesson-plan-review", application: "Saved plan; reviewer suggestions only" }, accept: () => true });
  const review = await reviewLessonPlan(input, runtime.settings.backend === "off" ? null : call, { signal: options.signal, fresh: async () => {
    const current = options.currentInput();
    const persisted = (await options.storage.getLessonPlans(input.title)).find(row => row.id === saved.id);
    return current && persisted?.content === input.content && persisted.sessionId === saved.sessionId ? current : null;
  } });
  return { saved, review };
}

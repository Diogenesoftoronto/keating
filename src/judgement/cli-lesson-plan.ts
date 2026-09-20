import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { reviewLessonPlan, lessonPlanReviewMarkdown, type LessonPlanReview } from "../../shared/pedagogy/lesson-plan-judgement.js";
import { createCliJudgementBackend, JUDGEMENT_MODEL_ENV, type CliJudgementOptions } from "./transport.js";

export const LESSON_PLAN_JUDGE_ENV = "KEATING_LESSON_PLAN_JUDGE";
export interface CliLessonPlanReviewOptions {
  env?: Readonly<Record<string, string | undefined>>;
  transport?: Pick<CliJudgementOptions, "fetch" | "loadCredential" | "now" | "retry" | "sleep">;
  signal?: AbortSignal;
}
/** Dedicated account opt-in; tutor model and direct provider secrets are not inherited. */
export async function reviewCliLessonPlan(cwd: string, planPath: string, title: string, options: CliLessonPlanReviewOptions = {}): Promise<{ reviewStatus: LessonPlanReview["status"]; reviewPath?: string; reviewReceiptPath?: string }> {
  const env = options.env ?? process.env;
  if (env[LESSON_PLAN_JUDGE_ENV] !== "notorganic") return { reviewStatus: "not-requested" };
  const input = { id: planPath, title, content: await readFile(planPath, "utf8") };
  let backend: ReturnType<typeof createCliJudgementBackend> = null;
  try { backend = createCliJudgementBackend({ ...options.transport, cwd, env: { [JUDGEMENT_MODEL_ENV]: env[JUDGEMENT_MODEL_ENV] } }); } catch { /* The saved plan remains usable. */ }
  const call = backend?.call ?? (async () => ({ ok: false as const, error: { code: "backend-unavailable" as const, retryable: false } }));
  const timeout = AbortSignal.timeout(30_000), signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const review = await reviewLessonPlan(input, call, { signal, fresh: async () => ({ ...input, content: await readFile(planPath, "utf8") }) });
  const stem = `${planPath}.review-${randomUUID()}`;
  const reviewPath = `${stem}.md`, reviewReceiptPath = `${stem}.json`;
  await writeFile(reviewReceiptPath, `${JSON.stringify(review, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  await writeFile(reviewPath, lessonPlanReviewMarkdown(input, review), { flag: "wx", mode: 0o600 });
  return { reviewStatus: review.status, reviewPath, reviewReceiptPath };
}

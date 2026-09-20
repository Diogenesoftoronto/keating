/** Typed grading for saved browser assessments; proposals never become final grades. */
import {
  gradeOpenResponses, proposeOpenResponses,
  type OpenResponseGradeInput, type OpenResponseGradeResult, type UiQuestion,
} from "@keating/learner-contracts";
import { createWebJudgementRuntime, type WebJudgementRuntime } from "./runtime";
import { createJudgementOperationCaller } from "./operation";

export interface BrowserQuestionJudgement {
  readonly final: OpenResponseGradeResult;
  readonly proposal: Awaited<ReturnType<typeof proposeOpenResponses>>[number]["proposal"];
  readonly evidenceKind: "model-estimate" | "calibrated-model-grade" | "deterministic" | "unavailable";
}

/** Preferences and goals without an assessment reference/rubric are not graded. */
export function isSemanticAssessmentQuestion(question: UiQuestion): boolean {
  const kind = question.kind ?? (question.choices?.length ? "choice" : "text");
  return !question.mathProblem && (kind === "text" || kind === "short_answer" || kind === "transfer"
    || (kind === "fill_in" && !question.blanks?.length && !question.correctAnswers?.length))
    && Boolean(question.correctAnswer?.trim() || question.rubric?.trim());
}

export function browserQuestionGradeInput(id: string, question: UiQuestion, answer: string): OpenResponseGradeInput {
  return { id, question: question.prompt, learnerAnswer: answer,
    ...(question.correctAnswer === undefined ? {} : { referenceAnswer: question.correctAnswer }),
    ...(question.rubric === undefined ? {} : { rubric: question.rubric }) };
}

export async function reviewBrowserQuestionChecks(
  inputs: readonly OpenResponseGradeInput[],
  runtime: WebJudgementRuntime = createWebJudgementRuntime(),
  signal?: AbortSignal,
): Promise<BrowserQuestionJudgement[]> {
  const final = await gradeOpenResponses(inputs, runtime.policy, signal);
  const pending = final.filter(result => result.grading === "pending");
  const pendingIds = new Set(pending.map(result => result.id));
  const estimates = runtime.settings.backend === "off" || signal?.aborted || !pending.length ? []
    : await proposeOpenResponses(inputs.filter(input => pendingIds.has(input.id)), createJudgementOperationCaller({
      runtime,
      accept: response => response.answers.score?.type === "score",
    }), signal);
  const byId = new Map(estimates.map(result => [result.id, result.proposal]));
  return final.map(result => {
    const proposal = byId.get(result.id) ?? null;
    return { final: result, proposal,
      evidenceKind: result.grading === "auto" ? "deterministic" : result.grading === "model"
        ? "calibrated-model-grade" : proposal ? "model-estimate" : "unavailable" };
  });
}

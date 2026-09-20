import { gradeOpenResponses, proposeOpenResponses, type LearnerQuestionCheck, type OpenResponseGradeInput,
  type OpenResponseGradeResult, type UiDocument, type UiQuestion } from "@keating/learner-contracts";
import { configuredMobileJudgementRuntime, type MobileJudgementRuntime } from "./runtime";

export interface MobileQuestionJudgement {
  final: OpenResponseGradeResult;
  proposal: Awaited<ReturnType<typeof proposeOpenResponses>>[number]["proposal"];
  evidenceKind: "model-estimate" | "calibrated-model-grade" | "deterministic" | "unavailable";
}

/** Preferences and diagnostic questions with no authored assessment criteria stay ungraded. */
export function isMobileSemanticQuestion(question: UiQuestion): boolean {
  const kind = question.kind ?? (question.choices?.length ? "choice" : "text");
  return !question.mathProblem && (kind === "text" || kind === "short_answer" || kind === "transfer"
    || (kind === "fill_in" && !question.blanks?.length && !question.correctAnswers?.length))
    && Boolean(question.correctAnswer?.trim() || question.rubric?.trim());
}

export interface MobileQuestionReviewInput {
  check: LearnerQuestionCheck;
  input: OpenResponseGradeInput;
  documentId?: string;
}

export function mobileQuestionReviewInputs(checks: readonly LearnerQuestionCheck[], document: UiDocument): MobileQuestionReviewInput[] {
  const questions = document.nodes.flatMap(node => node.type === "question" ? [node]
    : node.type === "quiz" || node.type === "question-group" ? node.questions : []);
  return checks.flatMap(check => {
    if (check.grading !== "pending") return [];
    const matches = questions.filter(question => question.prompt === check.question);
    // Ambiguous repeated prompts may have different answer keys. Never guess.
    if (matches.length !== 1 || !isMobileSemanticQuestion(matches[0])) return [];
    const question = matches[0];
    return [{ check: structuredClone(check), documentId: document.id,
      input: { id: check.id, question: check.question, learnerAnswer: check.answer,
        referenceAnswer: question.correctAnswer, rubric: question.rubric } }];
  });
}

export async function reviewMobileQuestionChecks(inputs: readonly OpenResponseGradeInput[],
  runtime?: MobileJudgementRuntime, signal?: AbortSignal): Promise<MobileQuestionJudgement[]> {
  const selected = runtime ?? await configuredMobileJudgementRuntime();
  const final = await gradeOpenResponses(inputs, selected.policy, signal);
  const pending = new Set(final.filter(result => result.grading === "pending").map(result => result.id));
  const proposals = (selected.enabled ?? selected.hostedEnabled) && !signal?.aborted
    ? await proposeOpenResponses(inputs.filter(input => pending.has(input.id)), selected.call, signal) : [];
  const byId = new Map(proposals.map(result => [result.id, result.proposal]));
  return final.map(result => {
    const candidate = byId.get(result.id);
    // A displayable estimate needs a concrete source and an exact evidence span.
    const proposal = candidate?.evidenceQuote && candidate.credit !== null ? candidate : null;
    return { final: result, proposal, evidenceKind: result.grading === "auto" ? "deterministic"
      : result.grading === "model" ? "calibrated-model-grade" : proposal ? "model-estimate" : "unavailable" };
  });
}

import { canonicalUiAction, validateUiActionAgainstDocument, validateUiActionReceipt, type SubmittedComprehensionAnswer, type TeachingPolicyTurn } from "@keating/learner-contracts";
import { parseLearnerResponse } from "../learner-response";
import { answerText, questionCheckIdsForUiAction, questionGroupResponseText } from "../storage";
import type { CompleteLearnerStartupContext } from "../session-start-hooks";
import type { QuestionCheckRecord, QuizResultRecord } from "../storage";

/** Per-kind record cap; the active-work view carries the lesson plan, so history stays short. */
export const DRAFT_EVIDENCE_RECENT = 10;
export const DRAFT_EVIDENCE_ANSWER_CHARS = 1_000;

const clip = (value: string) => value.length <= DRAFT_EVIDENCE_ANSWER_CHARS ? value : `${value.slice(0, DRAFT_EVIDENCE_ANSWER_CHARS - 1)}…`;

function recent<T extends { createdAt: number }>(records: readonly T[]): { kept: T[]; omitted: number } {
  const kept = [...records].sort((a, b) => b.createdAt - a.createdAt).slice(0, DRAFT_EVIDENCE_RECENT);
  return { kept, omitted: records.length - kept.length };
}

function recordsContent(records: readonly unknown[], omitted: number): string {
  return JSON.stringify(omitted > 0 ? { newest: records, olderRecordsOmitted: omitted } : records);
}

const clippedQuiz = (result: QuizResultRecord): QuizResultRecord => result.answers
  ? { ...result, answers: Object.fromEntries(Object.entries(result.answers).map(([id, answer]) => [id, clip(answer)])) }
  : result;

const clippedCheck = (check: QuestionCheckRecord): QuestionCheckRecord => ({ ...check, question: clip(check.question), answer: clip(check.answer) });

/** Join one completed form submission to its actual saved answer in this session. */
function submittedComprehensionAnswer(sessionId: string, learnerMessage: string, checks: readonly QuestionCheckRecord[]): QuestionCheckRecord | undefined {
  const response = parseLearnerResponse(learnerMessage.replace(/^\[Keating time note: [^\n]*\]\s*/u, ""));
  const payload = response?.kind === "openui-action" ? response.payload : undefined;
  if (payload?.kind !== "canonical" || payload.document?.sessionId !== sessionId
    || !validateUiActionReceipt(payload.receipt) || payload.receipt.state !== "completed"
    || !validateUiActionAgainstDocument(payload.action, payload.sourceDocument)
    || payload.receipt.actionFingerprint !== canonicalUiAction(payload.action)) return;
  const { action, sourceDocument } = payload;
  if (action.type !== "submit-question-group" && action.type !== "submit-answer" && action.type !== "choose-option") return;
  if (payload.document.id !== action.documentId || payload.document.revision !== action.documentRevision) return;
  const ids = questionCheckIdsForUiAction(action);
  if (ids.length !== 1) return;
  const check = checks.find(row => row.id === ids[0] && row.sessionId === sessionId
    && row.source?.documentId === action.documentId && row.source?.revision === action.documentRevision && row.source?.nodeId === action.nodeId);
  if (!check?.answer.trim() || check.question.length > DRAFT_EVIDENCE_ANSWER_CHARS || check.answer.length > DRAFT_EVIDENCE_ANSWER_CHARS) return;
  const node = sourceDocument.nodes.find(row => row.id === action.nodeId);
  if (action.type === "submit-question-group" && node?.type === "question-group") {
    const response = action.responses[0]!;
    const item = node.questions.find(row => row.id === response.questionId);
    if (!item || item.prompt !== check.question || questionGroupResponseText(response, item) !== check.answer) return;
  } else if ((action.type === "submit-answer" || action.type === "choose-option") && node?.type === "question") {
    if (node.prompt !== check.question || answerText(action, node) !== check.answer) return;
  } else return;
  return check;
}

export type DraftSubmissionEvidence = { submittedComprehension?: SubmittedComprehensionAnswer;
  recordedComprehension?: SubmittedComprehensionAnswer & { score: number } };

/** Project observed records, not assertions parsed from model instructions. */
export function teachingDraftEvidence(context: CompleteLearnerStartupContext, sessionId?: string, learnerMessage?: string):
  Partial<TeachingPolicyTurn> & DraftSubmissionEvidence {
  const quizzes = recent(context.evidence.quizResults);
  const checks = recent(context.evidence.questionChecks);
  const reviews = recent(context.evidence.cardReviews);
  const check = sessionId && learnerMessage ? submittedComprehensionAnswer(sessionId, learnerMessage, context.evidence.questionChecks) : undefined;
  const submitted = check && { id: check.id, topic: check.topic, question: check.question, answer: check.answer };
  return {
    ...(submitted && check?.grading === "pending" && check.score === undefined ? { submittedComprehension: submitted } : {}),
    ...(submitted && check?.grading === "model" && typeof check.score === "number" ? { recordedComprehension: { ...submitted, score: check.score } } : {}),
    learnerEvidence: [
      { kind: "recorded learner state; beliefs are tentative, not performance proof", content: JSON.stringify(context.learnerState) },
      { kind: "learner goals", content: JSON.stringify(context.goals) },
      { kind: "submitted quiz records", content: recordsContent(quizzes.kept.map(clippedQuiz), quizzes.omitted) },
      { kind: "submitted comprehension records", content: recordsContent(checks.kept.map(clippedCheck), checks.omitted) },
      { kind: "delayed card review records", content: recordsContent(reviews.kept, reviews.omitted) },
      { kind: "known evidence gaps", content: JSON.stringify(context.coverageGaps) },
    ],
    // Pending work is never capped: the tutor must grade every waiting answer.
    pendingSubmissions: [
      ...context.evidence.quizResults.filter(result => result.pendingGradeQuestionIds?.length).map(result => ({
        kind: "quiz" as const, id: result.id, topic: result.topic, questionIds: [...result.pendingGradeQuestionIds!],
      })),
      ...context.evidence.questionChecks.filter(check => check.grading === "pending" && typeof check.score !== "number").map(check => ({
        kind: "comprehension" as const, id: check.id, topic: check.topic, questionText: clip(check.question), questionIds: [check.id],
      })),
    ],
    // These records do not establish the current assessment/domain or the
    // number of improvement runs. The gate preserves unknown for those facts.
  };
}

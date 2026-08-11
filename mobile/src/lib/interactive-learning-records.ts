/**
 * Projections from ephemeral interactive cards into the portable learner
 * contract.  The source cards are model-authored, so their ids are deliberately
 * never used as portable ids (or reflected in them): records are identified by
 * their containing assistant message/card key plus structural positions.
 */
import {
  isContractId,
  isContractTimestamp,
  validateLearnerGoal,
  validateLearnerQuestionCheck,
  validateLearnerQuizResult,
  type LearnerGoal as PortableLearnerGoal,
  type LearnerQuestionCheck,
  type LearnerQuizResult,
} from "@keating/learner-contracts";
import type { LearnerGoal as InteractiveGoal, QuestionForm, Quiz } from "./interactive-tags";
import { isOpenEnded, questionCredit, scoreQuiz } from "./quiz-grading";

/** Fields deliberately absent from the v2 portable goal schema. */
export const PORTABLE_GOAL_PROJECTION_OMISSIONS = ["step.kind", "step.order", "step.description"] as const;

/** The result keeps an explicit skipped count while omitting blank answers. */
export interface PortableQuestionChecksResult {
  checks: LearnerQuestionCheck[];
  skipped: number;
}

/*
 * Two independent FNV-1a passes provide a compact, opaque 64-bit-ish identity
 * without adding a crypto dependency to the React Native runtime.  The input
 * is never placed in the id, which prevents a model-provided id from leaking
 * into exports or logs.  Structural index/type make IDs easy to reason about
 * and the digest distinguishes otherwise similar cards across retries.
 */
function fnv1a32(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * A stable contract id for an interactive-card record.  `sourceKey` should be
 * the message/card key (for example `cardKey(message.id, cardIndex)`).
 */
export function interactiveRecordId(kind: string, sourceKey: string, index: number): string {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(kind)) throw new Error("Interactive record kind is invalid.");
  if (!Number.isSafeInteger(index) || index < 0) throw new Error("Interactive record index must be a non-negative integer.");
  const identity = `${kind}\u0000${sourceKey}\u0000${index}`;
  const first = fnv1a32(identity, 0x811c9dc5);
  const second = fnv1a32(`${identity.length}\u0000${identity.split("").reverse().join("")}`, 0x9e3779b9);
  // Prefixes and hex are contract-id safe; sourceKey never appears verbatim.
  return `interactive-${kind}-${index}-${first}${second}`;
}

function requireTimestamp(nowIso: string): void {
  if (!isContractTimestamp(nowIso)) throw new Error("Interactive record time must be an ISO timestamp.");
}

function requireOptionalSession(sessionId: string | undefined): void {
  if (sessionId !== undefined && !isContractId(sessionId)) throw new Error("Interactive record session id is invalid.");
}

function requireValid<T>(value: T, valid: (candidate: unknown) => boolean, kind: string): T {
  if (!valid(value)) throw new Error(`Interactive ${kind} cannot be stored in the learner contract.`);
  return value;
}

/**
 * Converts the semantic portion of a rendered goal into v2 portable storage.
 * Presentation-only step kind, order, and description have no v2 counterpart;
 * see `PORTABLE_GOAL_PROJECTION_OMISSIONS`.
 */
export function portableGoalFromInteractive(
  goal: InteractiveGoal,
  sourceKey: string,
  nowIso: string,
): PortableLearnerGoal {
  requireTimestamp(nowIso);
  const record: PortableLearnerGoal = {
    id: interactiveRecordId("goal", sourceKey, 0),
    title: goal.title,
    description: goal.description,
    updatedAt: nowIso,
    steps: goal.steps.map((step, index) => ({
      id: interactiveRecordId("goal-step", sourceKey, index),
      title: step.title,
      status: step.status,
      successCriteria: [...step.successCriteria],
    })),
  };
  return requireValid(record, validateLearnerGoal, "goal");
}

/**
 * Persists local objective grading as a weighted estimate.  Open-ended answer
 * credits are retained for progress UX but remain explicitly pending teacher
 * grading, never promoted to an automatic verdict.
 */
export function portableQuizResultFromInteractive(
  quiz: Quiz,
  answers: Record<string, string>,
  sourceKey: string,
  nowIso: string,
  sessionId?: string,
): LearnerQuizResult {
  requireTimestamp(nowIso);
  requireOptionalSession(sessionId);
  const score = scoreQuiz(quiz.questions, answers);
  const canonicalIds = quiz.questions.map((_, index) => interactiveRecordId("quiz-question", sourceKey, index));
  const record: LearnerQuizResult = {
    id: interactiveRecordId("quiz", sourceKey, 0),
    topic: quiz.topic,
    createdAt: nowIso,
    score: score.weighted,
    totalQuestions: quiz.questions.length,
    answers: Object.fromEntries(quiz.questions.map((question, index) => [canonicalIds[index], answers[question.id] ?? ""])),
    partialCredits: Object.fromEntries(quiz.questions.map((question, index) => [canonicalIds[index], questionCredit(question, answers[question.id] ?? "")])),
    pendingGradeQuestionIds: quiz.questions
      .flatMap((question, index) => isOpenEnded(question) ? [canonicalIds[index]] : []),
    ...(sessionId === undefined ? {} : { sessionId }),
  };
  return requireValid(record, validateLearnerQuizResult, "quiz result");
}

/**
 * Stores every non-blank form answer as pending teacher evidence.  Answers,
 * questions, and an authored topic are preserved byte-for-byte; omitted form
 * topics use the explicit stable fallback "this lesson".
 */
export function portableQuestionChecksFromInteractive(
  form: QuestionForm,
  answers: string[],
  sourceKey: string,
  nowIso: string,
  sessionId?: string,
): PortableQuestionChecksResult {
  requireTimestamp(nowIso);
  requireOptionalSession(sessionId);
  const topic = form.topic ?? "this lesson";
  const checks: LearnerQuestionCheck[] = [];
  let skipped = 0;

  form.questions.forEach((field, index) => {
    const answer = answers[index] ?? "";
    if (!answer.trim()) {
      skipped += 1;
      return;
    }
    checks.push(requireValid({
      id: interactiveRecordId("question-check", sourceKey, index),
      topic,
      question: field.question,
      answer,
      createdAt: nowIso,
      grading: "pending",
      ...(sessionId === undefined ? {} : { sessionId }),
    } satisfies LearnerQuestionCheck, validateLearnerQuestionCheck, "question check"));
  });
  return { checks, skipped };
}

import type { TeachingPolicyTurn } from "@keating/learner-contracts";
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

/** Project observed records, not assertions parsed from model instructions. */
export function teachingDraftEvidence(context: CompleteLearnerStartupContext): Partial<TeachingPolicyTurn> {
  const quizzes = recent(context.evidence.quizResults);
  const checks = recent(context.evidence.questionChecks);
  const reviews = recent(context.evidence.cardReviews);
  return {
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

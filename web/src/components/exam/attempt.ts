import type {
  UiDocumentNode,
  UiQuestionGroupResponse,
  UiQuizTiming,
} from "@keating/learner-contracts";
import type { SharedUiActionIntent } from "../../keating/openui/shared-actions";
import { objectiveCredit } from "../../keating/openui/quiz-progress";

export type ExamNode = Extract<UiDocumentNode, { type: "quiz" }>;
export type ExamCompletion = Extract<
  SharedUiActionIntent,
  { type: "complete-quiz" }
>;
export const DEFAULT_EXAM_SECONDS = 30 * 60;

/** Wall-clock deadlines survive tab suspension and reload without interval drift. */
export interface ExamClock {
  startedAt: number;
  deadlineAt: number;
  enteredAt: number;
  activeQuestionId?: string;
  perQuestionMs: Record<string, number>;
}

export function startExamClock(
  now: number,
  seconds: number,
  questionId?: string,
): ExamClock {
  return {
    startedAt: now,
    deadlineAt: now + seconds * 1000,
    enteredAt: now,
    activeQuestionId: questionId,
    perQuestionMs: {},
  };
}

export function moveExamClock(
  clock: ExamClock,
  questionId: string | undefined,
  now: number,
): ExamClock {
  const at = Math.max(clock.enteredAt, Math.min(now, clock.deadlineAt));
  const perQuestionMs = { ...clock.perQuestionMs };
  if (clock.activeQuestionId)
    perQuestionMs[clock.activeQuestionId] =
      (perQuestionMs[clock.activeQuestionId] ?? 0) + at - clock.enteredAt;
  return {
    ...clock,
    enteredAt: at,
    activeQuestionId: questionId,
    perQuestionMs,
  };
}

/** Reviewing counts toward exam duration without charging it to a question. */
export function examTiming(clock: ExamClock, now: number): UiQuizTiming {
  const settled = moveExamClock(clock, undefined, now);
  return {
    totalMs: Math.max(0, Math.min(now, clock.deadlineAt) - clock.startedAt),
    perQuestionMs: settled.perQuestionMs,
  };
}

export function examResponseHasAnswer(
  response: UiQuestionGroupResponse | undefined,
): boolean {
  if (!response) return false;
  if (response.type === "text") return Boolean(response.answer.trim());
  if (response.type === "choice")
    return Boolean(response.optionIds.length || response.text?.trim());
  if (response.type === "blanks")
    return response.answers.some((answer) => answer.trim());
  if (response.type === "order") return response.items.length > 0;
  return response.rows.some((row) => row.optionId || row.reason?.trim());
}

export function buildExamCompletion({
  node,
  answers,
  flagged,
  timing,
  timedOut,
  ready,
}: {
  node: ExamNode;
  answers: Record<string, string>;
  flagged: string[];
  timing: UiQuizTiming;
  timedOut: boolean;
  ready: Record<string, boolean>;
}): ExamCompletion {
  const submitted = node.questions.flatMap((question) =>
    answers[question.id] !== undefined
      ? [{ questionId: question.id, answer: answers[question.id]! }]
      : [],
  );
  const credits = Object.fromEntries(
    node.questions.flatMap((question) => {
      const credit =
        answers[question.id] === undefined
          ? 0
          : objectiveCredit(question, answers[question.id]!);
      return credit === undefined ? [] : [[question.id, credit]];
    }),
  );
  return {
    type: "complete-quiz",
    nodeId: node.id,
    resultId: `${node.id}-result`,
    answers: submitted,
    score: Object.values(credits).filter((credit) => credit === 1).length,
    partialCreditPoints: Object.values(credits).reduce(
      (sum, credit) => sum + credit,
      0,
    ),
    partialCredits: credits,
    timing: {
      totalMs: timing.totalMs,
      perQuestionMs: { ...timing.perQuestionMs },
    },
    flaggedQuestionIds: node.questions
      .filter((question) => flagged.includes(question.id))
      .map((question) => question.id),
    pendingGradeQuestionIds: node.questions
      .filter(
        (question) =>
          answers[question.id] !== undefined &&
          objectiveCredit(question, answers[question.id]!) === undefined,
      )
      .map((question) => question.id),
    skippedQuestionIds: node.questions
      .filter((question) => answers[question.id] === undefined)
      .map((question) => question.id),
    timedOutQuestionIds: timedOut
      ? node.questions
          .filter((question) => !ready[question.id])
          .map((question) => question.id)
      : [],
    examTimedOut: timedOut,
  };
}

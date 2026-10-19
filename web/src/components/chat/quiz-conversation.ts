/**
 * Learner turns produced by quiz and legacy question interactions. Pure text
 * builders, plus window-event handlers that hand those turns to the thread's
 * send path. Kept free of React so the wording and routing can be tested.
 */
import {
  createQuestionLearnerResponse,
  serializeLearnerResponse,
} from "../../keating/learner-response";
import type { Quiz } from "../../keating/core";
import type { AnsweredQuestion } from "../QuestionRenderer";
import { isOpenEnded, type QuizResult } from "../QuizRenderer";
import { formatQuizDuration, isQuickQuizAnswer } from "../quiz/game";
import { quizSubmissionId, type SubmissionIdentity } from "./learner-delivery";

export interface QuizSubmissionDetail {
  resultId?: string;
  quizId?: string;
  topic?: string;
  total?: number;
  score?: number;
  partialCreditPoints?: number;
  partialCredits?: Record<string, number>;
  flagged?: string[];
  timedOutQuestionIds?: string[];
  examTimedOut?: boolean;
  timing?: { totalMs: number; perQuestionMs: Record<string, number> };
  questions?: Array<{
    id: string;
    question: string;
    correctAnswer: string;
    type?: string;
    timeLimit?: number;
    openEnded?: boolean;
  }>;
  answers?: Record<string, string>;
}

/** The `keating:quiz-submitted` event detail for a finished quiz run. */
export function quizSubmittedDetail(quiz: Quiz, result: QuizResult): QuizSubmissionDetail {
  return {
    resultId: result.resultId,
    quizId: quiz.slug,
    topic: quiz.topic,
    total: quiz.questions.length,
    questions: quiz.questions.map((q) => ({
      id: q.id,
      question: q.question,
      correctAnswer: q.correctAnswer,
      type: q.type,
      timeLimit: q.timeLimit,
      openEnded: isOpenEnded(q),
    })),
    answers: result.answers,
    score: result.score,
    partialCreditPoints: result.partialCreditPoints,
    partialCredits: result.partialCredits,
    flagged: result.flagged,
    timing: result.timing,
    timedOutQuestionIds: result.timedOutQuestionIds,
    examTimedOut: result.examTimedOut,
  };
}

// Open-ended answers (short answer / transfer / free-text fill-in) have no
// single correct string, so they're not auto-scored — the model judges them
// by meaning via grade_quiz. detail.score counts objective questions only.
function isOpenEndedQuestion(question: { type?: string; openEnded?: boolean }): boolean {
  return (
    question.openEnded ??
    (question.type === "short_answer" ||
      question.type === "transfer" ||
      question.type === "fill_in")
  );
}

/**
 * The learner's report of a finished quiz: score, timing, partial credit and
 * flags, followed by the `<keating-quiz-result>` tag the result card renders.
 * Returns null for a detail without a numeric score.
 */
export function quizSubmissionText(
  detail: QuizSubmissionDetail | undefined,
  now: () => number = Date.now,
): string | null {
  if (!detail || typeof detail.score !== "number") return null;
  const total = detail.total ?? 0;
  const resultId =
    detail.resultId ?? `${detail.quizId ?? "quiz"}-${now()}`;
  const openEndedTotal = (detail.questions ?? []).filter(isOpenEndedQuestion).length;
  const objectiveTotal = total - openEndedTotal;
  const duration = detail.timing
    ? formatQuizDuration(detail.timing.totalMs)
    : null;
  const lines: string[] = [
    `I finished the quiz${detail.topic ? ` on "${detail.topic}"` : ""}.`,
    `Objective score: ${detail.score}/${objectiveTotal}${openEndedTotal > 0 ? ` (${openEndedTotal} open-ended pending your review)` : ""}${duration !== null ? ` in ${duration}` : ""}.`,
  ];
  if (detail.examTimedOut) lines.push("The exam time budget expired.");
  const timedOutIds = new Set(detail.timedOutQuestionIds ?? []);
  if (typeof detail.partialCreditPoints === "number") {
    lines.push(
      `Partial-credit points: ${detail.partialCreditPoints.toFixed(2)}/${objectiveTotal}.`,
    );
  }
  if (detail.questions && detail.answers && detail.timing) {
    const perQ = detail.timing.perQuestionMs;
    let hasOpenEnded = false;
    for (const q of detail.questions) {
      const mine = (detail.answers[q.id] ?? "").trim();
      const parts: string[] = [];
      if (isOpenEndedQuestion(q)) {
        hasOpenEnded = true;
        parts.push(
          `- [open-ended id=${q.id}] ${q.question} → my answer: "${mine || "(blank)"}" (reference: "${q.correctAnswer}")`,
        );
      } else {
        const correct =
          mine.toLowerCase() === q.correctAnswer.trim().toLowerCase();
        const pc = detail.partialCredits?.[q.id];
        parts.push(
          `- ${q.question} → my answer: "${mine || "(blank)"}" ${correct ? "✓" : "✗"}`,
        );
        if (typeof pc === "number" && !correct) {
          parts.push(`(partial credit: ${Math.round(pc * 100)}%)`);
        }
      }
      if (typeof perQ[q.id] === "number") parts.push(`(${formatQuizDuration(perQ[q.id])})`);
      if (timedOutIds.has(q.id)) parts.push("[timed out]");
      else if (isQuickQuizAnswer({ timeMs: perQ[q.id], timeLimitSeconds: q.timeLimit, answered: Boolean(mine) })) parts.push("[quick answer: within 25% of question time budget; timing only]");
      lines.push(parts.join(" "));
    }
    if (hasOpenEnded) {
      lines.push(
        `Grade the open-ended answers (marked [open-ended id=…]) by calling the grade_quiz tool with result_id "${resultId}" and a verdict (correct/partial/incorrect) per question id. Judge by meaning, not exact wording — the reference is one acceptable answer, not the only one. Your verdicts update the result card. Briefly explain anything I got wrong.`,
      );
    }
  }
  if (detail.flagged && detail.flagged.length > 0) {
    lines.push(
      `Bookmarked ${detail.flagged.length} question${detail.flagged.length > 1 ? "s" : ""} for review.`,
    );
  }
  lines.push(
    "Please review my answers and timing, then guide what to work on next.",
  );
  const resultPayload = {
    id: resultId,
    timestamp: now(),
    quiz: {
      slug: detail.quizId ?? "",
      topic: detail.topic ?? "",
      questions: detail.questions ?? [],
    },
    result: {
      answers: detail.answers ?? {},
      score: detail.score ?? 0,
      partialCreditPoints: detail.partialCreditPoints ?? 0,
      timing: detail.timing,
      partialCredits: detail.partialCredits ?? {},
      flagged: detail.flagged ?? [],
      timedOutQuestionIds: detail.timedOutQuestionIds ?? [],
      examTimedOut: detail.examTimedOut,
    },
  };
  const tag = `<keating-quiz-result json=${JSON.stringify(JSON.stringify(resultPayload))} />`;
  return lines.join("\n") + "\n\n" + tag;
}

export function legacyQuestionResponseText(
  detail: { answers?: AnsweredQuestion[]; topic?: string } | undefined,
  identity?: SubmissionIdentity,
): string | null {
  const answers = detail?.answers;
  if (!answers || answers.length === 0) return null;
  const response = createQuestionLearnerResponse({
    answers,
    topic: detail?.topic,
    source: "legacy",
  }, identity ? { id: identity.sessionMessageId, submittedAt: identity.submittedAt } : undefined);
  return serializeLearnerResponse(response);
}

export function quizRemediationText(
  detail: { level?: string; topic?: string; slug?: string } | undefined,
): string | null {
  if (!detail?.level) return null;
  return `I need help with "${detail.level}" level questions on "${detail.topic || detail.slug || "this topic"}". Please generate targeted review material for this area.`;
}

export function quizReframeText(
  detail: { questionId?: string; mode?: string; topic?: string } | undefined,
): string | null {
  if (!detail?.mode || !detail?.questionId) return null;
  return `Please reframe question "${detail.questionId}" in "${detail.mode}" mode for "${detail.topic || "this topic"}".`;
}

type Capture = (event: string, properties: Record<string, unknown>) => void;

/** Window-event handlers; each reads the event detail and routes one learner turn. */
export interface QuizConversationHandlers {
  questionAnswered: (event: Event) => void;
  quizSubmitted: (event: Event) => void;
  remediationRequested: (event: Event) => void;
  reframeRequested: (event: Event) => void;
}

/**
 * Submits a learner turn for the active session. It is retained and queued
 * until that session can receive it; a repeated `submissionId` is ignored.
 */
export type SubmitTurn = (
  serialized: string | ((identity: SubmissionIdentity) => string),
  submissionId?: string,
) => void;

export function createQuizConversationHandlers({
  hasAgent,
  submit,
  capture,
  now = Date.now,
}: {
  hasAgent: () => boolean;
  submit: SubmitTurn;
  capture: Capture;
  now?: () => number;
}): QuizConversationHandlers {
  const detailOf = <T,>(event: Event) => (event as CustomEvent).detail as T | undefined;
  return {
    // Learner submissions made mid-reply must still reach the teacher, so
    // question answers and quiz results queue rather than being refused.
    questionAnswered: (event) => {
      if (!hasAgent()) return;
      const detail = detailOf<{ answers?: AnsweredQuestion[]; topic?: string }>(event);
      if (legacyQuestionResponseText(detail) === null) return;
      submit((identity) => legacyQuestionResponseText(detail, identity)!);
    },
    // A quiz run's result id is its submission id: submitting the same run
    // twice delivers it once.
    quizSubmitted: (event) => {
      if (!hasAgent()) return;
      const raw = detailOf<QuizSubmissionDetail>(event);
      if (!raw || typeof raw.score !== "number") return;
      const detail = { ...raw, resultId: raw.resultId ?? `${raw.quizId ?? "quiz"}-${now()}` };
      const text = quizSubmissionText(detail, now);
      if (text !== null) submit(text, quizSubmissionId(detail.resultId));
    },
    remediationRequested: (event) => {
      const detail = detailOf<{ level?: string; topic?: string; slug?: string }>(event);
      const text = quizRemediationText(detail);
      if (text === null) return;
      capture("quiz_remediation_requested", { level: detail!.level });
      submit(text);
    },
    reframeRequested: (event) => {
      const detail = detailOf<{ questionId?: string; mode?: string; topic?: string }>(event);
      const text = quizReframeText(detail);
      if (text === null) return;
      capture("quiz_reframe_requested", { mode: detail!.mode });
      submit(text);
    },
  };
}

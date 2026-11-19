import { LessonFrame, LessonScore } from "./lesson/LessonFrame";
import { useContext, useState } from "react";
import { KeatingGlyph } from "../design-system/glyphs";
import type { Quiz, QuizGradeVerdict, QuizQuestion } from "../keating/core";
import type { QuizResult } from "./QuizRenderer";
import { isOpenEnded, questionCredit } from "./QuizRenderer";
import { formatQuizDuration, isQuickQuizAnswer } from "./quiz/game";
import { QuizGradesContext } from "./quiz-grades-context";
import { css, cx } from "../../styled-system/css";

export interface StoredQuizResult {
  id: string;
  timestamp: number;
  quiz: Quiz;
  result: QuizResult;
}

interface QuizResultCardProps {
  data: StoredQuizResult;
  onReview?: (data: StoredQuizResult) => void;
}

type QuestionStatus =
  | { kind: "objective"; correct: boolean }
  | { kind: "open-graded"; verdict: QuizGradeVerdict; note?: string }
  | { kind: "open-pending"; hint: "close" | "some" | "review" };

const shared = { mutedText: "lesson-muted" };
const iconTone = {correct:"lesson-ok",wrong:"lesson-bad",partial:"lesson-partly",pending:"lesson-muted"};

function objectiveCorrect(q: QuizQuestion, answer: string): boolean {
  if (q.type === "multi_select" && q.correctAnswers) {
    const selected = new Set(answer.split(",").map((s) => s.trim()).filter(Boolean));
    return q.correctAnswers.every((c) => selected.has(c)) && selected.size === q.correctAnswers.length;
  }
  if (q.type === "fill_in" && q.blanks && q.blanks.length > 0) {
    const userAnswers = answer.split("|").map((s) => s.trim());
    const correctAnswers = q.correctAnswers ?? [q.correctAnswer];
    return userAnswers.every((a, i) => a.toLowerCase() === correctAnswers[i]?.trim().toLowerCase());
  }
  return answer.toLowerCase() === q.correctAnswer.toLowerCase();
}

function questionStatus(
  q: QuizQuestion,
  answer: string,
  grades: { questionId: string; verdict: QuizGradeVerdict; note?: string }[],
): QuestionStatus {
  if (isOpenEnded(q)) {
    const grade = grades.find((g) => g.questionId === q.id);
    if (grade) return { kind: "open-graded", verdict: grade.verdict, note: grade.note };
    const credit = questionCredit(q, answer);
    const hint = credit >= 0.6 ? "close" : credit > 0 ? "some" : "review";
    return { kind: "open-pending", hint };
  }
  return { kind: "objective", correct: objectiveCorrect(q, answer) };
}

/**
 * A reviewable quiz result card rendered in the conversation thread.
 * Shows score, per-question breakdown, expandable details.
 * Designed to look distinct from regular user/assistant messages.
 */
export function QuizResultCard({ data, onReview }: QuizResultCardProps) {
  const { quiz, result } = data;
  const [expandedQuestions, setExpandedQuestions] = useState<Set<string>>(new Set());
  const [showDetails, setShowDetails] = useState(false);

  // Open-ended answers are judged by the teacher (model) via grade_quiz, not by
  // string match. Until that verdict arrives they're "pending review" and don't
  // count toward the score; objective questions are auto-graded as before.
  const modelGrades = useContext(QuizGradesContext).grades[data.id] ?? [];
  const statuses = quiz.questions.map((q) => ({
    q,
    status: questionStatus(q, (result.answers[q.id] ?? "").trim(), modelGrades),
  }));

  const total = quiz.questions.length;
  const pendingCount = statuses.filter((s) => s.status.kind === "open-pending").length;
  const decided = total - pendingCount;
  let earned = 0;
  let correctWhole = 0;
  for (const { status } of statuses) {
    if (status.kind === "objective" && status.correct) {
      earned += 1;
      correctWhole += 1;
    } else if (status.kind === "open-graded") {
      if (status.verdict === "correct") {
        earned += 1;
        correctWhole += 1;
      } else if (status.verdict === "partial") {
        earned += 0.5;
      }
    }
  }

  const allPending = decided === 0;
  const percentage = decided > 0 ? Math.round((earned / decided) * 100) : 0;
  const partly = statuses.filter(({status}) => status.kind === "open-graded" && status.verdict === "partial").length;
  const toggleQuestion = (qid: string) => {
    setExpandedQuestions((prev) => {
      const next = new Set(prev);
      if (next.has(qid)) next.delete(qid);
      else next.add(qid);
      return next;
    });
  };

  const totalTime = result.timing ? formatQuizDuration(result.timing.totalMs) : null;
  const timedOutIds = new Set(result.timedOutQuestionIds ?? []);

  return (
    <LessonFrame glyph="quiz" title={quiz.topic} kind="Quiz result" tools={new Date(data.timestamp).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})} footer={<>
        <button type="button" onClick={()=>setShowDetails(v=>!v)} aria-expanded={showDetails}>All answers <KeatingGlyph name={showDetails ? "chevu" : "chev"} size={13}/></button>
        {onReview && <button type="button" className="lesson-primary k-lift" onClick={()=>onReview(data)}>Review topic</button>}
      </>}>
      <LessonScore score={allPending ? "Pending review" : `${earned} of ${decided}`} percent={allPending ? undefined : percentage} time={totalTime ?? undefined} correct={correctWhole} partly={partly} missed={decided-correctWhole-partly}/>
      <div>
        {pendingCount > 0 && (
          <span className={css({ display: "flex", alignItems: "center", gap: "0.25rem" })}>
            <KeatingGlyph name="help" size={12} className={iconTone.pending} />
            {pendingCount} pending review
          </span>
        )}
        {result.flagged && result.flagged.length > 0 && (
          <span className={css({ display: "flex", alignItems: "center", gap: "0.25rem" })}>
            <KeatingGlyph name="flag" size={12} className={iconTone.partial} />
            {result.flagged.length} flagged
          </span>
        )}
        {timedOutIds.size > 0 && <span>{timedOutIds.size} timed out</span>}
        {result.examTimedOut && <span>Exam time expired</span>}
      </div>

      <div className="lesson-results">
          {statuses.map(({ q, status }, idx) => {
            const answer = (result.answers[q.id] ?? "").trim();
            const timeMs = result.timing?.perQuestionMs[q.id];
            const timedOut = timedOutIds.has(q.id);
            const quick = isQuickQuizAnswer({ timeMs, timeLimitSeconds: q.timeLimit, answered: Boolean(answer), timedOut });
            const isExpanded = expandedQuestions.has(q.id);
            const pending = status.kind === "open-pending";
            const fullyCorrect =
              (status.kind === "objective" && status.correct) ||
              (status.kind === "open-graded" && status.verdict === "correct");
            const partial = status.kind === "open-graded" && status.verdict === "partial";
            if (!showDetails && (pending || fullyCorrect)) return null;

            const glyph = pending
              ? "help"
              : fullyCorrect
                ? "check"
                : partial
                  ? "minus"
                  : "x";
            const iconClass = pending
              ? iconTone.pending
              : fullyCorrect
                ? iconTone.correct
                : partial
                  ? iconTone.partial
                  : iconTone.wrong;

            const hintLabel =
              status.kind === "open-pending"
                ? status.hint === "close"
                  ? "looks close"
                  : status.hint === "some"
                    ? "some overlap"
                    : "needs review"
                : "";

            return (
              <div key={q.id} className="lesson-result-row">
                <button
                  type="button"
                  onClick={() => toggleQuestion(q.id)}
                  aria-expanded={isExpanded}
                  className={css({ display: "flex", minHeight: "2.75rem", width: "100%", flexWrap: "wrap", alignItems: "flex-start", gap: "0.5rem", textAlign: "left" })}
                >
                  <KeatingGlyph name={glyph} size={12} className={cx(css({ marginTop: "0.125rem", flexShrink: 0 }), iconClass)} />
                  <span className={css({ minWidth: 0, flex: "1 1 12rem", overflowWrap: "anywhere", lineHeight: 1.625 })}>
                    <span className={css({ marginRight: "0.25rem", color: "color-mix(in srgb, var(--foreground) 70%, transparent)" })}>{idx + 1}.</span>
                    {q.question}
                  </span>
                  {!pending && <span>{fullyCorrect ? "Correct" : partial ? "Partly" : "Not quite"}</span>}
                  {pending && (
                    <span className={css({ flexShrink: 0, borderRadius: "0.25rem", background: "var(--muted)", padding: "0.125rem 0.375rem", fontSize: "0.5625rem", textTransform: "uppercase", letterSpacing: "0.025em", color: "var(--muted-foreground)" })}>
                      Pending review
                    </span>
                  )}
                  {isExpanded ? <KeatingGlyph name="chevu" size={12} className={css({ flexShrink: 0, color: "color-mix(in srgb, var(--foreground) 60%, transparent)" })} /> : <KeatingGlyph name="chev" size={12} className={css({ flexShrink: 0, color: "color-mix(in srgb, var(--foreground) 60%, transparent)" })} />}
                </button>
                {(typeof timeMs === "number" || timedOut) && (
                  <div className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.625rem", marginTop: "0.25rem", paddingLeft: "1.25rem", fontSize: "0.75rem", fontVariantNumeric: "tabular-nums", color: "var(--muted-foreground)" })}>
                    {typeof timeMs === "number" && <span aria-label={`Time on question: ${timeMs} milliseconds`}>{formatQuizDuration(timeMs)}</span>}
                    {timedOut && <span>Timed out</span>}
                    {quick && <span title="Answered within the first quarter of the time budget. Timing does not indicate correctness.">Quick answer</span>}
                  </div>
                )}
                {isExpanded && (
                  <div className={css({ marginTop: "0.375rem", display: "grid", gap: "0.25rem", paddingLeft: "1.25rem" })}>
                    <p>
                      <span className={shared.mutedText}>You:</span>{" "}
                      <span className={fullyCorrect ? iconTone.correct : pending ? css({ color: "var(--foreground)" }) : partial ? iconTone.partial : iconTone.wrong}>
                        {answer || "(blank)"}
                      </span>
                    </p>
                    <p>
                      <span className={shared.mutedText}>
                        {isOpenEnded(q) ? "Reference answer:" : "Correct:"}
                      </span>{" "}
                      <span className={iconTone.correct}>{q.correctAnswer}</span>
                    </p>
                    {status.kind === "open-pending" && (
                      <p className={css({ fontSize: "0.625rem", fontStyle: "italic", color: "var(--muted-foreground)" })}>
                        Your teacher is judging this answer in chat. Heuristic hint: {hintLabel} (not a grade).
                      </p>
                    )}
                    {status.kind === "open-graded" && status.note && (
                      <p className={css({ display: "flex", alignItems: "flex-start", gap: "0.25rem", color: "color-mix(in srgb, var(--foreground) 80%, transparent)" })}>
                        <KeatingGlyph name="book" size={10} className={css({ marginTop: "0.125rem", flexShrink: 0 })} />
                        {status.note}
                      </p>
                    )}
                    {q.explanation && (
                      <p className={css({ display: "flex", alignItems: "flex-start", gap: "0.25rem", color: "color-mix(in srgb, var(--foreground) 80%, transparent)" })}>
                        <KeatingGlyph name="bulb" size={10} className={css({ marginTop: "0.125rem", flexShrink: 0 })} />
                        {q.explanation}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
    </LessonFrame>
  );
}

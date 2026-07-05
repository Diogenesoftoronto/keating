import { useContext, useState } from "react";
import {
  Bookmark,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  GraduationCap,
  HelpCircle,
  Lightbulb,
  MinusCircle,
  TrendingUp,
  XCircle,
} from "lucide-react";
import type { Quiz, QuizGradeVerdict, QuizQuestion } from "../keating/core";
import type { QuizResult } from "./QuizRenderer";
import { isOpenEnded, questionCredit } from "./QuizRenderer";
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

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

type QuestionStatus =
  | { kind: "objective"; correct: boolean }
  | { kind: "open-graded"; verdict: QuizGradeVerdict; note?: string }
  | { kind: "open-pending"; hint: "close" | "some" | "review" };

const sm = "@media (min-width: 640px)";
const dark = ".dark &";

const shared = {
  srCard: css({
    marginBlock: "0.75rem",
    borderRadius: "0.75rem",
    border: "1px solid var(--border)",
    background: "var(--background)",
    padding: "1rem",
    color: "var(--foreground)",
    boxShadow: "var(--shadow-card)",
  }),
  rowStart: css({ display: "flex", alignItems: "flex-start", gap: "0.75rem" }),
  iconBox: css({
    display: "flex",
    height: "2.25rem",
    width: "2.25rem",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "0.5rem",
  }),
  minFlex: css({ minWidth: 0, flex: 1 }),
  mutedText: css({ color: "color-mix(in srgb, var(--foreground) 70%, transparent)" }),
  detailsButton: css({
    marginTop: "0.5rem",
    display: "flex",
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.25rem",
    borderRadius: "0.375rem",
    paddingBlock: "0.375rem",
    fontSize: "0.75rem",
    color: "color-mix(in srgb, var(--foreground) 75%, transparent)",
    transition: "color 150ms, background-color 150ms",
    _hover: {
      background: "color-mix(in srgb, var(--muted) 50%, transparent)",
      color: "var(--foreground)",
    },
  }),
};

const toneClasses = {
  pending: {
    iconBg: css({ background: "var(--muted)" }),
    iconText: css({ color: "var(--muted-foreground)" }),
    scoreText: css({ color: "var(--muted-foreground)" }),
    bar: css({ background: "color-mix(in srgb, var(--muted-foreground) 40%, transparent)" }),
  },
  passed: {
    iconBg: css({ background: "#dcfce7", [dark]: { background: "rgba(16, 185, 129, 0.1)" } }),
    iconText: css({ color: "#047857", [dark]: { color: "#6ee7b7" } }),
    scoreText: css({ color: "#047857", [dark]: { color: "#6ee7b7" } }),
    bar: css({ background: "#059669", [dark]: { background: "#10b981" } }),
  },
  warning: {
    iconBg: css({ background: "#fef3c7", [dark]: { background: "rgba(245, 158, 11, 0.1)" } }),
    iconText: css({ color: "#92400e", [dark]: { color: "#fcd34d" } }),
    scoreText: css({ color: "#92400e", [dark]: { color: "#fcd34d" } }),
    bar: css({ background: "#d97706", [dark]: { background: "#f59e0b" } }),
  },
  failed: {
    iconBg: css({ background: "color-mix(in srgb, var(--destructive) 10%, transparent)" }),
    iconText: css({ color: "var(--destructive)" }),
    scoreText: css({ color: "var(--destructive)" }),
    bar: css({ background: "var(--destructive)" }),
  },
};

const questionContainer = {
  pending: css({
    borderColor: "var(--border)",
    background: "color-mix(in srgb, var(--muted) 30%, transparent)",
    color: "var(--foreground)",
  }),
  correct: css({
    borderColor: "rgba(5, 150, 105, 0.4)",
    background: "#ecfdf5",
    color: "var(--foreground)",
    [dark]: {
      borderColor: "rgba(16, 185, 129, 0.3)",
      background: "rgba(16, 185, 129, 0.1)",
    },
  }),
  partial: css({
    borderColor: "rgba(217, 119, 6, 0.4)",
    background: "#fffbeb",
    color: "var(--foreground)",
    [dark]: {
      borderColor: "rgba(245, 158, 11, 0.3)",
      background: "rgba(245, 158, 11, 0.1)",
    },
  }),
  wrong: css({
    borderColor: "color-mix(in srgb, var(--destructive) 30%, transparent)",
    background: "color-mix(in srgb, var(--destructive) 5%, transparent)",
    color: "var(--foreground)",
  }),
};

const iconTone = {
  pending: css({ color: "var(--muted-foreground)" }),
  correct: css({ color: "#047857", [dark]: { color: "#6ee7b7" } }),
  partial: css({ color: "#b45309", [dark]: { color: "#fcd34d" } }),
  wrong: css({ color: "var(--destructive)" }),
};

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
  const passed = !allPending && percentage >= 70;
  const warning = !allPending && percentage >= 50 && !passed;
  const tone = allPending
    ? toneClasses.pending
    : passed
      ? toneClasses.passed
      : warning
        ? toneClasses.warning
        : toneClasses.failed;

  const toggleQuestion = (qid: string) => {
    setExpandedQuestions((prev) => {
      const next = new Set(prev);
      if (next.has(qid)) next.delete(qid);
      else next.add(qid);
      return next;
    });
  };

  const totalTime = result.timing ? formatDuration(result.timing.totalMs) : null;

  return (
    <div className={shared.srCard}>
      {/* Header */}
      <div className={shared.rowStart}>
        <div className={cx(shared.iconBox, tone.iconBg)}>
          <GraduationCap size={18} className={tone.iconText} />
        </div>
        <div className={shared.minFlex}>
          <div className={css({ display: "flex", alignItems: "center", gap: "0.5rem" })}>
            <h3 className={css({ fontSize: "0.875rem", fontWeight: 600 })}>Quiz Result</h3>
            <span className={css({ fontSize: "0.625rem", color: "color-mix(in srgb, var(--foreground) 70%, transparent)" })}>
              {new Date(data.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </span>
          </div>
          <p className={css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.875rem", color: "var(--foreground)" })}>
            {quiz.topic}{" "}
            <span className={shared.mutedText}>
              · {allPending ? "Pending review" : `${correctWhole}/${decided} correct`}
              {pendingCount > 0 && !allPending ? ` · ${pendingCount} pending` : ""}
            </span>
          </p>
        </div>
        <div className={css({ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.125rem" })}>
          <span className={cx(css({ fontSize: "1.125rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" }), tone.scoreText)}>
            {percentage}%
          </span>
          {totalTime !== null && (
            <span className={css({ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.625rem", color: "color-mix(in srgb, var(--foreground) 70%, transparent)" })}>
              <Clock size={10} /> {totalTime}
            </span>
          )}
        </div>
      </div>

      {/* Score bar */}
      <div className={css({ marginTop: "0.75rem", height: "0.5rem", width: "100%", overflow: "hidden", borderRadius: "9999px", background: "var(--muted)" })}>
        <div
          className={cx(css({ height: "100%", borderRadius: "9999px", transition: "all 150ms" }), tone.bar)}
          style={{ width: `${percentage}%` }}
        />
      </div>

      {/* Summary row */}
      <div className={css({ marginTop: "0.75rem", display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: "1rem", rowGap: "0.25rem", fontSize: "0.75rem", color: "color-mix(in srgb, var(--foreground) 80%, transparent)" })}>
        <span className={css({ display: "flex", alignItems: "center", gap: "0.25rem" })}>
          <CheckCircle2 size={12} className={iconTone.correct} />
          {correctWhole} correct
        </span>
        <span className={css({ display: "flex", alignItems: "center", gap: "0.25rem" })}>
          <XCircle size={12} className={iconTone.wrong} />
          {decided - correctWhole} incorrect
        </span>
        {pendingCount > 0 && (
          <span className={css({ display: "flex", alignItems: "center", gap: "0.25rem" })}>
            <HelpCircle size={12} className={iconTone.pending} />
            {pendingCount} pending review
          </span>
        )}
        {result.flagged && result.flagged.length > 0 && (
          <span className={css({ display: "flex", alignItems: "center", gap: "0.25rem" })}>
            <Bookmark size={12} className={iconTone.partial} />
            {result.flagged.length} flagged
          </span>
        )}
      </div>

      {/* Details toggle */}
      <button
        type="button"
        onClick={() => setShowDetails((v) => !v)}
        className={shared.detailsButton}
      >
        {showDetails ? (
          <>
            <ChevronUp size={12} /> Hide breakdown
          </>
        ) : (
          <>
            <ChevronDown size={12} /> Show breakdown
          </>
        )}
      </button>

      {/* Expandable question breakdown */}
      {showDetails && (
        <div className={css({ marginTop: "0.5rem", display: "grid", gap: "0.375rem" })}>
          {statuses.map(({ q, status }, idx) => {
            const answer = (result.answers[q.id] ?? "").trim();
            const isExpanded = expandedQuestions.has(q.id);
            const pending = status.kind === "open-pending";
            const fullyCorrect =
              (status.kind === "objective" && status.correct) ||
              (status.kind === "open-graded" && status.verdict === "correct");
            const partial = status.kind === "open-graded" && status.verdict === "partial";

            const containerClass = pending
              ? questionContainer.pending
              : fullyCorrect
                ? questionContainer.correct
                : partial
                  ? questionContainer.partial
                  : questionContainer.wrong;

            const Icon = pending
              ? HelpCircle
              : fullyCorrect
                ? CheckCircle2
                : partial
                  ? MinusCircle
                  : XCircle;
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
              <div key={q.id} className={cx(css({ borderRadius: "0.5rem", border: "1px solid", padding: "0.625rem", fontSize: "0.75rem" }), containerClass)}>
                <button
                  type="button"
                  onClick={() => toggleQuestion(q.id)}
                  className={css({ display: "flex", width: "100%", alignItems: "flex-start", gap: "0.5rem", textAlign: "left" })}
                >
                  <Icon size={12} className={cx(css({ marginTop: "0.125rem", flexShrink: 0 }), iconClass)} />
                  <span className={css({ minWidth: 0, flex: 1, lineHeight: 1.625 })}>
                    <span className={css({ marginRight: "0.25rem", color: "color-mix(in srgb, var(--foreground) 70%, transparent)" })}>{idx + 1}.</span>
                    {q.question}
                  </span>
                  {pending && (
                    <span className={css({ flexShrink: 0, borderRadius: "0.25rem", background: "var(--muted)", padding: "0.125rem 0.375rem", fontSize: "0.5625rem", textTransform: "uppercase", letterSpacing: "0.025em", color: "var(--muted-foreground)" })}>
                      Pending review
                    </span>
                  )}
                  {isExpanded ? <ChevronUp size={12} className={css({ flexShrink: 0, color: "color-mix(in srgb, var(--foreground) 60%, transparent)" })} /> : <ChevronDown size={12} className={css({ flexShrink: 0, color: "color-mix(in srgb, var(--foreground) 60%, transparent)" })} />}
                </button>
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
                        <GraduationCap size={10} className={css({ marginTop: "0.125rem", flexShrink: 0 })} />
                        {status.note}
                      </p>
                    )}
                    {q.explanation && (
                      <p className={css({ display: "flex", alignItems: "flex-start", gap: "0.25rem", color: "color-mix(in srgb, var(--foreground) 80%, transparent)" })}>
                        <Lightbulb size={10} className={css({ marginTop: "0.125rem", flexShrink: 0 })} />
                        {q.explanation}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Actions */}
      {onReview && (
        <div className={css({ marginTop: "0.5rem", display: "flex", gap: "0.5rem" })}>
          <button
            type="button"
            onClick={() => onReview(data)}
            className={css({
              display: "inline-flex",
              alignItems: "center",
              gap: "0.25rem",
              borderRadius: "0.375rem",
              border: "1px solid var(--border)",
              padding: "0.25rem 0.5rem",
              fontSize: "0.75rem",
              color: "var(--foreground)",
              _hover: { background: "var(--accent)" },
            })}
          >
            <TrendingUp size={12} /> Review topic
          </button>
        </div>
      )}
    </div>
  );
}

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
    ? {
        iconBg: "bg-muted",
        iconText: "text-muted-foreground",
        scoreText: "text-muted-foreground",
        bar: "bg-muted-foreground/40",
      }
    : passed
    ? {
        iconBg: "bg-emerald-100 dark:bg-emerald-500/10",
        iconText: "text-emerald-700 dark:text-emerald-300",
        scoreText: "text-emerald-700 dark:text-emerald-300",
        bar: "bg-emerald-600 dark:bg-emerald-500",
      }
    : warning
      ? {
          iconBg: "bg-amber-100 dark:bg-amber-500/10",
          iconText: "text-amber-800 dark:text-amber-300",
          scoreText: "text-amber-800 dark:text-amber-300",
          bar: "bg-amber-600 dark:bg-amber-500",
        }
      : {
          iconBg: "bg-destructive/10",
          iconText: "text-destructive",
          scoreText: "text-destructive",
          bar: "bg-destructive",
        };

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
    <div className="my-3 rounded-xl border border-border bg-background p-4 text-foreground shadow-sm">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone.iconBg}`}>
          <GraduationCap size={18} className={tone.iconText} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Quiz Result</h3>
            <span className="text-[10px] text-foreground/70">
              {new Date(data.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </span>
          </div>
          <p className="truncate text-sm text-foreground">
            {quiz.topic}{" "}
            <span className="text-foreground/70">
              · {allPending ? "Pending review" : `${correctWhole}/${decided} correct`}
              {pendingCount > 0 && !allPending ? ` · ${pendingCount} pending` : ""}
            </span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className={`text-lg font-bold tabular-nums ${tone.scoreText}`}>
            {percentage}%
          </span>
          {totalTime !== null && (
            <span className="flex items-center gap-1 text-[10px] text-foreground/70">
              <Clock size={10} /> {totalTime}
            </span>
          )}
        </div>
      </div>

      {/* Score bar */}
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${tone.bar}`}
          style={{ width: `${percentage}%` }}
        />
      </div>

      {/* Summary row */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-foreground/80">
        <span className="flex items-center gap-1">
          <CheckCircle2 size={12} className="text-emerald-700 dark:text-emerald-300" />
          {correctWhole} correct
        </span>
        <span className="flex items-center gap-1">
          <XCircle size={12} className="text-destructive" />
          {decided - correctWhole} incorrect
        </span>
        {pendingCount > 0 && (
          <span className="flex items-center gap-1">
            <HelpCircle size={12} className="text-muted-foreground" />
            {pendingCount} pending review
          </span>
        )}
        {result.flagged && result.flagged.length > 0 && (
          <span className="flex items-center gap-1">
            <Bookmark size={12} className="text-amber-700 dark:text-amber-300" />
            {result.flagged.length} flagged
          </span>
        )}
      </div>

      {/* Details toggle */}
      <button
        type="button"
        onClick={() => setShowDetails((v) => !v)}
        className="mt-2 flex w-full items-center justify-center gap-1 rounded-md py-1.5 text-xs text-foreground/75 transition-colors hover:bg-muted/50 hover:text-foreground"
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
        <div className="mt-2 space-y-1.5">
          {statuses.map(({ q, status }, idx) => {
            const answer = (result.answers[q.id] ?? "").trim();
            const isExpanded = expandedQuestions.has(q.id);
            const pending = status.kind === "open-pending";
            const fullyCorrect =
              (status.kind === "objective" && status.correct) ||
              (status.kind === "open-graded" && status.verdict === "correct");
            const partial = status.kind === "open-graded" && status.verdict === "partial";

            const containerClass = pending
              ? "border-border bg-muted/30 text-foreground"
              : fullyCorrect
                ? "border-emerald-600/40 bg-emerald-50 text-foreground dark:border-emerald-500/30 dark:bg-emerald-500/10"
                : partial
                  ? "border-amber-600/40 bg-amber-50 text-foreground dark:border-amber-500/30 dark:bg-amber-500/10"
                  : "border-destructive/30 bg-destructive/5 text-foreground";

            const Icon = pending
              ? HelpCircle
              : fullyCorrect
                ? CheckCircle2
                : partial
                  ? MinusCircle
                  : XCircle;
            const iconClass = pending
              ? "text-muted-foreground"
              : fullyCorrect
                ? "text-emerald-700 dark:text-emerald-300"
                : partial
                  ? "text-amber-700 dark:text-amber-300"
                  : "text-destructive";

            const hintLabel =
              status.kind === "open-pending"
                ? status.hint === "close"
                  ? "looks close"
                  : status.hint === "some"
                    ? "some overlap"
                    : "needs review"
                : "";

            return (
              <div key={q.id} className={`rounded-lg border p-2.5 text-xs ${containerClass}`}>
                <button
                  type="button"
                  onClick={() => toggleQuestion(q.id)}
                  className="flex w-full items-start gap-2 text-left"
                >
                  <Icon size={12} className={`mt-0.5 shrink-0 ${iconClass}`} />
                  <span className="min-w-0 flex-1 leading-relaxed">
                    <span className="mr-1 text-foreground/70">{idx + 1}.</span>
                    {q.question}
                  </span>
                  {pending && (
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                      Pending review
                    </span>
                  )}
                  {isExpanded ? <ChevronUp size={12} className="shrink-0 text-foreground/60" /> : <ChevronDown size={12} className="shrink-0 text-foreground/60" />}
                </button>
                {isExpanded && (
                  <div className="mt-1.5 space-y-1 pl-5">
                    <p>
                      <span className="text-foreground/70">You:</span>{" "}
                      <span className={fullyCorrect ? "text-emerald-700 dark:text-emerald-300" : pending ? "text-foreground" : partial ? "text-amber-700 dark:text-amber-300" : "text-destructive"}>
                        {answer || "(blank)"}
                      </span>
                    </p>
                    <p>
                      <span className="text-foreground/70">
                        {isOpenEnded(q) ? "Reference answer:" : "Correct:"}
                      </span>{" "}
                      <span className="text-emerald-700 dark:text-emerald-300">{q.correctAnswer}</span>
                    </p>
                    {status.kind === "open-pending" && (
                      <p className="text-[10px] italic text-muted-foreground">
                        Your teacher is judging this answer in chat. Heuristic hint: {hintLabel} (not a grade).
                      </p>
                    )}
                    {status.kind === "open-graded" && status.note && (
                      <p className="flex items-start gap-1 text-foreground/80">
                        <GraduationCap size={10} className="mt-0.5 shrink-0" />
                        {status.note}
                      </p>
                    )}
                    {q.explanation && (
                      <p className="flex items-start gap-1 text-foreground/80">
                        <Lightbulb size={10} className="mt-0.5 shrink-0" />
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
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => onReview(data)}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-accent"
          >
            <TrendingUp size={12} /> Review topic
          </button>
        </div>
      )}
    </div>
  );
}

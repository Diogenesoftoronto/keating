import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bookmark,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  GraduationCap,
  Lightbulb,
  RotateCcw,
  TrendingUp,
  XCircle,
} from "lucide-react";
import type { Quiz, QuizQuestion } from "../keating/core";
import type { QuizResult } from "./QuizRenderer";
import { isOpenEnded, questionCredit } from "./QuizRenderer";

export interface QuizSessionProps {
  quiz: Quiz;
  onSubmit: (result: QuizResult) => void;
  onDismiss?: () => void;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatCountdown(seconds: number): string {
  const safeSeconds = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

/**
 * A dedicated full-session quiz panel that renders above the composer.
 * This replaces the inline `<QuizRenderer>` with a persistent, focused
 * quiz-taking experience that feels like a separate mode from chat.
 */
export function QuizSessionPanel({ quiz, onSubmit, onDismiss }: QuizSessionProps) {
  const [started, setStarted] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [elapsedMs, setElapsedMs] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState<number | undefined>(quiz.questions[0]?.timeLimit);
  const [finalTiming, setFinalTiming] = useState<QuizResult["timing"] | null>(null);
  const startRef = useRef<number>(Date.now());
  const questionEnteredRef = useRef<number>(Date.now());
  const perQuestionRef = useRef<Record<string, number>>({});

  const total = quiz.questions.length;
  const q = quiz.questions[currentIndex];

  const timedQuestions = useMemo(
    () => quiz.questions.filter((question) => typeof question.timeLimit === "number"),
    [quiz.questions],
  );
  const totalTimeLimit = useMemo(
    () => timedQuestions.reduce((sum, question) => sum + (question.timeLimit ?? 0), 0),
    [timedQuestions],
  );

  const handleStart = () => {
    const now = Date.now();
    startRef.current = now;
    questionEnteredRef.current = now;
    perQuestionRef.current = {};
    setElapsedMs(0);
    setFinalTiming(null);
    setTimeRemaining(quiz.questions[0]?.timeLimit);
    setStarted(true);
  };

  const setAnswer = useCallback((qid: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [qid]: value }));
  }, []);

  const toggleFlag = useCallback((qid: string) => {
    setFlagged((prev) => {
      const next = new Set(prev);
      if (next.has(qid)) next.delete(qid);
      else next.add(qid);
      return next;
    });
  }, []);

  const accrueCurrentQuestion = useCallback(() => {
    const currentQuestion = quiz.questions[currentIndex];
    if (!currentQuestion) return;
    const now = Date.now();
    perQuestionRef.current[currentQuestion.id] =
      (perQuestionRef.current[currentQuestion.id] ?? 0) + (now - questionEnteredRef.current);
    questionEnteredRef.current = now;
  }, [currentIndex, quiz.questions]);

  const goToQuestion = useCallback(
    (nextIndex: number) => {
      if (nextIndex < 0 || nextIndex >= total) return;
      accrueCurrentQuestion();
      questionEnteredRef.current = Date.now();
      setCurrentIndex(nextIndex);
    },
    [accrueCurrentQuestion, total],
  );

  const handleSubmit = useCallback(() => {
    if (submitted) return;
    accrueCurrentQuestion();
    // Compute score
    let score = 0;
    const partialCredits: Record<string, number> = {};
    for (const question of quiz.questions) {
      const answer = (answers[question.id] ?? "").trim();
      if (question.type === "multi_select" && question.correctAnswers) {
        const selected = new Set(answer.split(",").map((s) => s.trim()).filter(Boolean));
        const correct = question.correctAnswers;
        const selectedCorrect = correct.filter((c) => selected.has(c)).length;
        const selectedWrong = Array.from(selected).filter((s) => !correct.includes(s)).length;
        const credit = selectedCorrect / correct.length - selectedWrong / (question.options?.length || 1);
        partialCredits[question.id] = Math.max(0, credit);
        if (credit >= 0.99) score++;
      } else if (question.type === "fill_in" && question.blanks && question.blanks.length > 0) {
        const userAnswers = answer.split("|").map((s) => s.trim());
        const correctAnswers = question.correctAnswers ?? [question.correctAnswer];
        let correct = 0;
        for (let i = 0; i < Math.min(userAnswers.length, correctAnswers.length); i++) {
          if (userAnswers[i].toLowerCase() === correctAnswers[i].trim().toLowerCase()) correct++;
        }
        partialCredits[question.id] = correct / correctAnswers.length;
        if (correct === correctAnswers.length) score++;
      } else if (isOpenEnded(question)) {
        // Judged by the teacher (model) in chat — record the heuristic credit as
        // a soft hint but don't count it toward the local score.
        partialCredits[question.id] = questionCredit(question, answer);
      } else {
        const correct = answer.toLowerCase() === question.correctAnswer.toLowerCase();
        if (correct) score++;
        partialCredits[question.id] = correct ? 1 : 0;
      }
    }
    const timing = {
      totalMs: Date.now() - startRef.current,
      perQuestionMs: { ...perQuestionRef.current },
    };
    const result: QuizResult = {
      answers,
      score,
      weightedScore: score,
      timing,
      confidence: {},
      partialCredits,
      flagged: Array.from(flagged),
    };
    setElapsedMs(timing.totalMs);
    setFinalTiming(timing);
    setSubmitted(true);
    onSubmit(result);
  }, [accrueCurrentQuestion, answers, flagged, onSubmit, quiz.questions, submitted]);

  useEffect(() => {
    if (!started || submitted) return;
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - startRef.current);
    }, 250);
    return () => window.clearInterval(id);
  }, [started, submitted]);

  useEffect(() => {
    setTimeRemaining(q?.timeLimit);
  }, [q?.id, q?.timeLimit]);

  useEffect(() => {
    if (!started || submitted || typeof timeRemaining !== "number" || timeRemaining <= 0) return;
    const id = window.setInterval(() => {
      setTimeRemaining((previous) => {
        if (typeof previous !== "number" || previous <= 1) {
          window.clearInterval(id);
          return 0;
        }
        return previous - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [started, submitted, currentIndex, timeRemaining]);

  useEffect(() => {
    if (!started || submitted || typeof timeRemaining !== "number" || timeRemaining > 0) return;
    const id = window.setTimeout(() => {
      if (currentIndex >= total - 1) {
        handleSubmit();
      } else {
        goToQuestion(currentIndex + 1);
      }
    }, 200);
    return () => window.clearTimeout(id);
  }, [currentIndex, goToQuestion, handleSubmit, started, submitted, timeRemaining, total]);

  if (!started) {
    return (
      <div className="my-3 rounded-xl border border-border bg-background p-4 sm:p-6 shadow-sm">
        <div className="flex items-start gap-3 sm:gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <GraduationCap size={20} className="text-primary" />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <h3 className="text-base font-semibold">{quiz.topic}</h3>
            <p className="text-sm text-muted-foreground">
              {total} question{total !== 1 ? "s" : ""} · Mixed difficulty
            </p>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Clock size={13} />
                Timer starts when you begin
              </span>
              {totalTimeLimit > 0 && (
                <span className="inline-flex items-center gap-1 tabular-nums">
                  <AlertTriangle size={13} />
                  {timedQuestions.length} timed · {formatCountdown(totalTimeLimit)} total limit
                </span>
              )}
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={handleStart}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 sm:px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Start Quiz
              </button>
              {onDismiss && (
                <button
                  type="button"
                  onClick={onDismiss}
                  className="inline-flex h-9 items-center rounded-lg border border-border px-3 sm:px-4 text-sm hover:bg-accent"
                >
                  Skip
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (submitted) {
    // Open-ended questions are judged by the teacher (model) in chat, so they're
    // excluded from this local tally and reported as pending review instead.
    const objectiveQuestions = quiz.questions.filter((question) => !isOpenEnded(question));
    const pendingCount = total - objectiveQuestions.length;
    const decided = objectiveQuestions.length;
    const correctCount = objectiveQuestions.filter((question) => {
      if (question.type === "multi_select" && question.correctAnswers) {
        const selected = new Set((answers[question.id] ?? "").split(",").map((s) => s.trim()).filter(Boolean));
        return question.correctAnswers.every((c) => selected.has(c)) && selected.size === question.correctAnswers.length;
      }
      if (question.type === "fill_in" && question.blanks && question.blanks.length > 0) {
        const userAnswers = (answers[question.id] ?? "").split("|").map((s) => s.trim());
        const correctAnswers = question.correctAnswers ?? [question.correctAnswer];
        return userAnswers.every((a, i) => a.toLowerCase() === correctAnswers[i]?.trim().toLowerCase());
      }
      return (answers[question.id] ?? "").trim().toLowerCase() === question.correctAnswer.toLowerCase();
    }).length;
    const ratio = decided > 0 ? correctCount / decided : 0;

    return (
      <div className="my-3 rounded-xl border border-border bg-background p-4 sm:p-5 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${decided === 0 || ratio >= 0.7 ? "bg-emerald-500/10" : "bg-amber-500/10"}`}>
            {decided === 0 || ratio >= 0.7 ? (
              <CheckCircle2 size={20} className="text-emerald-600" />
            ) : (
              <AlertTriangle size={20} className="text-amber-600" />
            )}
          </div>
          <div>
            <h3 className="font-semibold">{quiz.topic}: Completed</h3>
            <p className="text-sm text-muted-foreground">
              {decided === 0 ? "Pending review" : `${correctCount}/${decided} correct`}
              {pendingCount > 0 ? ` · ${pendingCount} pending review` : ""} ·{" "}
              {formatDuration(finalTiming?.totalMs ?? elapsedMs)}
              {decided > 0 ? ` · ${Math.round(ratio * 100)}%` : ""}
            </p>
          </div>
        </div>
        <QuizReview questions={quiz.questions} answers={answers} timing={finalTiming} />
      </div>
    );
  }

  // In-progress quiz
  return (
    <div className="my-3 rounded-xl border border-border bg-background p-4 sm:p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="min-w-0 flex items-center gap-2">
          <GraduationCap size={16} className="shrink-0 text-primary" />
          <span className="truncate text-sm font-medium">{quiz.topic}</span>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/20 px-2 py-1 tabular-nums">
            <Clock size={13} />
            Total {formatDuration(elapsedMs)}
          </span>
          {typeof timeRemaining === "number" && (
            <span
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 tabular-nums ${
                timeRemaining <= 5
                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                  : "border-border bg-muted/20"
              }`}
            >
              <AlertTriangle size={13} />
              Question {formatCountdown(timeRemaining)}
            </span>
          )}
          <span>{currentIndex + 1} / {total}</span>
        </div>
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted mb-4">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${((currentIndex + 1) / total) * 100}%` }}
        />
      </div>

      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium leading-relaxed flex-1">{q.question}</p>
          <button
            type="button"
            onClick={() => toggleFlag(q.id)}
            className={`shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors ${flagged.has(q.id) ? "text-amber-500" : "text-muted-foreground hover:bg-accent"}`}
            title={flagged.has(q.id) ? "Unflag" : "Flag for review"}
          >
            <Bookmark size={14} fill={flagged.has(q.id) ? "currentColor" : "none"} />
          </button>
        </div>

        <QuizAnswerInput question={q} value={answers[q.id] ?? ""} onChange={(v) => setAnswer(q.id, v)} />
      </div>

      <div className="flex items-center justify-between gap-2 mt-5">
        <button
          type="button"
          disabled={currentIndex === 0}
          onClick={() => goToQuestion(currentIndex - 1)}
          className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
        >
          Previous
        </button>
        {currentIndex < total - 1 ? (
          <button
            type="button"
            onClick={() => goToQuestion(currentIndex + 1)}
            className="inline-flex h-9 items-center gap-1 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            className="inline-flex h-9 items-center gap-1 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Submit
          </button>
        )}
      </div>
    </div>
  );
}

/** Renders the answer input for a single quiz question */
function QuizAnswerInput({
  question,
  value,
  onChange,
}: {
  question: Quiz["questions"][number];
  value: string;
  onChange: (val: string) => void;
}) {
  if (question.type === "multiple_choice" && question.options) {
    return (
      <div className="space-y-1.5">
        {question.options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`flex w-full items-center gap-3 rounded-lg border-2 px-4 py-2.5 text-left text-sm transition-all ${
              value === opt
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-muted/20 hover:border-primary/50"
            }`}
          >
            <div className={`h-4 w-4 shrink-0 rounded-full border-2 ${value === opt ? "border-primary bg-primary" : "border-border"}`} />
            <span className="flex-1">{opt}</span>
          </button>
        ))}
      </div>
    );
  }

  if (question.type === "multi_select" && question.options) {
    const selected = new Set(value.split(",").map((s) => s.trim()).filter(Boolean));
    const toggle = (opt: string) => {
      const next = new Set(selected);
      if (next.has(opt)) next.delete(opt);
      else next.add(opt);
      onChange(Array.from(next).join(", "));
    };
    return (
      <div className="space-y-1.5">
        {question.options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => toggle(opt)}
            className={`flex w-full items-center gap-3 rounded-lg border-2 px-4 py-2.5 text-left text-sm transition-all ${
              selected.has(opt)
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-muted/20 hover:border-primary/50"
            }`}
          >
            <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 ${selected.has(opt) ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
              {selected.has(opt) ? <CheckCircle2 size={12} /> : null}
            </span>
            <span className="flex-1">{opt}</span>
          </button>
        ))}
      </div>
    );
  }

  if (question.type === "true_false") {
    return (
      <div className="flex gap-2">
        {["True", "False"].map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`flex-1 rounded-lg border-2 px-4 py-2.5 text-sm font-medium transition-all ${
              value === opt
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-muted/20 hover:border-primary/50"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    );
  }

  if (question.type === "slider" && typeof question.min === "number" && typeof question.max === "number") {
    const numValue = value ? parseFloat(value) : question.min;
    return (
      <div className="space-y-2">
        <input
          type="range"
          min={question.min}
          max={question.max}
          step={question.step ?? 1}
          value={numValue}
          onChange={(e) => onChange(e.target.value)}
          className="w-full accent-primary"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{question.min}</span>
          <span className="font-medium text-foreground">{numValue}</span>
          <span>{question.max}</span>
        </div>
      </div>
    );
  }

  if (question.type === "fill_in" && question.blanks && question.blanks.length > 0) {
    return <MultiBlankInput question={question} value={value} onChange={onChange} />;
  }

  // short_answer, fill_in (single blank), transfer
  return (
    <input
      type="text"
      className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
      placeholder={question.type === "fill_in" ? "Fill in the blank..." : "Type your answer..."}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Multi-blank fill-in input */
function MultiBlankInput({
  question,
  value,
  onChange,
}: {
  question: Quiz["questions"][number];
  value: string;
  onChange: (val: string) => void;
}) {
  const values = useMemo(() => value.split("|").map((s) => s.trim()), [value]);
  const blanks = question.blanks ?? [];
  const parts = useMemo(() => {
    const result: { text: string; isBlank: boolean; index: number }[] = [];
    const regex = /_{3,}|\{\{blank\}\}/g;
    let lastIndex = 0;
    let blankIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(question.question)) !== null) {
      if (match.index > lastIndex) {
        result.push({ text: question.question.slice(lastIndex, match.index), isBlank: false, index: -1 });
      }
      result.push({ text: match[0], isBlank: true, index: blankIndex++ });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < question.question.length) {
      result.push({ text: question.question.slice(lastIndex), isBlank: false, index: -1 });
    }
    return result;
  }, [question.question]);

  const setValue = (idx: number, val: string) => {
    const next = [...values];
    next[idx] = val;
    onChange(next.join("|"));
  };

  let blankCounter = 0;
  return (
    <div className="text-sm leading-relaxed">
      {parts.map((part, idx) => {
        if (!part.isBlank) return <span key={idx}>{part.text}</span>;
        const bIdx = blankCounter++;
        const blankDef = blanks[bIdx];
        return (
          <span key={idx} className="inline-flex items-center gap-1 mx-1">
            <input
              type="text"
              className="inline-block w-20 h-7 rounded border border-border bg-background px-2 text-sm text-center outline-none focus:border-primary placeholder:text-muted-foreground/50"
              placeholder={blankDef?.placeholder ?? "___"}
              value={values[bIdx] ?? ""}
              onChange={(e) => setValue(bIdx, e.target.value)}
            />
            {blankDef?.hint && <span className="text-[10px] text-muted-foreground">{blankDef.hint}</span>}
          </span>
        );
      })}
    </div>
  );
}

/** Reviewable quiz result breakdown */
function QuizReview({
  questions,
  answers,
  timing,
}: {
  questions: Quiz["questions"];
  answers: Record<string, string>;
  timing?: QuizResult["timing"] | null;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-2">
      {questions.map((q, idx) => {
        const answer = (answers[q.id] ?? "").trim();
        const isExpanded = expanded.has(q.id);

        let correct = false;
        if (q.type === "multi_select" && q.correctAnswers) {
          const selected = new Set(answer.split(",").map((s) => s.trim()).filter(Boolean));
          correct = q.correctAnswers.every((c) => selected.has(c)) && selected.size === q.correctAnswers.length;
        } else if (q.type === "fill_in" && q.blanks && q.blanks.length > 0) {
          const userAnswers = answer.split("|").map((s) => s.trim());
          const correctAnswers = q.correctAnswers ?? [q.correctAnswer];
          correct = userAnswers.every((a, i) => a.toLowerCase() === correctAnswers[i]?.trim().toLowerCase());
        } else {
          correct = answer.toLowerCase() === q.correctAnswer.toLowerCase();
        }

        return (
          <div
            key={q.id}
            className={`rounded-lg border p-3 transition-colors ${
              correct ? "border-emerald-500/30 bg-emerald-500/5" : "border-border bg-muted/20"
            }`}
          >
            <button
              type="button"
              onClick={() => toggle(q.id)}
              className="flex w-full items-start gap-2 text-left"
            >
              {correct ? (
                <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600" />
              ) : (
                <XCircle size={14} className="mt-0.5 shrink-0 text-destructive" />
              )}
              <span className="min-w-0 flex-1 text-sm">
                <span className="text-muted-foreground mr-2">{idx + 1}.</span>
                {q.question}
              </span>
              {isExpanded ? <ChevronUp size={14} className="shrink-0 text-muted-foreground" /> : <ChevronDown size={14} className="shrink-0 text-muted-foreground" />}
            </button>
            {isExpanded && (
              <div className="mt-2 space-y-1.5 pl-6 text-sm">
                <p>
                  <span className="text-muted-foreground">Your answer:</span>{" "}
                  <span className={correct ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"}>
                    {answer || "(blank)"}
                  </span>
                </p>
                {!correct && (
                  <p>
                    <span className="text-muted-foreground">Correct:</span>{" "}
                    <span className="text-emerald-700 dark:text-emerald-300">{q.correctAnswer}</span>
                  </p>
                )}
                {q.explanation && (
                  <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Lightbulb size={12} className="mt-0.5 shrink-0" />
                    {q.explanation}
                  </p>
                )}
                {typeof timing?.perQuestionMs?.[q.id] === "number" && (
                  <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Clock size={10} />
                    Time: {formatDuration(timing.perQuestionMs[q.id])}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

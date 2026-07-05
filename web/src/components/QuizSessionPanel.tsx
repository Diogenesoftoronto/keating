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
import { css, cx } from "../../styled-system/css";

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

const sm = "@media (min-width: 640px)";
const dark = ".dark &";

const qs = {
  panel: css({
    marginBlock: "0.75rem",
    borderRadius: "0.75rem",
    border: "1px solid var(--border)",
    background: "var(--background)",
    padding: "1rem",
    boxShadow: "var(--shadow-card)",
    [sm]: { padding: "1.25rem" },
  }),
  startPanel: css({
    marginBlock: "0.75rem",
    borderRadius: "0.75rem",
    border: "1px solid var(--border)",
    background: "var(--background)",
    padding: "1rem",
    boxShadow: "var(--shadow-card)",
    [sm]: { padding: "1.5rem" },
  }),
  rowStart: css({ display: "flex", alignItems: "flex-start", gap: "0.75rem", [sm]: { gap: "1rem" } }),
  rowCenter: css({ display: "flex", alignItems: "center", gap: "0.5rem" }),
  iconBox: css({
    display: "flex",
    height: "2.5rem",
    width: "2.5rem",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "0.5rem",
    background: "color-mix(in srgb, var(--primary) 10%, transparent)",
  }),
  minFlex: css({ minWidth: 0, flex: 1 }),
  muted: css({ color: "var(--muted-foreground)" }),
  primaryIcon: css({ color: "var(--primary)" }),
  primaryButton: css({
    display: "inline-flex",
    height: "2.25rem",
    alignItems: "center",
    gap: "0.5rem",
    borderRadius: "0.5rem",
    background: "var(--primary)",
    paddingInline: "0.75rem",
    fontSize: "0.875rem",
    fontWeight: 500,
    color: "var(--primary-foreground)",
    _hover: { background: "color-mix(in srgb, var(--primary) 90%, transparent)" },
    [sm]: { paddingInline: "1rem" },
  }),
  outlineButton: css({
    display: "inline-flex",
    height: "2.25rem",
    alignItems: "center",
    borderRadius: "0.5rem",
    border: "1px solid var(--border)",
    paddingInline: "0.75rem",
    fontSize: "0.875rem",
    _hover: { background: "var(--accent)" },
    [sm]: { paddingInline: "1rem" },
  }),
  progressTrack: css({
    height: "0.375rem",
    width: "100%",
    overflow: "hidden",
    borderRadius: "9999px",
    background: "var(--muted)",
  }),
  progressFill: css({
    height: "100%",
    borderRadius: "9999px",
    background: "var(--primary)",
    transition: "all 150ms",
  }),
  navButton: css({
    display: "inline-flex",
    height: "2.25rem",
    alignItems: "center",
    gap: "0.25rem",
    borderRadius: "0.5rem",
    border: "1px solid var(--border)",
    paddingInline: "0.75rem",
    fontSize: "0.875rem",
    _hover: { background: "var(--accent)" },
    _disabled: { pointerEvents: "none", opacity: 0.4 },
  }),
  input: css({
    height: "2.5rem",
    width: "100%",
    borderRadius: "0.5rem",
    border: "1px solid var(--border)",
    background: "var(--background)",
    paddingInline: "0.75rem",
    fontSize: "0.875rem",
    outline: "none",
    _focus: { borderColor: "var(--primary)" },
  }),
  selectInput: css({
    width: "100%",
    accentColor: "var(--primary)",
  }),
};

function choiceButtonClass(active: boolean) {
  return css({
    display: "flex",
    width: "100%",
    alignItems: "center",
    gap: "0.75rem",
    borderRadius: "0.5rem",
    border: "2px solid",
    borderColor: active ? "var(--primary)" : "var(--border)",
    background: active
      ? "color-mix(in srgb, var(--primary) 10%, transparent)"
      : "color-mix(in srgb, var(--muted) 20%, transparent)",
    padding: "0.625rem 1rem",
    textAlign: "left",
    fontSize: "0.875rem",
    color: active ? "var(--primary)" : undefined,
    transition: "all 150ms",
    _hover: active ? {} : { borderColor: "color-mix(in srgb, var(--primary) 50%, transparent)" },
  });
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
      <div className={qs.startPanel}>
        <div className={qs.rowStart}>
          <div className={qs.iconBox}>
            <GraduationCap size={20} className={qs.primaryIcon} />
          </div>
          <div className={cx(qs.minFlex, css({ display: "grid", gap: "0.5rem" }))}>
            <h3 className={css({ fontSize: "1rem", fontWeight: 600 })}>{quiz.topic}</h3>
            <p className={cx(qs.muted, css({ fontSize: "0.875rem" }))}>
              {total} question{total !== 1 ? "s" : ""} · Mixed difficulty
            </p>
            <div className={cx(qs.muted, css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem", fontSize: "0.75rem" }))}>
              <span className={css({ display: "inline-flex", alignItems: "center", gap: "0.25rem", fontVariantNumeric: "tabular-nums" })}>
                <Clock size={13} />
                Timer starts when you begin
              </span>
              {totalTimeLimit > 0 && (
                <span className={css({ display: "inline-flex", alignItems: "center", gap: "0.25rem", fontVariantNumeric: "tabular-nums" })}>
                  <AlertTriangle size={13} />
                  {timedQuestions.length} timed · {formatCountdown(totalTimeLimit)} total limit
                </span>
              )}
            </div>
            <div className={css({ display: "flex", gap: "0.5rem", paddingTop: "0.5rem" })}>
              <button
                type="button"
                onClick={handleStart}
                className={qs.primaryButton}
              >
                Start Quiz
              </button>
              {onDismiss && (
                <button
                  type="button"
                  onClick={onDismiss}
                  className={qs.outlineButton}
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
      <div className={qs.panel}>
        <div className={css({ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.75rem" })}>
          <div className={css({
            display: "flex",
            height: "2.5rem",
            width: "2.5rem",
            flexShrink: 0,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "0.5rem",
            background: decided === 0 || ratio >= 0.7 ? "rgba(16, 185, 129, 0.1)" : "rgba(245, 158, 11, 0.1)",
          })}>
            {decided === 0 || ratio >= 0.7 ? (
              <CheckCircle2 size={20} className={css({ color: "#059669" })} />
            ) : (
              <AlertTriangle size={20} className={css({ color: "#d97706" })} />
            )}
          </div>
          <div>
            <h3 className={css({ fontWeight: 600 })}>{quiz.topic}: Completed</h3>
            <p className={cx(qs.muted, css({ fontSize: "0.875rem" }))}>
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
    <div className={qs.panel}>
      <div className={css({ marginBottom: "1rem", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" })}>
        <div className={css({ minWidth: 0, display: "flex", alignItems: "center", gap: "0.5rem" })}>
          <GraduationCap size={16} className={cx(css({ flexShrink: 0 }), qs.primaryIcon)} />
          <span className={css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.875rem", fontWeight: 500 })}>{quiz.topic}</span>
        </div>
        <div className={cx(qs.muted, css({ display: "flex", flexShrink: 0, flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: "0.5rem", fontSize: "0.75rem" }))}>
          <span className={css({ display: "inline-flex", alignItems: "center", gap: "0.25rem", borderRadius: "0.375rem", border: "1px solid var(--border)", background: "color-mix(in srgb, var(--muted) 20%, transparent)", padding: "0.25rem 0.5rem", fontVariantNumeric: "tabular-nums" })}>
            <Clock size={13} />
            Total {formatDuration(elapsedMs)}
          </span>
          {typeof timeRemaining === "number" && (
            <span
              className={css({
                display: "inline-flex",
                alignItems: "center",
                gap: "0.25rem",
                borderRadius: "0.375rem",
                border: "1px solid",
                borderColor: timeRemaining <= 5 ? "color-mix(in srgb, var(--destructive) 30%, transparent)" : "var(--border)",
                background: timeRemaining <= 5 ? "color-mix(in srgb, var(--destructive) 10%, transparent)" : "color-mix(in srgb, var(--muted) 20%, transparent)",
                padding: "0.25rem 0.5rem",
                color: timeRemaining <= 5 ? "var(--destructive)" : undefined,
                fontVariantNumeric: "tabular-nums",
              })}
            >
              <AlertTriangle size={13} />
              Question {formatCountdown(timeRemaining)}
            </span>
          )}
          <span>{currentIndex + 1} / {total}</span>
        </div>
      </div>

      <div className={cx(qs.progressTrack, css({ marginBottom: "1rem" }))}>
        <div
          className={qs.progressFill}
          style={{ width: `${((currentIndex + 1) / total) * 100}%` }}
        />
      </div>

      <div className={css({ display: "grid", gap: "1rem" })}>
        <div className={css({ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem" })}>
          <p className={css({ flex: 1, fontSize: "0.875rem", fontWeight: 500, lineHeight: 1.625 })}>{q.question}</p>
          <button
            type="button"
            onClick={() => toggleFlag(q.id)}
            className={css({
              display: "inline-flex",
              height: "2rem",
              width: "2rem",
              flexShrink: 0,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "0.375rem",
              color: flagged.has(q.id) ? "#f59e0b" : "var(--muted-foreground)",
              transition: "color 150ms, background-color 150ms",
              _hover: flagged.has(q.id) ? {} : { background: "var(--accent)" },
            })}
            title={flagged.has(q.id) ? "Unflag" : "Flag for review"}
          >
            <Bookmark size={14} fill={flagged.has(q.id) ? "currentColor" : "none"} />
          </button>
        </div>

        <QuizAnswerInput question={q} value={answers[q.id] ?? ""} onChange={(v) => setAnswer(q.id, v)} />
      </div>

      <div className={css({ marginTop: "1.25rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" })}>
        <button
          type="button"
          disabled={currentIndex === 0}
          onClick={() => goToQuestion(currentIndex - 1)}
          className={qs.navButton}
        >
          Previous
        </button>
        {currentIndex < total - 1 ? (
          <button
            type="button"
            onClick={() => goToQuestion(currentIndex + 1)}
            className={qs.primaryButton}
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            className={qs.primaryButton}
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
      <div className={css({ display: "grid", gap: "0.375rem" })}>
        {question.options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={choiceButtonClass(value === opt)}
          >
            <div className={css({ height: "1rem", width: "1rem", flexShrink: 0, borderRadius: "9999px", border: "2px solid", borderColor: value === opt ? "var(--primary)" : "var(--border)", background: value === opt ? "var(--primary)" : undefined })} />
            <span className={css({ flex: 1 })}>{opt}</span>
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
      <div className={css({ display: "grid", gap: "0.375rem" })}>
        {question.options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => toggle(opt)}
            className={choiceButtonClass(selected.has(opt))}
          >
            <span className={css({ display: "flex", height: "1rem", width: "1rem", flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: "0.25rem", border: "2px solid", borderColor: selected.has(opt) ? "var(--primary)" : "var(--border)", background: selected.has(opt) ? "var(--primary)" : undefined, color: selected.has(opt) ? "var(--primary-foreground)" : undefined })}>
              {selected.has(opt) ? <CheckCircle2 size={12} /> : null}
            </span>
            <span className={css({ flex: 1 })}>{opt}</span>
          </button>
        ))}
      </div>
    );
  }

  if (question.type === "true_false") {
    return (
      <div className={css({ display: "flex", gap: "0.5rem" })}>
        {["True", "False"].map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={cx(choiceButtonClass(value === opt), css({ flex: 1, justifyContent: "center", fontWeight: 500 }))}
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
      <div className={css({ display: "grid", gap: "0.5rem" })}>
        <input
          type="range"
          min={question.min}
          max={question.max}
          step={question.step ?? 1}
          value={numValue}
          onChange={(e) => onChange(e.target.value)}
          className={qs.selectInput}
        />
        <div className={cx(qs.muted, css({ display: "flex", justifyContent: "space-between", fontSize: "0.75rem" }))}>
          <span>{question.min}</span>
          <span className={css({ fontWeight: 500, color: "var(--foreground)" })}>{numValue}</span>
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
      className={qs.input}
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
    <div className={css({ fontSize: "0.875rem", lineHeight: 1.625 })}>
      {parts.map((part, idx) => {
        if (!part.isBlank) return <span key={idx}>{part.text}</span>;
        const bIdx = blankCounter++;
        const blankDef = blanks[bIdx];
        return (
          <span key={idx} className={css({ marginInline: "0.25rem", display: "inline-flex", alignItems: "center", gap: "0.25rem" })}>
            <input
              type="text"
              className={css({
                display: "inline-block",
                height: "1.75rem",
                width: "5rem",
                borderRadius: "0.25rem",
                border: "1px solid var(--border)",
                background: "var(--background)",
                paddingInline: "0.5rem",
                textAlign: "center",
                fontSize: "0.875rem",
                outline: "none",
                _focus: { borderColor: "var(--primary)" },
                "&::placeholder": { color: "color-mix(in srgb, var(--muted-foreground) 50%, transparent)" },
              })}
              placeholder={blankDef?.placeholder ?? "___"}
              value={values[bIdx] ?? ""}
              onChange={(e) => setValue(bIdx, e.target.value)}
            />
            {blankDef?.hint && <span className={cx(qs.muted, css({ fontSize: "0.625rem" }))}>{blankDef.hint}</span>}
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
    <div className={css({ display: "grid", gap: "0.5rem" })}>
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
            className={css({
              borderRadius: "0.5rem",
              border: "1px solid",
              borderColor: correct ? "rgba(16, 185, 129, 0.3)" : "var(--border)",
              background: correct ? "rgba(16, 185, 129, 0.05)" : "color-mix(in srgb, var(--muted) 20%, transparent)",
              padding: "0.75rem",
              transition: "color 150ms, background-color 150ms, border-color 150ms",
            })}
          >
            <button
              type="button"
              onClick={() => toggle(q.id)}
              className={css({ display: "flex", width: "100%", alignItems: "flex-start", gap: "0.5rem", textAlign: "left" })}
            >
              {correct ? (
                <CheckCircle2 size={14} className={css({ marginTop: "0.125rem", flexShrink: 0, color: "#059669" })} />
              ) : (
                <XCircle size={14} className={css({ marginTop: "0.125rem", flexShrink: 0, color: "var(--destructive)" })} />
              )}
              <span className={css({ minWidth: 0, flex: 1, fontSize: "0.875rem" })}>
                <span className={cx(qs.muted, css({ marginRight: "0.5rem" }))}>{idx + 1}.</span>
                {q.question}
              </span>
              {isExpanded ? <ChevronUp size={14} className={cx(qs.muted, css({ flexShrink: 0 }))} /> : <ChevronDown size={14} className={cx(qs.muted, css({ flexShrink: 0 }))} />}
            </button>
            {isExpanded && (
              <div className={css({ marginTop: "0.5rem", display: "grid", gap: "0.375rem", paddingLeft: "1.5rem", fontSize: "0.875rem" })}>
                <p>
                  <span className={qs.muted}>Your answer:</span>{" "}
                  <span className={correct ? css({ color: "#047857", [dark]: { color: "#6ee7b7" } }) : css({ color: "var(--destructive)" })}>
                    {answer || "(blank)"}
                  </span>
                </p>
                {!correct && (
                  <p>
                    <span className={qs.muted}>Correct:</span>{" "}
                    <span className={css({ color: "#047857", [dark]: { color: "#6ee7b7" } })}>{q.correctAnswer}</span>
                  </p>
                )}
                {q.explanation && (
                  <p className={cx(qs.muted, css({ display: "flex", alignItems: "flex-start", gap: "0.375rem", fontSize: "0.75rem" }))}>
                    <Lightbulb size={12} className={css({ marginTop: "0.125rem", flexShrink: 0 })} />
                    {q.explanation}
                  </p>
                )}
                {typeof timing?.perQuestionMs?.[q.id] === "number" && (
                  <p className={cx(qs.muted, css({ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.625rem" }))}>
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

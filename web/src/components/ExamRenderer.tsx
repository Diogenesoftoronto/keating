import { LessonFrame, LessonScore } from "./lesson/LessonFrame";
import { Countdown } from "../design-system/charts";
import { useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { KeatingGlyph } from "../design-system/glyphs";
import {
  MIN_EXAM_QUESTIONS,
  type UiActionReceipt,
  type UiQuestionGroupResponse,
} from "@keating/learner-contracts";
import {
  Question,
  answerForQuizResponse,
  type SharedUiActionEvent,
} from "../keating/openui/shared-renderer";
import { QuizGradesContext } from "./quiz-grades-context";
import { objectiveCredit, quizOutcome, summarizeQuiz } from "../keating/openui/quiz-progress";
import { formatQuizDuration } from "./quiz/game";
import { MarkdownBlock } from "./MarkdownBlock";
import {
  buildExamCompletion,
  DEFAULT_EXAM_SECONDS,
  examResponseHasAnswer,
  examTiming,
  moveExamClock,
  startExamClock,
  type ExamClock,
  type ExamCompletion,
  type ExamNode,
} from "./exam/attempt";
import { examDraftKey, readExamDraft, saveExamDraft } from "./exam/draft";
import "./exam/exam.css";

export interface ExamRendererProps {
  node: ExamNode;
  documentId?: string;
  receipt?: UiActionReceipt;
  disabled: boolean;
  onAction?: (event: SharedUiActionEvent) => boolean;
}

export function ExamRenderer(props: ExamRendererProps) {
  if (props.node.questions.length < MIN_EXAM_QUESTIONS) {
    return <LessonFrame glyph="quiz" kind="Exam unavailable" title={props.node.title} className="exam-frame" data-exam={props.node.id}>
      <p className="exam-error" role="alert">Exams require at least {MIN_EXAM_QUESTIONS} questions. This exam has {props.node.questions.length}.</p>
    </LessonFrame>;
  }
  return <ExamAttempt key={JSON.stringify(props.node)} {...props} />;
}

function ExamAttempt({
  node,
  documentId,
  receipt,
  disabled,
  onAction,
}: ExamRendererProps) {
  const draftKey = examDraftKey(documentId, node.id);
  const [initialDraft] = useState(() => readExamDraft(draftKey, node));
  const saved =
    receipt?.action.type === "complete-quiz" ? receipt.action : undefined;
  const [clock, setClock] = useState<ExamClock | undefined>(
    initialDraft?.clock,
  );
  const [index, setIndex] = useState(initialDraft?.index ?? 0);
  const [reviewing, setReviewing] = useState(initialDraft?.reviewing ?? false);
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const navigatorId = useId();
  const [responses, setResponses] = useState<
    Record<string, UiQuestionGroupResponse>
  >(initialDraft?.responses ?? {});
  const [ready, setReady] = useState<Record<string, boolean>>(
    initialDraft?.ready ?? {},
  );
  const [flagged, setFlagged] = useState<string[]>(initialDraft?.flagged ?? []);
  const [pending, setPending] = useState<ExamCompletion | undefined>(
    initialDraft?.pending,
  );
  const [delivered, setDelivered] = useState<ExamCompletion>();
  const [error, setError] = useState<string>();
  const [localSaved, setLocalSaved] = useState(true);
  const [now, setNow] = useState(Date.now);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const seconds = node.examTimeLimit ?? DEFAULT_EXAM_SECONDS;
  const remainingMs = clock
    ? Math.max(
        0,
        clock.deadlineAt -
          (pending ? clock.startedAt + pending.timing.totalMs : now),
      )
    : seconds * 1000;
  const expired =
    pending?.examTimedOut ?? Boolean(clock && now >= clock.deadlineAt);
  const terminal = receipt?.state === "completed" || Boolean(delivered);
  const frozen = disabled || expired || Boolean(pending) || terminal;
  const current = node.questions[index];
  const answered = node.questions.filter(
    (question) => ready[question.id],
  ).length;
  const answerText = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(responses)
          .filter(([, response]) => examResponseHasAnswer(response))
          .map(([id, response]) => [id, answerForQuizResponse(response)]),
      ),
    [responses],
  );

  const expire = (at: number) => {
    setNow(at);
    setClock((value) =>
      value ? moveExamClock(value, undefined, value.deadlineAt) : value,
    );
    setReviewing(true);
  };

  useEffect(() => {
    if (!clock || terminal || pending) return;
    if (Date.now() >= clock.deadlineAt) {
      expire(Date.now());
      return;
    }
    const interval = setInterval(() => {
      const at = Date.now();
      if (at >= clock.deadlineAt) {
        expire(at);
        clearInterval(interval);
      } else setNow(at);
    }, 250);
    return () => clearInterval(interval);
  }, [clock?.deadlineAt, terminal, pending]);

  useEffect(() => {
    if (!clock || terminal) return;
    setLocalSaved(
      saveExamDraft(draftKey, {
        version: 1,
        signature: JSON.stringify(node),
        clock,
        index,
        reviewing,
        responses,
        ready,
        flagged,
        ...(pending ? { pending } : {}),
      }),
    );
  }, [
    draftKey,
    node,
    clock,
    index,
    reviewing,
    responses,
    ready,
    flagged,
    pending,
    terminal,
  ]);

  const navigate = (next: number | "review") => {
    if (!clock || pending || disabled) return;
    if (Date.now() >= clock.deadlineAt) {
      expire(Date.now());
      return;
    }
    setClock(
      moveExamClock(
        clock,
        next === "review" ? undefined : node.questions[next]?.id,
        Date.now(),
      ),
    );
    setReviewing(next === "review");
    setNavigatorOpen(false);
    if (next !== "review") setIndex(next);
  };
  useEffect(() => {
    if (clock) headingRef.current?.focus({ preventScroll: true });
  }, [index, reviewing, Boolean(clock)]);

  const updateResponse = (
    response: UiQuestionGroupResponse,
    isReady: boolean,
  ) => {
    if (frozen || !clock) return;
    if (Date.now() >= clock.deadlineAt) {
      expire(Date.now());
      return;
    }
    setResponses((value) =>
      JSON.stringify(value[response.questionId]) === JSON.stringify(response)
        ? value
        : { ...value, [response.questionId]: response },
    );
    setReady((value) =>
      value[response.questionId] === isReady
        ? value
        : { ...value, [response.questionId]: isReady },
    );
  };
  const submit = () => {
    if (!clock || disabled || terminal) return;
    const at = Date.now();
    const intent =
      pending ??
      buildExamCompletion({
        node,
        answers: answerText,
        flagged,
        ready,
        timing: examTiming(clock, at),
        timedOut: at >= clock.deadlineAt,
      });
    setPending(intent);
    setError(undefined);
    // Freeze the exact payload before delivery so reload/retry cannot change timing.
    setLocalSaved(
      saveExamDraft(draftKey, {
        version: 1,
        signature: JSON.stringify(node),
        clock,
        index,
        reviewing: true,
        responses,
        ready,
        flagged,
        pending: intent,
      }),
    );
    try {
      const accepted = onAction?.({
        intent,
        humanFriendlyMessage: `Submitted exam: ${node.title}. ${intent.answers.length}/${node.questions.length} answered in ${formatQuizDuration(intent.timing.totalMs)}.${intent.examTimedOut ? " Time limit reached." : ""}`,
      });
      if (accepted === true) setDelivered(intent);
      else setError("Your exam is ready. Retry saving it.");
    } catch {
      setError("Your exam is ready. Retry saving it.");
    }
  };

  if (terminal)
    return <ExamResults node={node} completion={saved ?? delivered!} focusOnMount={Boolean(delivered)} />;
  const minutes = seconds < 60 ? `${seconds} seconds` : `${Number((seconds / 60).toFixed(1))} minutes`;
  if (!clock)
    return (
      <LessonFrame glyph="quiz" kind="Exam" title={node.title} className="exam-frame" data-exam={node.id} data-exam-phase="ready"
        tools={<span className="exam-clock"><KeatingGlyph name="clock" size={13} />{seconds < 60 ? `${seconds} s` : `${Number((seconds / 60).toFixed(1))} min`}</span>}
        footer={<>
          <span className="lesson-foot-meta">Answers save as you go</span>
          <button
            type="button"
            className="lesson-primary"
            data-glyph-surface="inverse"
            disabled={disabled || node.questions.length === 0}
            onClick={() => {
              const at = Date.now();
              setClock(startExamClock(at, seconds, current?.id));
              setNow(at);
            }}
          >
            <KeatingGlyph name="play" size={13} />
            Start exam
          </button>
        </>}>
        <section className="lesson-section">
          <h4 data-glyph-host className="lesson-section-title"><KeatingGlyph name="info" size={13} />Before you start</h4>
          <ul className="lesson-rows exam-facts" data-glyph-host>
            <li><KeatingGlyph name="quiz" size={13} />{node.questions.length} questions</li>
            <li><KeatingGlyph name="clock" size={13} />{minutes}; the timer starts when you begin</li>
            <li><KeatingGlyph name="flag" size={13} />Flag a question and come back to it</li>
          </ul>
        </section>
      </LessonFrame>
    );

  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const countdown = `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, "0")}`;
  const urgent =
    remainingMs > 0 && remainingMs <= Math.min(seconds * 100, 60_000);
  const isFlagged = Boolean(current && flagged.includes(current.id));
  const footer = reviewing ? <>
      <button type="button" className="lesson-quiet" disabled={frozen} onClick={() => navigate(node.questions.length - 1)}>
        <KeatingGlyph name="left" size={13} />Back to questions
      </button>
      <button type="button" className="lesson-primary" data-glyph-surface="inverse" disabled={disabled} onClick={submit}>
        <KeatingGlyph name="send" size={13} />
        {pending ? "Retry save exam" : "Submit exam"}
      </button>
    </> : current ? <>
      <button type="button" className="lesson-quiet k-bloom" title="Back" disabled={frozen || index === 0} onClick={() => navigate(index - 1)}>
        <KeatingGlyph name="left" size={15} /><span className="lesson-sr">Back</span>
      </button>
      <button
        type="button"
        className="lesson-quiet exam-flag"
        aria-pressed={isFlagged}
        title={isFlagged ? "Flagged" : "Flag"}
        disabled={frozen}
        onClick={() =>
          setFlagged((value) =>
            value.includes(current.id)
              ? value.filter((id) => id !== current.id)
              : [...value, current.id],
          )
        }
      >
        <KeatingGlyph name="flag" size={13} active={isFlagged} />{isFlagged ? "Flagged" : "Flag"}
      </button>
      {index < node.questions.length - 1 ? (
        <button type="button" className="lesson-quiet" disabled={frozen} onClick={() => navigate("review")}>
          <KeatingGlyph name="eye" size={13} />Review all answers
        </button>
      ) : null}
      <button
        type="button"
        className="lesson-primary"
        data-glyph-surface="inverse"
        disabled={frozen}
        onClick={() => navigate(index === node.questions.length - 1 ? "review" : index + 1)}
      >
        <KeatingGlyph name="right" size={13} />
        {index === node.questions.length - 1 ? "Review exam" : "Next"}
      </button>
    </> : undefined;
  return (
    <LessonFrame glyph="quiz" title={node.title} kind="Exam" className="exam-frame"
      data-exam={node.id} data-exam-phase={reviewing ? "review" : "answering"}
      tools={<div
          className="exam-clock"
          role="timer"
          aria-live="off"
          aria-label="Exam time remaining"
          data-urgent={urgent || undefined}
        >
          <KeatingGlyph name={urgent ? "alert" : "clock"} size={13} />
          <strong>{countdown}</strong>
          <Countdown remaining={remainingSeconds} total={seconds} label="Exam countdown" />
        </div>}
      footer={footer}>
      <div className="lesson-round">
        <span className="lesson-progress" role="progressbar" aria-label="Answered questions" aria-valuemin={0} aria-valuemax={node.questions.length} aria-valuenow={answered} aria-valuetext={`${answered} of ${node.questions.length}`}>
          <i style={{ width: `${answered / Math.max(1, node.questions.length) * 100}%` }} />
        </span>
        <small>{reviewing ? `${answered} of ${node.questions.length} answered` : `${index + 1} of ${node.questions.length}`}</small>
      </div>
      <div className="exam-status">
        <button
          type="button"
          className="lesson-quiet exam-navigator-toggle"
          aria-expanded={navigatorOpen}
          aria-controls={navigatorId}
          aria-label={navigatorOpen ? "Hide question navigator" : "Show question navigator"}
          onClick={() => setNavigatorOpen((value) => !value)}
        >
          <KeatingGlyph name="hash" size={13} />
          Questions
          <KeatingGlyph name={navigatorOpen ? "chevu" : "chev"} size={13} />
        </button>
        {navigatorOpen ? <nav id={navigatorId} className="exam-navigator" aria-label="Exam questions">
          {node.questions.map((question, questionIndex) => (
            <button
              key={question.id}
              type="button"
              aria-label={`Question ${questionIndex + 1}${ready[question.id] ? ", answered" : ", unanswered"}${flagged.includes(question.id) ? ", flagged" : ""}`}
              aria-current={
                !reviewing && questionIndex === index ? "step" : undefined
              }
              data-answered={ready[question.id] || undefined}
              data-flagged={flagged.includes(question.id) || undefined}
              disabled={frozen}
              onClick={() => navigate(questionIndex)}
            >
              {questionIndex + 1}
            </button>
          ))}
        </nav> : null}
        <div className="exam-legend">
          <span className="lesson-status" data-tone="ok">{answered} answered</span>
          <span className="lesson-status" data-tone="warn">{flagged.length} flagged</span>
          {!reviewing ? <span className="lesson-status" data-tone="ink">current</span> : null}
          <span className="lesson-status" data-tone="none">{node.questions.length - answered} left</span>
        </div>
      </div>
      {reviewing ? (
        <section className="lesson-section exam-review">
          <h4 data-glyph-host className="lesson-section-title" ref={headingRef} tabIndex={-1}>
            <KeatingGlyph name={expired ? "clock" : "eye"} size={13} />
            {expired ? "Time is up" : "Ready to submit?"}
            <span className="lesson-meta">{answered} of {node.questions.length}</span>
          </h4>
          {expired ? (
            <p role="status">
              Your answers are locked. Review and submit when ready.
            </p>
          ) : answered < node.questions.length ? (
            <p>
              {node.questions.length - answered}{" "}
              {node.questions.length - answered === 1
                ? "answer is"
                : "answers are"}{" "}
              incomplete.
            </p>
          ) : null}
          <ol className="lesson-rows exam-review__rows">
            {node.questions.map((question, questionIndex) => {
              const status = ready[question.id]
                ? "Answered"
                : examResponseHasAnswer(responses[question.id])
                  ? "Incomplete"
                  : "Unanswered";
              return (
              <li key={question.id}>
                <button
                  type="button"
                  disabled={frozen}
                  onClick={() => navigate(questionIndex)}
                >
                  <span className="lesson-index">
                    {questionIndex + 1}
                  </span>
                  <span className="exam-review__question">
                    {question.header ?? question.prompt}
                  </span>
                  {flagged.includes(question.id) ? (
                    <KeatingGlyph name="flag" size={13} label="Flagged" className="exam-flagged" />
                  ) : null}
                  <span className="lesson-status" data-tone={status === "Answered" ? "ok" : status === "Incomplete" ? "warn" : "none"}>{status}</span>
                </button>
                {expired && answerText[question.id] ? (
                  <p className="exam-review__answer">
                    {readableAnswer(
                      node,
                      question.id,
                      answerText[question.id]!,
                    )}
                  </p>
                ) : null}
              </li>
              );
            })}
          </ol>
        </section>
      ) : current ? (
        <section className="exam-question">
          <h4 className="lesson-sr" ref={headingRef} tabIndex={-1}>
            Question {index + 1} of {node.questions.length}
          </h4>
          <Question
            key={current.id}
            node={current}
            disabled={frozen}
            groupResponse={responses[current.id]}
            hideSubmit
            onResponseChange={updateResponse}
          />
        </section>
      ) : null}
      {error ? (
        <p className="exam-error" role="alert">
          {error}
        </p>
      ) : null}
      {!localSaved ? (
        <p className="exam-error" role="status">
          Draft saving is unavailable. Keep this tab open until you submit.
        </p>
      ) : null}
    </LessonFrame>
  );
}

function readableAnswer(
  node: ExamNode,
  questionId: string,
  answer: string,
): string {
  const question = node.questions.find((item) => item.id === questionId);
  if (!question?.choices) return answer;
  return answer
    .split(",")
    .map(
      (id) => question.choices?.find((choice) => choice.id === id)?.label ?? id,
    )
    .join(", ");
}

function ExamResults({
  node,
  completion,
  focusOnMount,
}: {
  node: ExamNode;
  completion: ExamCompletion;
  focusOnMount: boolean;
}) {
  const resultHeadingRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!focusOnMount) return;
    resultHeadingRef.current?.focus({ preventScroll: true });
    resultHeadingRef.current?.scrollIntoView({ block: "start" });
  }, [focusOnMount]);
  const grades =
    useContext(QuizGradesContext).grades[completion.resultId] ?? [];
  const answers = Object.fromEntries(
    completion.answers.map((answer) => [answer.questionId, answer.answer]),
  );
  const summary = summarizeQuiz(
    node.questions,
    answers,
    completion.skippedQuestionIds,
    grades,
  );
  const partly = node.questions.filter(question => {
    const outcome = quizOutcome(question, answers[question.id], { skipped:completion.skippedQuestionIds.includes(question.id), grades });
    return outcome.kind === "graded" && outcome.verdict === "partial";
  }).length;
  return (
    <LessonFrame glyph="quiz" kind="Exam submitted" title={<span role="heading" aria-level={3} ref={resultHeadingRef} tabIndex={-1}>{node.title}</span>}
      tools={<span className="lesson-foot-meta"><KeatingGlyph name="check" size={13} />Submitted</span>} className="exam-frame" data-exam={node.id} data-exam-phase="completed"
      footer={<>
        <span className="lesson-foot-meta">{completion.answers.length} of {node.questions.length} answered</span>
        {completion.examTimedOut ? <span className="lesson-status" data-tone="warn">Time limit reached</span> : null}
      </>}>
      <div role="status" className="lesson-section">
        <LessonScore
          score={summary.decided ? `${formatPoints(summary.earned)} of ${summary.decided}` : "In review"}
          percent={summary.decided ? summary.percentage : undefined}
          time={formatQuizDuration(completion.timing.totalMs)}
          correct={summary.correct} partly={partly} missed={Math.max(0, summary.decided - summary.correct - partly)}
        />
        {summary.pending ? <small className="lesson-meta">{summary.pending} awaiting grading</small> : null}
      </div>
      <ol className="lesson-rows exam-results__questions">
        {node.questions.map((question, index) => {
          const outcome = quizOutcome(question, answers[question.id], {
            skipped: completion.skippedQuestionIds.includes(question.id),
            grades,
          });
          const verdict =
            outcome.kind === "objective"
              ? outcome.correct
                ? "Correct"
                : "Incorrect"
              : outcome.kind === "graded"
                ? outcome.verdict === "correct"
                  ? "Correct"
                  : outcome.verdict === "partial"
                    ? "Partial credit"
                    : "Incorrect"
                : outcome.kind === "pending"
                  ? "Awaiting grading"
                  : "Unanswered";
          const tone = verdict === "Correct" ? "ok" : verdict === "Partial credit" ? "warn" : verdict === "Incorrect" ? "bad" : verdict === "Unanswered" ? "none" : undefined;
          return (
            <li key={question.id} data-outcome={outcome.kind}>
              <details>
                <summary>
                  <span className="lesson-index">{index + 1}</span>
                  <span className="exam-results__question-title">
                    {question.header ?? question.prompt}
                    <span className="exam-results__meta">
                      <span className="lesson-status" data-tone={tone}>{verdict}</span>
                      {question.mathProblem && objectiveCredit(question, answers[question.id] ?? "") === undefined ? <small>Not independently checked</small> : null}
                    </span>
                  </span>
                  <time className="lesson-meta">
                    {completion.timing.perQuestionMs[question.id] !== undefined
                      ? formatQuizDuration(
                          completion.timing.perQuestionMs[question.id]!,
                        )
                      : "Not visited"}
                  </time>
                </summary>
                <div className="exam-results__detail">
                  <p>
                    <span className="lesson-label">Your answer</span>
                    {answers[question.id]
                      ? readableAnswer(node, question.id, answers[question.id]!)
                      : "Unanswered"}
                  </p>
                  {outcome.kind === "graded" && outcome.note ? (
                    <MarkdownBlock content={outcome.note} />
                  ) : null}
                  {question.explanation ? (
                    <MarkdownBlock content={question.explanation} />
                  ) : null}
                </div>
              </details>
            </li>
          );
        })}
      </ol>
    </LessonFrame>
  );
}

function formatPoints(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

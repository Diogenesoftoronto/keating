import { LessonFrame } from "./lesson/LessonFrame";
import { Countdown, Progress, StackBar, Stat } from "../design-system/charts";
import "./specialist-lessons.css";
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
    return <LessonFrame glyph="quiz" kind="Exam unavailable" title={props.node.title} className="exam-surface" data-exam={props.node.id}>
      <p className="exam-surface__error" role="alert">Exams require at least {MIN_EXAM_QUESTIONS} questions. This exam has {props.node.questions.length}.</p>
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
  if (!clock)
    return (
      <LessonFrame glyph="clock" kind="Exam" title={node.title} className="exam-surface exam-surface--start" data-exam={node.id}>
        <p className="exam-start__facts">
          {node.questions.length} questions <span aria-hidden="true">·</span>{" "}
          {seconds < 60
            ? `${seconds} seconds`
            : `${Number((seconds / 60).toFixed(1))} minutes`}
        </p>
        <p className="exam-start__description">
          Move between questions. Review before you submit.
        </p>
        <button
          type="button"
          className="exam-surface__primary k-lift"
          disabled={disabled || node.questions.length === 0}
          onClick={() => {
            const at = Date.now();
            setClock(startExamClock(at, seconds, current?.id));
            setNow(at);
          }}
        >
          Start exam
          <KeatingGlyph name="right" size={18} />
        </button>
      </LessonFrame>
    );

  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const countdown = `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, "0")}`;
  const urgent =
    remainingMs > 0 && remainingMs <= Math.min(seconds * 100, 60_000);
  return (
    <LessonFrame glyph="quiz" title={node.title} kind="Exam" className="exam-surface"
      data-exam={node.id} data-exam-phase={reviewing ? "review" : "answering"}
      tools={<div
          className="exam-clock"
          role="timer"
          aria-live="off"
          aria-label="Exam time remaining"
          data-urgent={urgent || undefined}
        >
          <KeatingGlyph name="clock" size={17} />
          <strong>{countdown}</strong>
        </div>}>
      <Countdown remaining={remainingSeconds} total={seconds} label="Exam countdown" />
      <Progress done={answered} total={node.questions.length} label="Answered questions" />
      <div className="exam-surface__progress">
        <button
          type="button"
          className="exam-navigator-toggle"
          aria-expanded={navigatorOpen}
          aria-controls={navigatorId}
          aria-label={navigatorOpen ? "Hide question navigator" : "Show question navigator"}
          onClick={() => setNavigatorOpen((value) => !value)}
        >
          Questions
          <KeatingGlyph name="chev" size={15} />
        </button>
        <span>
          <KeatingGlyph name="check" size={15} />{answered}/{node.questions.length} answered
        </span>
        <span><KeatingGlyph name="flag" size={15} />{flagged.length} flagged</span>
        <span><KeatingGlyph name="minus" size={15} />{node.questions.length - answered} unanswered</span>
        {!reviewing && <span><KeatingGlyph name="right" size={15} />Current {index + 1}</span>}
      </div>
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
            <span>{questionIndex + 1}</span>
            {!reviewing && questionIndex === index && <KeatingGlyph name="right" size={11} />}
            {flagged.includes(question.id) && <KeatingGlyph name="flag" size={11} />}
            <KeatingGlyph name={ready[question.id] ? "check" : "minus"} size={11} />
          </button>
        ))}
      </nav> : null}
      {reviewing ? (
        <div className="exam-review">
          <h4 ref={headingRef} tabIndex={-1}>
            {expired ? "Time is up" : "Ready to submit?"}
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
          <ol>
            {node.questions.map((question, questionIndex) => (
              <li key={question.id}>
                <button
                  type="button"
                  disabled={frozen}
                  onClick={() => navigate(questionIndex)}
                >
                  <span className="exam-review__number">
                    {questionIndex + 1}
                  </span>
                  <span className="exam-review__question">
                    {question.header ?? question.prompt}
                    <small>
                      {ready[question.id]
                        ? "Answered"
                        : examResponseHasAnswer(responses[question.id])
                          ? "Incomplete"
                          : "Unanswered"}
                    </small>
                  </span>
                  {flagged.includes(question.id) ? (
                    <KeatingGlyph name="flag" size={15} label="Flagged" />
                  ) : (
                    <KeatingGlyph name="right" size={15} />
                  )}
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
            ))}
          </ol>
          <button
            type="button"
            className="exam-surface__primary k-lift"
            disabled={disabled}
            onClick={submit}
          >
            {pending ? "Retry save exam" : "Submit exam"}
            <KeatingGlyph name="send" size={17} />
          </button>
        </div>
      ) : current ? (
        <div className="exam-question">
          <div className="exam-question__top">
            <h4 ref={headingRef} tabIndex={-1}>
              Question {index + 1} of {node.questions.length}
            </h4>

          </div>
          <Question
            key={current.id}
            node={current}
            disabled={frozen}
            groupResponse={responses[current.id]}
            hideSubmit
            onResponseChange={updateResponse}
          />
          <div className="exam-question__footer">
            <button
              type="button"
              className="exam-surface__quiet"
              disabled={frozen || index === 0}
              onClick={() => navigate(index - 1)}
            >
              <KeatingGlyph name="left" size={17} />
              Back
            </button>
            <button
              type="button"
              className="exam-surface__quiet"
              aria-pressed={flagged.includes(current.id)}
              disabled={frozen}
              onClick={() =>
                setFlagged((value) =>
                  value.includes(current.id)
                    ? value.filter((id) => id !== current.id)
                    : [...value, current.id],
                )
              }
            >
              <KeatingGlyph name="flag" size={17} />
              {flagged.includes(current.id) ? "Flagged" : "Flag"}
            </button>
            {index < node.questions.length - 1 ? (
            <button
              type="button"
              className="exam-surface__review-link"
              disabled={frozen}
              onClick={() => navigate("review")}
            >
              Review all answers
            </button>
          ) : null}
            <button
              type="button"
              className="exam-surface__primary k-lift"
              disabled={frozen}
              onClick={() =>
                navigate(
                  index === node.questions.length - 1 ? "review" : index + 1,
                )
              }
            >
              {index === node.questions.length - 1 ? "Review exam" : "Next"}
              <KeatingGlyph name="right" size={17} />
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p className="exam-surface__error" role="alert">
          {error}
        </p>
      ) : null}
      {!localSaved ? (
        <p className="exam-surface__error" role="status">
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
      tools={<KeatingGlyph name="check" size={16} />} className="exam-surface exam-results" data-exam={node.id} data-exam-phase="completed">
      <div className="specialist-stats" role="status">
        <Stat label="Score" value={summary.decided ? `${summary.earned}/${summary.decided}` : "In review"} support={summary.pending ? `${summary.pending} awaiting grading` : "points"} />
        <Stat label="Time" value={formatQuizDuration(completion.timing.totalMs)} support={completion.examTimedOut ? "Time limit reached" : "total"} />
      </div>
      <StackBar label="Graded and skipped answers" data={[
        {label:"Correct",value:summary.correct,tone:"ok"}, {label:"Partly",value:partly,tone:"warn",pattern:true},
        {label:"Missed or skipped",value:summary.decided-summary.correct-partly,tone:"bad"}
      ]} />
      <ol className="exam-results__questions">
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
          return (
            <li key={question.id} data-outcome={outcome.kind}>
              <details>
                <summary>
                  <span>{index + 1}</span>
                  <span className="exam-results__question-title">
                    {question.header ?? question.prompt}
                    <small>{verdict}</small>
                    {question.mathProblem && objectiveCredit(question, answers[question.id] ?? "") === undefined ? <small>Not independently checked</small> : null}
                  </span>
                  <time>
                    {completion.timing.perQuestionMs[question.id] !== undefined
                      ? formatQuizDuration(
                          completion.timing.perQuestionMs[question.id]!,
                        )
                      : "Not visited"}
                  </time>
                </summary>
                <div className="exam-results__detail">
                  <p>
                    <strong>Your answer</strong>{" "}
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

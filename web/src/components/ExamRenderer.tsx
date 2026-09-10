import { useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Clock3, Flag, Send } from "lucide-react";
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
    return <section className="exam-surface" data-exam={props.node.id}>
      <p className="exam-surface__kind">Exam unavailable</p>
      <h3>{props.node.title}</h3>
      <p className="exam-surface__error" role="alert">Exams require at least {MIN_EXAM_QUESTIONS} questions. This exam has {props.node.questions.length}.</p>
    </section>;
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
      <section className="exam-surface exam-surface--start" data-exam={node.id}>
        <div className="exam-start__mark" aria-hidden="true">
          <Clock3 size={28} />
        </div>
        <p className="exam-surface__kind">Exam</p>
        <h3>{node.title}</h3>
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
          className="exam-surface__primary"
          disabled={disabled || node.questions.length === 0}
          onClick={() => {
            const at = Date.now();
            setClock(startExamClock(at, seconds, current?.id));
            setNow(at);
          }}
        >
          Start exam
          <ArrowRight size={18} />
        </button>
      </section>
    );

  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const countdown = `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, "0")}`;
  const urgent =
    remainingMs > 0 && remainingMs <= Math.min(seconds * 100, 60_000);
  return (
    <section
      className="exam-surface"
      data-exam={node.id}
      data-exam-phase={reviewing ? "review" : "answering"}
    >
      <header className="exam-surface__header">
        <div>
          <p className="exam-surface__kind">Exam</p>
          <h3>{node.title}</h3>
        </div>
        <div
          className="exam-clock"
          role="timer"
          aria-live="off"
          aria-label="Exam time remaining"
          data-urgent={urgent || undefined}
        >
          <Clock3 size={17} />
          <strong>{countdown}</strong>
        </div>
      </header>
      <div className="exam-clock__track" aria-hidden="true">
        <span
          style={{
            transform: `scaleX(${Math.max(0, remainingMs / (seconds * 1000))})`,
          }}
        />
      </div>
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
          <ChevronDown size={15} aria-hidden="true" />
        </button>
        <span>
          {answered}/{node.questions.length} answered
        </span>
        {flagged.length ? (
          <span>
            <Flag size={13} />
            {flagged.length} flagged
          </span>
        ) : null}
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
            {flagged.includes(question.id) ? (
              <Flag size={10} />
            ) : ready[question.id] ? (
              <Check size={11} />
            ) : null}
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
                    <Flag size={15} aria-label="Flagged" />
                  ) : (
                    <ArrowRight size={15} aria-hidden="true" />
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
            className="exam-surface__primary"
            disabled={disabled}
            onClick={submit}
          >
            {pending ? "Retry save exam" : "Submit exam"}
            <Send size={17} />
          </button>
        </div>
      ) : current ? (
        <div className="exam-question">
          <div className="exam-question__top">
            <h4 ref={headingRef} tabIndex={-1}>
              Question {index + 1} of {node.questions.length}
            </h4>
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
              <Flag size={15} />
              {flagged.includes(current.id) ? "Flagged" : "Flag"}
            </button>
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
              <ArrowLeft size={17} />
              Back
            </button>
            <button
              type="button"
              className="exam-surface__primary"
              disabled={frozen}
              onClick={() =>
                navigate(
                  index === node.questions.length - 1 ? "review" : index + 1,
                )
              }
            >
              {index === node.questions.length - 1 ? "Review exam" : "Next"}
              <ArrowRight size={17} />
            </button>
          </div>
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
    </section>
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
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
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
  return (
    <section
      className="exam-surface exam-results"
      data-exam={node.id}
      data-exam-phase="completed"
    >
      <header className="exam-surface__header">
        <div>
          <p className="exam-surface__kind">Exam submitted</p>
          <h3 ref={resultHeadingRef} tabIndex={-1}>{node.title}</h3>
        </div>
        <Check size={24} aria-hidden="true" />
      </header>
      <div className="exam-results__score" role="status">
        <strong>
          {summary.decided
            ? `${summary.earned}/${summary.decided}`
            : "In review"}
        </strong>
        <span>
          {summary.pending ? `${summary.pending} awaiting grading` : "points"}
        </span>
      </div>
      <p className="exam-results__duration">
        <Clock3 size={15} />
        {formatQuizDuration(completion.timing.totalMs)} total
        {completion.examTimedOut ? <span>Time limit reached</span> : null}
      </p>
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
    </section>
  );
}

import { useEffect, useState } from "react";
import {
  BookUp,
  FileQuestion,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { css, cx } from "../../../styled-system/css";
import {
  createBlankCourseQuiz,
  newCourseQuizQuestion,
  parseCourseQuiz,
} from "../../courses/course-artifacts";
import {
  loadCourseArtifactSources,
  type CourseArtifactSource,
} from "../../courses/course-assembly";
import {
  newCourseOperationId,
  type applyCourseOperation,
} from "../../courses/client";
import type {
  CourseArtifact,
  CourseAssignment,
  CourseOperation,
  CourseViewerSnapshot,
} from "../../courses/contracts";
import type { Quiz, QuizQuestion } from "../../keating/core";

const inputClass = css({
  w: "100%",
  border: "1px solid var(--ink)",
  bg: "var(--paper)",
  px: "0.65rem",
  py: "0.55rem",
  fontSize: "0.8rem",
  outline: 0,
  _focus: { boxShadow: "0 0 0 2px var(--peer-blue, #3468b3)" },
});
const buttonClass = css({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.35rem",
  border: "1px solid var(--ink)",
  px: "0.65rem",
  py: "0.45rem",
  fontSize: "0.72rem",
  fontWeight: 750,
  _hover: { bg: "var(--course-wash, #ddebdd)" },
  _disabled: { opacity: 0.55 },
});
const cardClass = css({ border: "1px solid var(--ink)", bg: "var(--card)" });

type Mutate = (
  operation: Parameters<typeof applyCourseOperation>[0],
  label: string,
) => Promise<void>;

function operationBase(
  snapshot: CourseViewerSnapshot,
): Pick<CourseOperation, "id" | "courseId" | "baseRevision"> {
  return {
    id: newCourseOperationId(),
    courseId: snapshot.course.id,
    baseRevision: snapshot.course.revision,
  };
}

function targetSelect(
  lessons: ReturnType<typeof courseLessons>,
  value: string,
  onChange: (value: string) => void,
  label: string,
) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={inputClass}
      aria-label={label}
    >
      <option value="">Course-wide</option>
      {lessons.map((lesson) => (
        <option key={lesson.id} value={lesson.id}>
          {lesson.title}
        </option>
      ))}
    </select>
  );
}

function courseLessons(snapshot: CourseViewerSnapshot) {
  return snapshot.course.modules.flatMap((module) => module.lessons);
}

function replaceQuestion(
  quiz: Quiz,
  index: number,
  question: QuizQuestion,
): Quiz {
  return {
    ...quiz,
    totalPoints: quiz.questions.length,
    questions: quiz.questions.map((current, questionIndex) =>
      questionIndex === index ? question : current,
    ),
  };
}

function QuizQuestionFields({
  question,
  index,
  onChange,
  onRemove,
  canRemove,
}: {
  question: QuizQuestion;
  index: number;
  onChange(question: QuizQuestion): void;
  onRemove(): void;
  canRemove: boolean;
}) {
  const options = question.options?.join("\n") ?? "";
  return (
    <div
      className={css({
        display: "grid",
        gap: "0.4rem",
        border: "1px solid var(--ink)",
        bg: "var(--paper)",
        p: "0.6rem",
      })}
    >
      <div
        className={css({
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
        })}
      >
        <strong className={css({ fontSize: "0.72rem" })}>
          Question {index + 1}
        </strong>
        <button
          type="button"
          className={cx(buttonClass, css({ color: "var(--destructive)" }))}
          disabled={!canRemove}
          onClick={onRemove}
        >
          <Trash2 size={11} /> Remove
        </button>
      </div>
      <select
        value={question.type}
        className={inputClass}
        onChange={(event) => {
          const type = event.target.value as QuizQuestion["type"];
          onChange({
            ...question,
            type,
            ...(type === "multiple_choice" ||
            type === "multi_select" ||
            type === "dropdown"
              ? {
                  options: question.options?.length
                    ? question.options
                    : ["Option A", "Option B"],
                }
              : { options: undefined }),
          });
        }}
      >
        <option value="short_answer">Short answer</option>
        <option value="transfer">Transfer</option>
        <option value="multiple_choice">Multiple choice</option>
        <option value="multi_select">Multiple select</option>
        <option value="true_false">True / false</option>
        <option value="fill_in">Fill in</option>
        <option value="dropdown">Dropdown</option>
        <option value="slider">Slider</option>
      </select>
      <textarea
        value={question.question}
        onChange={(event) =>
          onChange({ ...question, question: event.target.value })
        }
        className={inputClass}
        rows={3}
        placeholder="Question prompt"
      />
      {question.type === "multiple_choice" ||
      question.type === "multi_select" ||
      question.type === "dropdown" ? (
        <textarea
          value={options}
          onChange={(event) =>
            onChange({
              ...question,
              options: event.target.value
                .split("\n")
                .map((value) => value.trim())
                .filter(Boolean),
            })
          }
          className={inputClass}
          rows={3}
          placeholder="One option per line"
        />
      ) : null}
      <textarea
        value={question.correctAnswer}
        onChange={(event) =>
          onChange({ ...question, correctAnswer: event.target.value })
        }
        className={inputClass}
        rows={2}
        placeholder="Expected answer"
      />
      <textarea
        value={question.explanation}
        onChange={(event) =>
          onChange({ ...question, explanation: event.target.value })
        }
        className={inputClass}
        rows={2}
        placeholder="Explanation shown after answering"
      />
    </div>
  );
}

function ArtifactEditor({
  snapshot,
  artifact,
  saving,
  mutate,
}: {
  snapshot: CourseViewerSnapshot;
  artifact: CourseArtifact;
  saving: string;
  mutate: Mutate;
}) {
  const lessons = courseLessons(snapshot);
  const [title, setTitle] = useState(artifact.title);
  const [description, setDescription] = useState(artifact.description ?? "");
  const [lessonId, setLessonId] = useState(artifact.lessonId ?? "");
  const [content, setContent] = useState(artifact.content);
  const [quiz, setQuiz] = useState<Quiz | null>(() =>
    artifact.format === "quiz" ? parseCourseQuiz(artifact.content) : null,
  );
  useEffect(() => {
    setTitle(artifact.title);
    setDescription(artifact.description ?? "");
    setLessonId(artifact.lessonId ?? "");
    setContent(artifact.content);
    setQuiz(
      artifact.format === "quiz" ? parseCourseQuiz(artifact.content) : null,
    );
  }, [artifact]);
  const save = () =>
    mutate(
      {
        ...operationBase(snapshot),
        type: "artifact.upsert",
        artifact: {
          id: artifact.id,
          kind: artifact.kind,
          format: artifact.format,
          title: title.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
          content: quiz
            ? JSON.stringify({
                ...quiz,
                topic: title.trim(),
                totalPoints: quiz.questions.length,
              })
            : content,
          ...(lessonId ? { lessonId } : {}),
          ...(artifact.sourceId ? { sourceId: artifact.sourceId } : {}),
          ...(artifact.sourceSessionId
            ? { sourceSessionId: artifact.sourceSessionId }
            : {}),
        },
      },
      `artifact-${artifact.id}`,
    );
  return (
    <details className={cardClass}>
      <summary
        className={css({
          cursor: "pointer",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          px: "0.65rem",
          py: "0.55rem",
          fontSize: "0.74rem",
          fontWeight: 750,
        })}
      >
        {artifact.title}{" "}
        <span className={css({ color: "var(--ink-soft)", fontWeight: 400 })}>
          · {artifact.kind.replaceAll("-", " ")}
        </span>
      </summary>
      <div
        className={css({
          display: "grid",
          gap: "0.45rem",
          borderTop: "1px solid var(--ink)",
          p: "0.65rem",
        })}
      >
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={240}
          className={inputClass}
          placeholder="Artifact title"
        />
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={2_000}
          className={inputClass}
          rows={2}
          placeholder="Short description"
        />
        {targetSelect(
          lessons,
          lessonId,
          setLessonId,
          `Attach ${artifact.title} to lesson`,
        )}
        {quiz ? (
          <div className={css({ display: "grid", gap: "0.45rem" })}>
            {quiz.questions.map((question, index) => (
              <QuizQuestionFields
                key={question.id}
                question={question}
                index={index}
                canRemove={quiz.questions.length > 1}
                onChange={(next) =>
                  setQuiz((current) =>
                    current ? replaceQuestion(current, index, next) : current,
                  )
                }
                onRemove={() =>
                  setQuiz((current) =>
                    current
                      ? {
                          ...current,
                          questions: current.questions.filter(
                            (_, questionIndex) => questionIndex !== index,
                          ),
                          totalPoints: current.questions.length - 1,
                        }
                      : current,
                  )
                }
              />
            ))}
            <button
              type="button"
              className={buttonClass}
              disabled={quiz.questions.length >= 20}
              onClick={() =>
                setQuiz((current) =>
                  current
                    ? {
                        ...current,
                        questions: [
                          ...current.questions,
                          newCourseQuizQuestion(current.questions.length),
                        ],
                        totalPoints: current.questions.length + 1,
                      }
                    : current,
                )
              }
            >
              <Plus size={12} /> Add question
            </button>
          </div>
        ) : (
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            className={inputClass}
            rows={
              artifact.format === "openui" || artifact.format === "json" ? 9 : 6
            }
            aria-label={`${artifact.title} source`}
          />
        )}
        <div
          className={css({
            display: "flex",
            justifyContent: "space-between",
            gap: "0.4rem",
          })}
        >
          <button
            type="button"
            className={buttonClass}
            disabled={!title.trim() || saving === `artifact-${artifact.id}`}
            onClick={() => void save()}
          >
            <Save size={12} /> Save
          </button>
          <button
            type="button"
            className={cx(buttonClass, css({ color: "var(--destructive)" }))}
            onClick={() => {
              if (
                window.confirm(`Remove “${artifact.title}” from this course?`)
              )
                void mutate(
                  {
                    ...operationBase(snapshot),
                    type: "artifact.delete",
                    artifactId: artifact.id,
                  },
                  `artifact-delete-${artifact.id}`,
                );
            }}
          >
            <Trash2 size={12} /> Remove
          </button>
        </div>
      </div>
    </details>
  );
}

export function ArtifactManager({
  snapshot,
  activeLessonId,
  saving,
  mutate,
}: {
  snapshot: CourseViewerSnapshot;
  activeLessonId?: string;
  saving: string;
  mutate: Mutate;
}) {
  const [sources, setSources] = useState<CourseArtifactSource[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [lessonId, setLessonId] = useState(activeLessonId ?? "");
  const [quizTitle, setQuizTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const lessons = courseLessons(snapshot);
  const load = () => {
    setLoading(true);
    setError("");
    void loadCourseArtifactSources()
      .then(setSources)
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Saved artifacts could not be loaded.",
        ),
      )
      .finally(() => setLoading(false));
  };
  useEffect(load, []);
  useEffect(() => {
    if (activeLessonId) setLessonId(activeLessonId);
  }, [activeLessonId]);
  const importSource = () => {
    const source = sources.find((candidate) => candidate.id === sourceId);
    if (!source) return;
    if (source.content.length > 8_000_000) {
      setError(
        `“${source.title}” is too large for an inline artifact. Add it through Documents, images, and sources instead.`,
      );
      return;
    }
    void mutate(
      {
        ...operationBase(snapshot),
        type: "artifact.upsert",
        artifact: {
          id: `artifact_${crypto.randomUUID().replaceAll("-", "")}`,
          kind: source.kind,
          format: source.format,
          title: source.title,
          ...(source.description ? { description: source.description } : {}),
          content: source.content,
          ...(lessonId ? { lessonId } : {}),
          ...(source.sourceId ? { sourceId: source.sourceId } : {}),
          ...(source.sourceSessionId
            ? { sourceSessionId: source.sourceSessionId }
            : {}),
        },
      },
      `artifact-import-${source.id}`,
    ).then(() => setSourceId(""));
  };
  const addQuiz = () => {
    if (!quizTitle.trim()) return;
    const quiz = createBlankCourseQuiz(quizTitle);
    void mutate(
      {
        ...operationBase(snapshot),
        type: "artifact.upsert",
        artifact: {
          id: `artifact_${crypto.randomUUID().replaceAll("-", "")}`,
          kind: "quiz",
          format: "quiz",
          title: quizTitle.trim(),
          content: JSON.stringify(quiz),
          ...(lessonId ? { lessonId } : {}),
        },
      },
      "quiz-add",
    ).then(() => setQuizTitle(""));
  };
  return (
    <div className={css({ display: "grid", gap: "0.55rem" })}>
      <div
        className={css({
          display: "grid",
          gap: "0.4rem",
          border: "1px solid var(--ink)",
          bg: "var(--paper)",
          p: "0.6rem",
        })}
      >
        {targetSelect(
          lessons,
          lessonId,
          setLessonId,
          "Attach imported artifact to lesson",
        )}
        {loading ? (
          <p className={css({ fontSize: "0.72rem", color: "var(--ink-soft)" })}>
            Looking through saved work…
          </p>
        ) : (
          <>
            <select
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value)}
              className={inputClass}
            >
              <option value="">Choose a saved artifact…</option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.title} · {source.kind.replaceAll("-", " ")}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={buttonClass}
              disabled={!sourceId || saving.startsWith("artifact-import-")}
              onClick={importSource}
            >
              <Upload size={12} /> Import artifact
            </button>
          </>
        )}
        {error ? (
          <div
            role="alert"
            className={css({
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.5rem",
              color: "var(--destructive)",
              fontSize: "0.72rem",
            })}
          >
            <span>{error}</span>
            <button type="button" className={buttonClass} onClick={load}>
              <RefreshCw size={11} /> Retry
            </button>
          </div>
        ) : null}
      </div>
      <div
        className={css({
          display: "flex",
          alignItems: "stretch",
          gap: "0.35rem",
          border: "1px solid var(--ink)",
          bg: "var(--paper)",
          p: "0.6rem",
        })}
      >
        <input
          value={quizTitle}
          onChange={(event) => setQuizTitle(event.target.value)}
          className={inputClass}
          placeholder="New quiz title"
        />
        <button
          type="button"
          className={buttonClass}
          disabled={!quizTitle.trim() || saving === "quiz-add"}
          onClick={addQuiz}
        >
          <FileQuestion size={12} /> Quiz
        </button>
      </div>
      {snapshot.course.artifacts.length ? (
        <div className={css({ display: "grid", gap: "0.4rem" })}>
          {snapshot.course.artifacts.map((artifact) => (
            <ArtifactEditor
              key={artifact.id}
              snapshot={snapshot}
              artifact={artifact}
              saving={saving}
              mutate={mutate}
            />
          ))}
        </div>
      ) : (
        <p className={css({ fontSize: "0.7rem", color: "var(--ink-soft)" })}>
          No artifacts in this course yet.
        </p>
      )}
    </div>
  );
}

function AssignmentEditor({
  snapshot,
  assignment,
  saving,
  mutate,
}: {
  snapshot: CourseViewerSnapshot;
  assignment: CourseAssignment;
  saving: string;
  mutate: Mutate;
}) {
  const lessons = courseLessons(snapshot);
  const [title, setTitle] = useState(assignment.title);
  const [brief, setBrief] = useState(assignment.brief);
  const [deliverables, setDeliverables] = useState(
    assignment.deliverables.join("\n"),
  );
  const [rubric, setRubric] = useState(assignment.rubric.join("\n"));
  const [lessonId, setLessonId] = useState(assignment.lessonId ?? "");
  const [dueAt, setDueAt] = useState(
    assignment.dueAt ? assignment.dueAt.slice(0, 16) : "",
  );
  const [hours, setHours] = useState(
    assignment.estimatedHours?.toString() ?? "",
  );
  useEffect(() => {
    setTitle(assignment.title);
    setBrief(assignment.brief);
    setDeliverables(assignment.deliverables.join("\n"));
    setRubric(assignment.rubric.join("\n"));
    setLessonId(assignment.lessonId ?? "");
    setDueAt(assignment.dueAt ? assignment.dueAt.slice(0, 16) : "");
    setHours(assignment.estimatedHours?.toString() ?? "");
  }, [assignment]);
  return (
    <details className={cardClass}>
      <summary
        className={css({
          cursor: "pointer",
          px: "0.65rem",
          py: "0.55rem",
          fontSize: "0.74rem",
          fontWeight: 750,
        })}
      >
        {assignment.title}
      </summary>
      <div
        className={css({
          display: "grid",
          gap: "0.4rem",
          borderTop: "1px solid var(--ink)",
          p: "0.65rem",
        })}
      >
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className={inputClass}
        />
        <textarea
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          className={inputClass}
          rows={5}
          placeholder="Assignment brief"
        />
        <textarea
          value={deliverables}
          onChange={(event) => setDeliverables(event.target.value)}
          className={inputClass}
          rows={3}
          placeholder="One deliverable per line"
        />
        <textarea
          value={rubric}
          onChange={(event) => setRubric(event.target.value)}
          className={inputClass}
          rows={3}
          placeholder="One rubric point per line"
        />
        {targetSelect(
          lessons,
          lessonId,
          setLessonId,
          `Attach ${assignment.title} to lesson`,
        )}
        <div
          className={css({
            display: "grid",
            gap: "0.4rem",
            sm: { gridTemplateColumns: "1fr 1fr" },
          })}
        >
          <label className={css({ fontSize: "0.68rem" })}>
            Due date
            <input
              type="datetime-local"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
              className={inputClass}
            />
          </label>
          <label className={css({ fontSize: "0.68rem" })}>
            Estimated hours
            <input
              type="number"
              min="0.25"
              step="0.25"
              value={hours}
              onChange={(event) => setHours(event.target.value)}
              className={inputClass}
            />
          </label>
        </div>
        <div
          className={css({
            display: "flex",
            justifyContent: "space-between",
            gap: "0.4rem",
          })}
        >
          <button
            type="button"
            className={buttonClass}
            disabled={
              !title.trim() ||
              !brief.trim() ||
              saving === `assignment-${assignment.id}`
            }
            onClick={() =>
              void mutate(
                {
                  ...operationBase(snapshot),
                  type: "assignment.upsert",
                  assignment: {
                    id: assignment.id,
                    title: title.trim(),
                    brief: brief.trim(),
                    deliverables: deliverables
                      .split("\n")
                      .map((value) => value.trim())
                      .filter(Boolean),
                    rubric: rubric
                      .split("\n")
                      .map((value) => value.trim())
                      .filter(Boolean),
                    ...(lessonId ? { lessonId } : {}),
                    ...(dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}),
                    ...(Number(hours) > 0
                      ? { estimatedHours: Number(hours) }
                      : {}),
                  },
                },
                `assignment-${assignment.id}`,
              )
            }
          >
            <Save size={12} /> Save
          </button>
          <button
            type="button"
            className={cx(buttonClass, css({ color: "var(--destructive)" }))}
            onClick={() => {
              if (
                window.confirm(
                  `Remove “${assignment.title}” and its submissions?`,
                )
              )
                void mutate(
                  {
                    ...operationBase(snapshot),
                    type: "assignment.delete",
                    assignmentId: assignment.id,
                  },
                  `assignment-delete-${assignment.id}`,
                );
            }}
          >
            <Trash2 size={12} /> Remove
          </button>
        </div>
      </div>
    </details>
  );
}

export function AssignmentManager({
  snapshot,
  activeLessonId,
  saving,
  mutate,
}: {
  snapshot: CourseViewerSnapshot;
  activeLessonId?: string;
  saving: string;
  mutate: Mutate;
}) {
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [lessonId, setLessonId] = useState(activeLessonId ?? "");
  const lessons = courseLessons(snapshot);
  useEffect(() => {
    if (activeLessonId) setLessonId(activeLessonId);
  }, [activeLessonId]);
  const add = () => {
    if (!title.trim() || !brief.trim()) return;
    void mutate(
      {
        ...operationBase(snapshot),
        type: "assignment.upsert",
        assignment: {
          id: `assignment_${crypto.randomUUID().replaceAll("-", "")}`,
          title: title.trim(),
          brief: brief.trim(),
          deliverables: [],
          rubric: [],
          ...(lessonId ? { lessonId } : {}),
        },
      },
      "assignment-add",
    ).then(() => {
      setTitle("");
      setBrief("");
    });
  };
  return (
    <div className={css({ display: "grid", gap: "0.55rem" })}>
      <div
        className={css({
          display: "grid",
          gap: "0.4rem",
          border: "1px solid var(--ink)",
          bg: "var(--paper)",
          p: "0.6rem",
        })}
      >
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className={inputClass}
          placeholder="Assignment title"
        />
        <textarea
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          className={inputClass}
          rows={3}
          placeholder="What should the learner make, investigate, or submit over time?"
        />
        {targetSelect(
          lessons,
          lessonId,
          setLessonId,
          "Attach assignment to lesson",
        )}
        <button
          type="button"
          className={buttonClass}
          disabled={
            !title.trim() || !brief.trim() || saving === "assignment-add"
          }
          onClick={add}
        >
          <BookUp size={12} /> Add assignment
        </button>
      </div>
      {snapshot.course.assignments.length ? (
        <div className={css({ display: "grid", gap: "0.4rem" })}>
          {snapshot.course.assignments.map((assignment) => (
            <AssignmentEditor
              key={assignment.id}
              snapshot={snapshot}
              assignment={assignment}
              saving={saving}
              mutate={mutate}
            />
          ))}
        </div>
      ) : (
        <p className={css({ fontSize: "0.7rem", color: "var(--ink-soft)" })}>
          No long-range assignments yet.
        </p>
      )}
    </div>
  );
}

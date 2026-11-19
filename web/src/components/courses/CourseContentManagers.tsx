import { KeatingGlyph } from "../../design-system/glyphs";
import { Button, Card, EmptyState, Loading, ConfirmDialog, Field, TextArea, TextInput } from "../../design-system/kit";
import { Select } from "../Select";
import { useEffect, useState } from "react";
import { css } from "../../../styled-system/css";
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
    <Select
      value={value}
      onValueChange={(value) => onChange(value)}
      className="k-input"
      aria-label={label}
    >
      <option value="">Course-wide</option>
      {lessons.map((lesson) => (
        <option key={lesson.id} value={lesson.id}>
          {lesson.title}
        </option>
      ))}
    </Select>
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
        borderTop: "1px solid var(--line-soft)",
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
        <Button
          type="button"
          className="cb-danger"
          disabled={!canRemove}
          onClick={onRemove}
        >
          <KeatingGlyph name="trash" size={11} /> Remove
        </Button>
      </div>
      <Select
        aria-label="Question type"
        value={question.type}
        className="k-input"
        onValueChange={(value) => {
          const type = value as QuizQuestion["type"];
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
      </Select>
      <Field label="Question prompt"><TextArea
        value={question.question}
        onChange={(event) =>
          onChange({ ...question, question: event.target.value })
        }
        rows={3}
        placeholder="Question prompt"
      /></Field>
      {question.type === "multiple_choice" ||
      question.type === "multi_select" ||
      question.type === "dropdown" ? (
        <Field label="One option per line"><TextArea
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
          rows={3}
          placeholder="One option per line"
        /></Field>
      ) : null}
      <Field label="Expected answer"><TextArea
        value={question.correctAnswer}
        onChange={(event) =>
          onChange({ ...question, correctAnswer: event.target.value })
        }
        rows={2}
        placeholder="Expected answer"
      /></Field>
      <Field label="Explanation shown after answering"><TextArea
        value={question.explanation}
        onChange={(event) =>
          onChange({ ...question, explanation: event.target.value })
        }
        rows={2}
        placeholder="Explanation shown after answering"
      /></Field>
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
  const [removing, setRemoving] = useState(false);
  return (
    <Card as="details">
      <summary
        className={css({
          cursor: "pointer",
          overflowWrap: "anywhere",
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
          borderTop: "1px solid var(--line-soft)",
          p: "0.65rem",
        })}
      >
        <Field label="Artifact title"><TextInput
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={240}
          placeholder="Artifact title"
        /></Field>
        <Field label="Short description"><TextArea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={2_000}
          rows={2}
          placeholder="Short description"
        /></Field>
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
            <Button
              type="button"
              variant="line"
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
              <KeatingGlyph name="plus" size={12} /> Add question
            </Button>
          </div>
        ) : (
          <TextArea
            value={content}
            onChange={(event) => setContent(event.target.value)}
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
          <Button
            type="button"
            variant="line"
            disabled={!title.trim() || saving === `artifact-${artifact.id}`}
            onClick={() => void save()}
          >
            <KeatingGlyph name="save" size={12} /> Save
          </Button>
          <Button
            type="button"
            className="cb-danger"
            onClick={() => setRemoving(true)}>
            <KeatingGlyph name="trash" size={12}/> Remove
          </Button>
          <ConfirmDialog open={removing} title="Confirm removal" description={`Remove “${artifact.title}” from this course?`} confirmLabel="Remove"
            onCancel={() => setRemoving(false)}
            onConfirm={() => {
              setRemoving(false);
              void mutate({
                ...operationBase(snapshot),
                type: "artifact.delete",
                artifactId: artifact.id,
              }, `artifact-delete-${artifact.id}`);
            }}/>
        </div>
      </div>
    </Card>
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
          borderTop: "1px solid var(--line-soft)",
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
          <Loading label="Looking through saved work…" />
        ) : (
          <>
            <Select
              value={sourceId}
              onValueChange={(value) => setSourceId(value)}
              className="k-input"
            >
              <option value="">Choose a saved artifact…</option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.title} · {source.kind.replaceAll("-", " ")}
                </option>
              ))}
            </Select>
            <Button
              type="button"
              variant="line"
              disabled={!sourceId || saving.startsWith("artifact-import-")}
              onClick={importSource}
            >
              <KeatingGlyph name="import" size={12} /> Import artifact
            </Button>
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
            <Button type="button" variant="line" onClick={load}>
              <KeatingGlyph name="refresh" size={11} /> Retry
            </Button>
          </div>
        ) : null}
      </div>
      <div
        className={css({
          display: "flex",
          alignItems: "stretch",
          gap: "0.35rem",
          borderTop: "1px solid var(--line-soft)",
          bg: "var(--paper)",
          p: "0.6rem",
        })}
      >
        <Field label="New quiz title"><TextInput
          value={quizTitle}
          onChange={(event) => setQuizTitle(event.target.value)}
          placeholder="New quiz title"
        /></Field>
        <Button
          type="button"
          variant="line"
          disabled={!quizTitle.trim() || saving === "quiz-add"}
          onClick={addQuiz}
        >
          <KeatingGlyph name="quiz" size={12} /> Quiz
        </Button>
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
        <EmptyState heading="No artifacts in this course yet." />
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
  const [availableFrom, setAvailableFrom] = useState(assignment.availableFrom?.slice(0, 16) ?? "");
  const [taskKind, setTaskKind] = useState(assignment.taskKind ?? "assignment");
  const [taskItems, setTaskItems] = useState(assignment.taskItems ?? []);
  const [hours, setHours] = useState(
    assignment.estimatedHours?.toString() ?? "",
  );
  useEffect(() => {
    setTitle(assignment.title);
    setAvailableFrom(assignment.availableFrom?.slice(0, 16) ?? "");
    setTaskKind(assignment.taskKind ?? "assignment");
    setTaskItems(assignment.taskItems ?? []);
    setBrief(assignment.brief);
    setDeliverables(assignment.deliverables.join("\n"));
    setRubric(assignment.rubric.join("\n"));
    setLessonId(assignment.lessonId ?? "");
    setDueAt(assignment.dueAt ? assignment.dueAt.slice(0, 16) : "");
    setHours(assignment.estimatedHours?.toString() ?? "");
  }, [assignment]);
  const [removing, setRemoving] = useState(false);
  return (
    <Card as="details">
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
          borderTop: "1px solid var(--line-soft)",
          p: "0.65rem",
        })}
      >
        <TextInput
          aria-label="Assignment title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <label>Work type<Select value={taskKind} onValueChange={(value) => setTaskKind(value as typeof taskKind)} className="k-input">
          <option value="assignment">Assignment</option><option value="practice">Practice</option><option value="draft">Draft</option><option value="fieldwork">Fieldwork</option>
        </Select></label>
        <label>Available from<TextInput type="datetime-local" value={availableFrom} onChange={(event) => setAvailableFrom(event.target.value)} /></label>
        {taskItems.map((item, index) => <div key={item.id}>
          <TextInput aria-label={`Step ${index + 1}`} value={item.title} onChange={(event) => { const title = event.target.value; setTaskItems((items) => items.map((entry, i) => i === index ? { ...entry, title } : entry)); }} />
          <TextArea aria-label={`Step ${index + 1} detail`} value={item.detail ?? ""} onChange={(event) => { const detail = event.target.value; setTaskItems((items) => items.map((entry, i) => i === index ? { ...entry, detail } : entry)); }} />
          <Button type="button" onClick={() => setTaskItems((items) => items.filter((entry) => entry.id !== item.id))}>Remove step</Button>
        </div>)}
        <Button type="button" onClick={() => setTaskItems((items) => [...items, { id: `step_${crypto.randomUUID().replaceAll("-", "")}`, title: "New step" }])}>Add step</Button>
        <Field label="Assignment brief"><TextArea
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          rows={5}
          placeholder="Assignment brief"
        /></Field>
        <Field label="One deliverable per line"><TextArea
          value={deliverables}
          onChange={(event) => setDeliverables(event.target.value)}
          rows={3}
          placeholder="One deliverable per line"
        /></Field>
        <Field label="One rubric point per line"><TextArea
          value={rubric}
          onChange={(event) => setRubric(event.target.value)}
          rows={3}
          placeholder="One rubric point per line"
        /></Field>
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
            <TextInput
              type="datetime-local"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </label>
          <label className={css({ fontSize: "0.68rem" })}>
            Estimated hours
            <TextInput
              type="number"
              min="0.25"
              step="0.25"
              value={hours}
              onChange={(event) => setHours(event.target.value)}
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
          <Button
            type="button"
            variant="line"
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
                    taskKind,
                    taskItems,
                    availableFrom: availableFrom ? new Date(availableFrom).toISOString() : undefined,
                    targetWords: assignment.targetWords,
                    round: assignment.round,
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
            <KeatingGlyph name="save" size={12} /> Save
          </Button>
          <Button
            type="button"
            className="cb-danger"
            onClick={() => setRemoving(true)}>
            <KeatingGlyph name="trash" size={12}/> Remove
          </Button>
          <ConfirmDialog open={removing} title="Confirm removal" description={`Remove “${assignment.title}” and its submissions?`} confirmLabel="Remove"
            onCancel={() => setRemoving(false)}
            onConfirm={() => {
              setRemoving(false);
              void mutate({
                ...operationBase(snapshot),
                type: "assignment.delete",
                assignmentId: assignment.id,
              }, `assignment-delete-${assignment.id}`);
            }}/>
        </div>
      </div>
    </Card>
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
          borderTop: "1px solid var(--line-soft)",
          bg: "var(--paper)",
          p: "0.6rem",
        })}
      >
        <Field label="Assignment title"><TextInput
          aria-label="Assignment title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Assignment title"
        /></Field>
        <Field label="What should the learner make, investigate, or submit over time?"><TextArea
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          rows={3}
          placeholder="What should the learner make, investigate, or submit over time?"
        /></Field>
        {targetSelect(
          lessons,
          lessonId,
          setLessonId,
          "Attach assignment to lesson",
        )}
        <Button
          type="button"
          variant="line"
          disabled={
            !title.trim() || !brief.trim() || saving === "assignment-add"
          }
          onClick={add}
        >
          <KeatingGlyph name="checklist" size={12} /> Add assignment
        </Button>
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
        <EmptyState heading="No long-range assignments yet." />
      )}
    </div>
  );
}

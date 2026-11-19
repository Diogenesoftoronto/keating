import "./course-builder.css";
import { CourseAddMenu } from "./CourseAddMenu";
import { KeatingGlyph } from "../../design-system/glyphs";
import { Button, Card, EmptyState, Loading, Chip, Eyebrow, TextArea, TextInput, Sheet, Switch, ConfirmDialog, StatusDot, Note, Meter, IconButton } from "../../design-system/kit";
import { Select } from "../Select";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CourseJudgementPanel } from "./CourseJudgementPanel";
import { css, cx } from "../../../styled-system/css";
import {
  ANKI_FILE_ACCEPT,
  chunkCourseCards,
  courseCardsFromAnkiDecks,
  readAnkiFile,
  summarizeAnkiImport,
  withDeckNameTags,
  type AnkiFileImport,
} from "../../courses/course-anki";
import {
  applyCourseOperation,
  courseMaterialUrl,
  deleteCourseMaterial,
  newCourseOperationId,
  updateCourseMaterial,
  uploadCourseMaterial,
} from "../../courses/client";
import { mergeAnkiDeck } from "../../keating/anki-package";
import type {
  CourseCard,
  CourseLesson,
  CourseMaterial,
  CourseModule,
  CourseOperation,
  CourseViewerSnapshot,
} from "../../courses/contracts";
import { getInitPromise, keatingStorage } from "../../hooks/keating-storage";
import type { FlashcardDeck } from "../../keating/flashcard-types";
import { ArtifactManager, AssignmentManager } from "./CourseContentManagers";

export type CourseBuilderSection =
  | "details"
  | "outline"
  | "lesson"
  | "documents"
  | "assignments"
  | "artifacts"
  | "cards"
  | "access";

type Mutate = (
  operation: Parameters<typeof applyCourseOperation>[0],
  label: string,
) => Promise<void>;

interface BuilderProps {
  snapshot: CourseViewerSnapshot;
  activeLesson?: CourseLesson;
  section: CourseBuilderSection;
  error?: string;
  saving: string;
  onSectionChange(section: CourseBuilderSection): void;
  mutate: Mutate;
  onSnapshot(snapshot: CourseViewerSnapshot): void;
  onSelectLesson(lessonId: string): void;
  onInvite(): void;
  onError(message: string): void;
}

function operationBase(
  snapshot: CourseViewerSnapshot,
): Pick<CourseOperation, "id" | "courseId" | "baseRevision"> {
  return {
    id: newCourseOperationId(),
    courseId: snapshot.course.id,
    baseRevision: snapshot.course.revision,
  };
}

const RemovalContext = createContext<(message: string, remove: () => void) => void>(() => {});

function lines(value: string, limit: number): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function SectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="cb-heading k-halftone"><div><h3>{title}</h3><p>{description}</p></div>{actions}</header>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className={cx("k-eyebrow", css({ display: "block", mb: "0.25rem" }))}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ details */

function DetailsSection({
  snapshot,
  saving,
  mutate,
}: {
  snapshot: CourseViewerSnapshot;
  saving: string;
  mutate: Mutate;
}) {
  const { course } = snapshot;
  const [title, setTitle] = useState(course.title);
  const [description, setDescription] = useState(course.description);
  const [outcomes, setOutcomes] = useState(course.outcomes.join("\n"));
  useEffect(() => {
    setTitle(course.title);
    setDescription(course.description);
    setOutcomes(course.outcomes.join("\n"));
  }, [course.title, course.description, course.outcomes]);
  const dirty =
    title !== course.title ||
    description !== course.description ||
    outcomes !== course.outcomes.join("\n");

  return (
    <>
      <SectionHeader
        title="What this course is"
        description="The title, the promise, and the outcomes a learner can check themselves against."
      />
      <div className={css({ display: "grid", gap: "0.75rem", maxW: "46rem" })}>
        <label>
          <FieldLabel>Title</FieldLabel>
          <TextInput
            value={title}
            maxLength={240}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          <FieldLabel>Description</FieldLabel>
          <TextArea
            value={description}
            maxLength={4_000}
            rows={4}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Who it is for, what it covers, and where it ends."
          />
        </label>
        <label>
          <FieldLabel>Outcomes · one per line</FieldLabel>
          <TextArea
            value={outcomes}
            rows={5}
            onChange={(event) => setOutcomes(event.target.value)}
            placeholder={"Distinguish intervention from observation\nCritique a causal diagram"}
          />
        </label>
        <div className={css({ display: "flex", justifyContent: "flex-end" })}>
          <Button
            type="button"
            variant="primary"
            disabled={!title.trim() || !dirty || saving === "course-details"}
            onClick={() =>
              void mutate(
                {
                  ...operationBase(snapshot),
                  type: "course.update",
                  patch: {
                    title: title.trim(),
                    description: description.trim(),
                    outcomes: lines(outcomes, 24),
                  },
                },
                "course-details",
              )
            }
          >
            <KeatingGlyph name="save" size={13} />
            {saving === "course-details" ? <Loading size="inline" label="Saving…" /> : "Save course details"}
          </Button>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ outline */

function ModuleCard({
  snapshot,
  module,
  activeLessonId,
  saving,
  mutate,
  onSelectLesson,
}: {
  snapshot: CourseViewerSnapshot;
  module: CourseModule;
  activeLessonId?: string;
  saving: string;
  mutate: Mutate;
  onSelectLesson(lessonId: string): void;
}) {
  const requestRemoval = useContext(RemovalContext);
  const moduleIndex = snapshot.course.modules.findIndex(item => item.id === module.id);
  const offset = snapshot.course.modules.slice(0, moduleIndex).reduce((sum, item) => sum + item.lessons.length, 0);
  const [title, setTitle] = useState(module.title);
  const [description, setDescription] = useState(module.description);
  const [lessonTitle, setLessonTitle] = useState("");
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    setTitle(module.title);
    setDescription(module.description);
  }, [module.title, module.description]);

  const saveModule = (lessons = module.lessons, label = `module-${module.id}`) =>
    mutate(
      {
        ...operationBase(snapshot),
        type: "module.upsert",
        module: {
          ...module,
          title: title.trim() || module.title,
          description,
          lessons,
        },
      },
      label,
    );

  const move = (index: number, delta: number) => {
    const lessons = [...module.lessons];
    const target = index + delta;
    const current = lessons[index];
    const swap = lessons[target];
    if (!current || !swap) return;
    lessons[index] = swap;
    lessons[target] = current;
    void saveModule(lessons, `module-order-${module.id}`);
  };

  const addLesson = async () => {
    if (!lessonTitle.trim()) return;
    await mutate(
      {
        ...operationBase(snapshot),
        type: "lesson.update",
        moduleId: module.id,
        lesson: {
          id: `lesson_${crypto.randomUUID().replaceAll("-", "")}`,
          title: lessonTitle.trim(),
          summary: "",
          objectives: [],
          reading: "",
          materialIds: [],
          cardIds: [],
        },
      },
      `lesson-add-${module.id}`,
    );
    setLessonTitle("");
  };

  return (
    <section className="cb-module">
      <header data-glyph-host className="cb-module-head k-halftone">
        <KeatingGlyph name="grip" size={14}/><strong>{moduleIndex + 1} · {module.title}</strong>
        <small>{module.lessons.length} {module.lessons.length === 1 ? "lesson" : "lessons"}</small>
        <span className={css({ display: "flex", gap: "0.3rem" })}>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setEditing((value) => !value)}
          >
            <KeatingGlyph name={editing ? "check" : "edit"} size={15} /> {editing ? "Done" : "Rename"}
          </Button>
          <IconButton glyph="trash"
            type="button"
            className="cb-danger"
            onClick={() => {
              requestRemoval(`Remove “${module.title}” and its lessons?`, () =>
                void mutate(
                  {
                    ...operationBase(snapshot),
                    type: "module.delete",
                    moduleId: module.id,
                  },
                  `module-delete-${module.id}`,
                ));
            }}
            label={`Remove ${module.title}`} />
        </span>
      </header>
      {editing ? (
        <div
          className={css({
            display: "grid",
            gap: "0.4rem",
            borderBottom: "1px solid var(--line-soft)",
            bg: "var(--paper)",
            p: "0.6rem",
          })}
        >
          <TextInput
            value={title}
            maxLength={240}
            onChange={(event) => setTitle(event.target.value)}
            aria-label="Module title"
          />
          <TextArea
            value={description}
            maxLength={2_000}
            rows={2}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What this module is for"
            aria-label="Module description"
          />
          <Button
            type="button"
            variant="line"
            disabled={!title.trim() || saving === `module-${module.id}`}
            onClick={() => void saveModule().then(() => setEditing(false))}
          >
            <KeatingGlyph name="save" size={12} /> Save module
          </Button>
        </div>
      ) : null}
      <ol className={css({ listStyle: "none" })}>
        {module.lessons.map((lesson, index) => (
          <li
            key={lesson.id}
            data-glyph-host className="cb-lesson-row" data-selected={lesson.id === activeLessonId}>
            <KeatingGlyph name="grip" size={13}/>
            <small>{offset + index + 1}</small>
            <button className="cb-lesson-link" type="button" onClick={() => onSelectLesson(lesson.id)}>{lesson.title}</button>
            <span className="cb-row-actions">
              <IconButton glyph="rise"
                type="button"
                label={`Move ${lesson.title} up`}
                size="sm"
                disabled={index === 0 || saving === `module-order-${module.id}`}
                onClick={() => move(index, -1)} />
              <IconButton glyph="down"
                type="button"
                label={`Move ${lesson.title} down`}
                size="sm"
                disabled={
                  index === module.lessons.length - 1 ||
                  saving === `module-order-${module.id}`
                }
                onClick={() => move(index, 1)} />
              <IconButton glyph="trash"
                type="button"
                label={`Remove ${lesson.title}`}
                className="cb-danger"
                onClick={() => {
                  requestRemoval(`Remove “${lesson.title}”? Its notes, work, and discussion go with it.`, () =>
                    void mutate(
                      {
                        ...operationBase(snapshot),
                        type: "lesson.delete",
                        moduleId: module.id,
                        lessonId: lesson.id,
                      },
                      `lesson-delete-${lesson.id}`,
                    ));
                }} />
            </span>
          </li>
        ))}
      </ol>
      <div className="cb-add-lesson">
        <TextInput
          value={lessonTitle}
          maxLength={240}
          onChange={(event) => setLessonTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && saving !== `lesson-add-${module.id}`) void addLesson();
          }}
          placeholder={`New lesson in ${module.title}`}
          aria-label={`New lesson in ${module.title}`}
        />
        <Button
          type="button"
          variant="line"
          disabled={!lessonTitle.trim() || saving === `lesson-add-${module.id}`}
          onClick={() => void addLesson()}
        >
          <KeatingGlyph name="plus" size={12} /> Lesson
        </Button>
      </div>
    </section>
  );
}

function OutlineSection({
  snapshot,
  activeLesson,
  saving,
  mutate,
  onSelectLesson,
}: {
  snapshot: CourseViewerSnapshot;
  activeLesson?: CourseLesson;
  saving: string;
  mutate: Mutate;
  onSelectLesson(lessonId: string): void;
}) {
  const [moduleTitle, setModuleTitle] = useState("");
  const addModule = async () => {
    if (!moduleTitle.trim()) return;
    await mutate(
      {
        ...operationBase(snapshot),
        type: "module.upsert",
        module: {
          id: `module_${crypto.randomUUID().replaceAll("-", "")}`,
          title: moduleTitle.trim(),
          description: "",
          lessons: [],
        },
      },
      "module-add",
    );
    setModuleTitle("");
  };
  return (
    <>
      <SectionHeader
        title="The spine"
        description="Modules hold lessons in the order a learner meets them. Reorder freely; nothing is inserted for you."
      />
      {snapshot.course.modules.length ? (
        <div className={css({ display: "grid", gap: "0.7rem" })}>
          {snapshot.course.modules.map((module) => (
            <ModuleCard
              key={module.id}
              snapshot={snapshot}
              module={module}
              {...(activeLesson ? { activeLessonId: activeLesson.id } : {})}
              saving={saving}
              mutate={mutate}
              onSelectLesson={onSelectLesson}
            />
          ))}
        </div>
      ) : (
        <EmptyState heading="A blank course is valid.">
          Add the first module when the shape is clear —
          or add documents, assignments, and cards first and shape the outline
          around them.
        </EmptyState>
      )}
      <div className="cb-new-module">
        <TextInput
          value={moduleTitle}
          maxLength={240}
          onChange={(event) => setModuleTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && saving !== "module-add") void addModule();
          }}
          placeholder="New module title"
          aria-label="New module title"
        />
        <Button
          type="button"
          variant="primary"
          disabled={!moduleTitle.trim() || saving === "module-add"}
          onClick={() => void addModule()}
        >
          <KeatingGlyph name="plus" size={13} /> Module
        </Button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------- lesson */

function LessonSection({
  snapshot,
  lesson,
  saving,
  mutate,
  onSectionChange,
  attach,
  sheet,
  error,
}: {
  sheet?: {open: boolean; close(): void};
  error?: string;
  attach: ReactNode;
  snapshot: CourseViewerSnapshot;
  lesson?: CourseLesson;
  saving: string;
  mutate: Mutate;
  onSectionChange(section: CourseBuilderSection): void;
}) {
  const requestRemoval = useContext(RemovalContext);
  const module = snapshot.course.modules.find((candidate) =>
    candidate.lessons.some((item) => item.id === lesson?.id),
  );
  const [title, setTitle] = useState(lesson?.title ?? "");
  const [summary, setSummary] = useState(lesson?.summary ?? "");
  const [minutes, setMinutes] = useState(
    lesson?.estimatedMinutes ? String(lesson.estimatedMinutes) : "",
  );
  const [reading, setReading] = useState(lesson?.reading ?? "");
  const [objectives, setObjectives] = useState(
    lesson?.objectives.join("\n") ?? "",
  );
  const [hasQuestion, setHasQuestion] = useState(Boolean(lesson?.exercise));
  const [prompt, setPrompt] = useState(lesson?.exercise?.prompt ?? "");
  const [placeholder, setPlaceholder] = useState(
    lesson?.exercise?.placeholder ?? "",
  );
  const [rubric, setRubric] = useState(
    lesson?.exercise?.rubric.join("\n") ?? "",
  );
  const discard = () => {
    setTitle(lesson?.title ?? "");
    setSummary(lesson?.summary ?? "");
    setMinutes(lesson?.estimatedMinutes ? String(lesson.estimatedMinutes) : "");
    setReading(lesson?.reading ?? "");
    setObjectives(lesson?.objectives.join("\n") ?? "");
    setHasQuestion(Boolean(lesson?.exercise));
    setPrompt(lesson?.exercise?.prompt ?? "");
    setPlaceholder(lesson?.exercise?.placeholder ?? "");
    setRubric(lesson?.exercise?.rubric.join("\n") ?? "");
  };
  useEffect(discard, [lesson?.id, lesson?.title, lesson?.summary, lesson?.estimatedMinutes, lesson?.reading,
    lesson?.objectives.join("\n"), lesson?.exercise?.id, lesson?.exercise?.prompt, lesson?.exercise?.placeholder, lesson?.exercise?.rubric.join("\n")]);

  if (!lesson || !module) {
    return (
      <>
        <SectionHeader
          title="No lesson open"
          description="Choose a lesson in the outline to edit its reading, objectives, and practice question."
        />
        <Button
          type="button"
          variant="line"
          onClick={() => onSectionChange("outline")}
        >
          <KeatingGlyph name="tree" size={13} /> Go to the outline
        </Button>
      </>
    );
  }

  const changes = [title !== lesson.title, summary !== lesson.summary, reading !== lesson.reading,
    minutes !== String(lesson.estimatedMinutes ?? ""), objectives !== lesson.objectives.join("\n"),
    hasQuestion !== Boolean(lesson.exercise), hasQuestion && prompt !== (lesson.exercise?.prompt ?? ""),
    hasQuestion && placeholder !== (lesson.exercise?.placeholder ?? ""), hasQuestion && rubric !== (lesson.exercise?.rubric.join("\n") ?? "")].filter(Boolean).length;
  const validation = !title.trim() ? "Enter a lesson title to save." : hasQuestion && !prompt.trim() ? "Enter a question prompt to save." : "";
  const busy = saving === `lesson-edit-${lesson.id}`;
  const attachedMaterials = snapshot.course.materials.filter(
    (material) => material.lessonId === lesson.id,
  ).length;
  const attachedArtifacts = snapshot.course.artifacts.filter(
    (artifact) => artifact.lessonId === lesson.id,
  ).length;
  const attachedAssignments = snapshot.course.assignments.filter(
    (assignment) => assignment.lessonId === lesson.id,
  ).length;
  const attachedCards = snapshot.course.cards.filter(
    (card) => card.lessonId === lesson.id,
  ).length;

  const save = () =>
    mutate(
      {
        ...operationBase(snapshot),
        type: "lesson.update",
        moduleId: module.id,
        lesson: {
          ...lesson,
          title: title.trim(),
          summary,
          reading,
          ...(Number(minutes) > 0
            ? { estimatedMinutes: Math.round(Number(minutes)) }
            : { estimatedMinutes: undefined }),
          objectives: lines(objectives, 16),
          ...(hasQuestion
            ? {
                exercise: {
                  id:
                    lesson.exercise?.id ??
                    `exercise_${crypto.randomUUID().replaceAll("-", "")}`,
                  prompt: prompt.trim(),
                  ...(placeholder.trim()
                    ? { placeholder: placeholder.trim() }
                    : {}),
                  rubric: lines(rubric, 12),
                },
              }
            : { exercise: undefined }),
        },
      },
      `lesson-edit-${lesson.id}`,
    );

  const content = (
    <>
      <SectionHeader
        title={lesson.title}
        description={`In ${module.title}. Everything a learner reads and answers on the desk.`}
        actions={
          <Button
            type="button"
            variant="ghost" className="cb-danger"
            onClick={() => {
              requestRemoval(`Remove “${lesson.title}”? Its notes, work, and discussion go with it.`, () =>
                void mutate(
                  {
                    ...operationBase(snapshot),
                    type: "lesson.delete",
                    moduleId: module.id,
                    lessonId: lesson.id,
                  },
                  `lesson-delete-${lesson.id}`,
                ));
            }}
          >
            <KeatingGlyph name="trash" size={12} /> Remove lesson
          </Button>
        }
      />
      <div className="cb-editor-fields">
        <div className="cb-title-fields">
          <label>
            <FieldLabel>Title</FieldLabel>
            <TextInput
              value={title}
              maxLength={240}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            <FieldLabel>Minutes</FieldLabel>
            <TextInput
              type="number"
              min="1"
              max="1440"
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
              placeholder="Self paced"
            />
          </label>
        </div>
        <label>
          <FieldLabel>Summary</FieldLabel>
          <TextArea
            value={summary}
            maxLength={2_000}
            rows={2}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="One sentence a learner reads under the title."
          />
        </label>
        <label>
          <FieldLabel>By the end, a learner can · one per line</FieldLabel>
          <TextArea
            value={objectives}
            rows={3}
            onChange={(event) => setObjectives(event.target.value)}
          />
        </label>
        <label>
          <FieldLabel>Reading</FieldLabel>
          <TextArea
            value={reading}
            maxLength={120_000}
            rows={5}
            onChange={(event) => setReading(event.target.value)}
            className="cb-reading"
            placeholder="The lesson itself: explanation, worked examples, instructions."
          />
        </label>
        <div className={cx("cb-card", css({ p: "0.7rem" }))}>
          <div
            className={css({
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.5rem",
            })}
          >
            <span data-glyph-host
              className={css({
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                fontSize: "0.8rem",
                fontWeight: 750,
              })}
            >
              <KeatingGlyph name="quiz" size={14} /> Practice question
            </span>
            <Button
              type="button"
              variant="line"
              onClick={() => setHasQuestion((value) => !value)}
            >
              {hasQuestion ? "Remove question" : "Add question"}
            </Button>
          </div>
          {hasQuestion ? (
            <div className={css({ mt: "0.55rem", display: "grid", gap: "0.4rem" })}>
              <TextArea
                value={prompt}
                maxLength={30_000}
                rows={4}
                onChange={(event) => setPrompt(event.target.value)}
                aria-invalid={!prompt.trim()}
                aria-label="Question prompt"
                placeholder="What should the learner work out here?"
              />
              <TextInput
                value={placeholder}
                maxLength={240}
                onChange={(event) => setPlaceholder(event.target.value)}
                aria-label="Answer field hint (optional)"
                placeholder="Answer field hint (optional)"
              />
              <TextArea
                value={rubric}
                rows={3}
                onChange={(event) => setRubric(event.target.value)}
                aria-label="Rubric"
                placeholder="One rubric point per line"
              />
            </div>
          ) : (
            <EmptyState className="cb-question-empty k-halftone" heading="This lesson has no question.">Add one when practice belongs here.</EmptyState>
          )}
        </div>
        <div
          className={css({
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.5rem",
          })}
        >
          <div className="cb-attachments">
            <Chip as="button"
              type="button"
              onClick={() => onSectionChange("documents")}
            >
              <KeatingGlyph name="doc" size={12} /> {attachedMaterials} documents
            </Chip>
            <Chip as="button"
              type="button"
              onClick={() => onSectionChange("artifacts")}
            >
              <KeatingGlyph name="shapes" size={12} /> {attachedArtifacts} artifacts
            </Chip>
            <Chip as="button"
              type="button"
              onClick={() => onSectionChange("assignments")}
            >
              <KeatingGlyph name="checklist" size={12} /> {attachedAssignments} assignments
            </Chip>
            <Chip as="button"
              type="button"
              onClick={() => onSectionChange("cards")}
            >
              <KeatingGlyph name="layers" size={12} /> {attachedCards} cards
            </Chip>
            <Chip count={hasQuestion ? 1 : 0}>Questions</Chip>
            {attach}
          </div>
        </div>
        <footer className="cb-unsaved">
          {error && <Note tone="warn" role="alert">{error}</Note>}
          {validation && <small id="cb-save-reason" role="status">{validation}</small>}
          <span role="status">{changes} unsaved</span>
          <Button variant="ghost" disabled={!changes || busy} onClick={discard}>Discard</Button>
          <Button variant="primary" busy={busy} aria-describedby={validation ? "cb-save-reason" : undefined} disabled={!changes || !!validation} onClick={() => void save()}>{busy ? <Loading size="inline" label="Saving…" /> : "Save lesson"}</Button>
        </footer>
      </div>
    </>
  );
  return sheet
    ? <Sheet className="cb-sheet" open={sheet.open} title="Edit lesson" onClose={sheet.close}>{content}</Sheet>
    : <aside className="cb-editor" aria-label="Lesson editor">{content}</aside>;
}

/* ---------------------------------------------------------------- documents */

function DocumentRow({
  snapshot,
  material,
  onSnapshot,
  onError,
}: {
  snapshot: CourseViewerSnapshot;
  material: CourseMaterial;
  onSnapshot(snapshot: CourseViewerSnapshot): void;
  onError(message: string): void;
}) {
  const requestRemoval = useContext(RemovalContext);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(material.title);
  const [lessonId, setLessonId] = useState(material.lessonId ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setTitle(material.title);
    setLessonId(material.lessonId ?? "");
  }, [material]);
  const lessons = snapshot.course.modules.flatMap((module) => module.lessons);
  const href = material.url ?? courseMaterialUrl(snapshot.course.id, material.id);
  const glyph =
    material.kind === "image"
      ? "image"
      : material.kind === "link"
        ? "link"
        : "doc";

  return (
    <div className="cb-card">
      <div
        className={css({
          display: "grid",
          gridTemplateColumns: "1.1rem minmax(0, 1fr) auto",
          alignItems: "center",
          gap: "0.55rem",
          px: "0.6rem",
          py: "0.5rem",
        })}
      >
        <KeatingGlyph name={glyph} size={15} />
        <Button
          type="button"
          className={css({
            minW: 0,
            textAlign: "left",
            cursor: "pointer",
          })}
          onClick={() => setOpen((value) => !value)}
        >
          <strong
            className={css({
              display: "block",
              overflowWrap: "anywhere",
              fontSize: "0.82rem",
            })}
          >
            {material.title}
          </strong>
          <small className={css({ color: "var(--ink-soft)" })}>
            {material.kind}
            {material.sizeBytes
              ? ` · ${(material.sizeBytes / 1024 / 1024).toFixed(1)} MB`
              : ""}
            {" · "}
            {material.lessonId
              ? (lessons.find((lesson) => lesson.id === material.lessonId)?.title ??
                "Lesson")
              : "Course-wide"}
          </small>
        </Button>
        <span className={css({ display: "flex", gap: "0.25rem" })}>
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${material.title}`}
            className={cx("k-button k-line", css({ color: "inherit", textDecoration: "none" }))}
          >
            <KeatingGlyph name="ext" size={15} />
          </a>
          <IconButton glyph="edit"
            type="button"
            size="sm"
            onClick={() => setOpen((value) => !value)}
            label={`Edit ${material.title}`} />
        </span>
      </div>
      {open ? (
        <div
          className={css({
            display: "grid",
            gap: "0.4rem",
            borderTop: "1px solid var(--line-soft)",
            bg: "var(--paper)",
            p: "0.6rem",
          })}
        >
          <TextInput
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            aria-label={`Title for ${material.title}`}
          />
          <Select
            value={lessonId}
            onValueChange={(value) => setLessonId(value)}
            className="k-input"
            aria-label={`Attach ${material.title} to a lesson`}
          >
            <option value="">Course-wide</option>
            {lessons.map((lesson) => (
              <option key={lesson.id} value={lesson.id}>
                {lesson.title}
              </option>
            ))}
          </Select>
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
              disabled={busy || !title.trim()}
              onClick={() => {
                setBusy(true);
                void updateCourseMaterial(snapshot.course.id, {
                  ...material,
                  title: title.trim(),
                  ...(lessonId ? { lessonId } : { lessonId: undefined }),
                })
                  .then((next) => {
                    onSnapshot(next);
                    setOpen(false);
                  })
                  .catch((cause) =>
                    onError(
                      cause instanceof Error
                        ? cause.message
                        : "That source could not be saved.",
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              <KeatingGlyph name="save" size={12} /> Save
            </Button>
            <Button
              type="button"
              className="cb-danger"
              disabled={busy}
              onClick={() => {
                requestRemoval(`Remove “${material.title}”?`, () => {
                setBusy(true);
                void deleteCourseMaterial(snapshot.course.id, material.id)
                  .then(onSnapshot)
                  .catch((cause) =>
                    onError(
                      cause instanceof Error
                        ? cause.message
                        : "That source could not be removed.",
                    ),
                  )
                  .finally(() => setBusy(false));
              });
              }}
            >
              <KeatingGlyph name="trash" size={12} /> Remove
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DocumentsSection({
  snapshot,
  activeLesson,
  saving,
  mutate,
  onSnapshot,
  onError,
}: {
  snapshot: CourseViewerSnapshot;
  activeLesson?: CourseLesson;
  saving: string;
  mutate: Mutate;
  onSnapshot(snapshot: CourseViewerSnapshot): void;
  onError(message: string): void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [target, setTarget] = useState(activeLesson?.id ?? "");
  useEffect(() => {
    if (activeLesson) setTarget(activeLesson.id);
  }, [activeLesson?.id]);
  const lessons = snapshot.course.modules.flatMap((module) => module.lessons);

  const upload = (file: File) => {
    setBusy(true);
    void uploadCourseMaterial(snapshot.course.id, file, {
      title: file.name,
      ...(target ? { lessonId: target } : {}),
    })
      .then(onSnapshot)
      .catch((cause) =>
        onError(
          cause instanceof Error
            ? cause.message
            : "That document could not be uploaded.",
        ),
      )
      .finally(() => setBusy(false));
  };

  const needle = filter.trim().toLowerCase();
  const materials = needle
    ? snapshot.course.materials.filter((material) =>
        `${material.title} ${material.fileName ?? ""} ${material.url ?? ""}`
          .toLowerCase()
          .includes(needle),
      )
    : snapshot.course.materials;

  return (
    <>
      <SectionHeader
        title="Documents, images, and links"
        description="Drop in the readings a learner actually needs. Anything attached to a lesson shows up on its desk."
      />
      <div className={css({ display: "grid", gap: "0.7rem" })}>
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files?.[0];
            if (file) upload(file);
          }}
          className="cb-drop k-grid"
          style={
            dragging
              ? {
                  borderColor: "var(--green-deep)",
                  backgroundColor: "var(--k-wash)",
                }
              : undefined
          }
        >
          <input
            ref={fileRef}
            type="file"
            className={css({ display: "none" })}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) upload(file);
            }}
          />
          {busy ? <Meter live progress indeterminate max={1} label="Uploading document" valueText="Uploading…"/> :
            <p className={css({ fontSize: "0.85rem", fontWeight: 700 })}>Drop a file here, or choose one</p>}
          <p className={css({ fontSize: "0.72rem", color: "var(--ink-soft)" })}>
            PDFs, slides, notes, and images up to 25 MB
          </p>
          <div
            className={css({
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.4rem",
            })}
          >
            <Button
              type="button"
              variant="primary"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <KeatingGlyph name="import" size={13} /> Choose file
            </Button>
            <Select
              value={target}
              onValueChange={(value) => setTarget(value)}
              className={cx("k-input", css({ w: "auto", maxW: "16rem" }))}
              aria-label="Attach new sources to"
            >
              <option value="">Course-wide</option>
              {lessons.map((lesson) => (
                <option key={lesson.id} value={lesson.id}>
                  Attach to: {lesson.title}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div
          className={css({
            display: "grid",
            gap: "0.4rem",
            bg: "var(--paper)",
            p: "0.6rem",
            sm: { gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) auto" },
          })}
        >
          <TextInput
            value={linkTitle}
            onChange={(event) => setLinkTitle(event.target.value)}
            placeholder="Link title"
            aria-label="Link title"
          />
          <TextInput
            value={linkUrl}
            type="url"
            onChange={(event) => setLinkUrl(event.target.value)}
            placeholder="https://…"
            aria-label="Link address"
          />
          <Button
            type="button"
            variant="line"
            disabled={
              !linkTitle.trim() || !linkUrl.trim() || saving === "material-link"
            }
            onClick={() =>
              void mutate(
                {
                  ...operationBase(snapshot),
                  type: "material.add",
                  material: {
                    id: `material_${crypto.randomUUID().replaceAll("-", "")}`,
                    kind: "link",
                    title: linkTitle.trim(),
                    url: linkUrl.trim(),
                    ...(target ? { lessonId: target } : {}),
                  },
                },
                "material-link",
              ).then(() => {
                setLinkTitle("");
                setLinkUrl("");
              })
            }
          >
            <KeatingGlyph name="link" size={13} /> Add link
          </Button>
        </div>
        {snapshot.course.materials.length > 4 ? (
          <TextInput
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter sources…"
            aria-label="Filter sources"
          />
        ) : null}
        {materials.length ? (
          <div className={css({ display: "grid", gap: "0.4rem" })}>
            {materials.map((material) => (
              <DocumentRow
                key={material.id}
                snapshot={snapshot}
                material={material}
                onSnapshot={onSnapshot}
                onError={onError}
              />
            ))}
          </div>
        ) : (
          <EmptyState heading={snapshot.course.materials.length
              ? "No source matches that filter."
              : "No documents, images, or links yet."} />
        )}
      </div>
    </>
  );
}

/* -------------------------------------------------------------------- cards */

function CardEditor({
  snapshot,
  card,
  saving,
  mutate,
}: {
  snapshot: CourseViewerSnapshot;
  card: CourseCard;
  saving: string;
  mutate: Mutate;
}) {
  const requestRemoval = useContext(RemovalContext);
  const lessons = snapshot.course.modules.flatMap((module) => module.lessons);
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const [tags, setTags] = useState(card.tags.join(", "));
  const [lessonId, setLessonId] = useState(card.lessonId ?? "");
  useEffect(() => {
    setFront(card.front);
    setBack(card.back);
    setTags(card.tags.join(", "));
    setLessonId(card.lessonId ?? "");
  }, [card]);
  return (
    <Card as="details">
      <summary
        className={css({
          cursor: "pointer",
          overflowWrap: "anywhere",
          px: "0.6rem",
          py: "0.5rem",
          fontSize: "0.78rem",
        })}
      >
        {card.front}
      </summary>
      <div
        className={css({
          display: "grid",
          gap: "0.4rem",
          borderTop: "1px solid var(--line-soft)",
          p: "0.6rem",
        })}
      >
        <TextArea
          value={front}
          onChange={(event) => setFront(event.target.value)}
          rows={2}
          placeholder="Front"
        />
        <TextArea
          value={back}
          onChange={(event) => setBack(event.target.value)}
          rows={3}
          placeholder="Back"
        />
        <TextInput
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          placeholder="tags, separated, by commas"
        />
        <Select
          value={lessonId}
          onValueChange={(value) => setLessonId(value)}
          className="k-input"
          aria-label="Attach card to lesson"
        >
          <option value="">Course-wide card</option>
          {lessons.map((lesson) => (
            <option key={lesson.id} value={lesson.id}>
              {lesson.title}
            </option>
          ))}
        </Select>
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
            disabled={!front.trim() || !back.trim() || saving === `card-${card.id}`}
            onClick={() =>
              void mutate(
                {
                  ...operationBase(snapshot),
                  type: "card.upsert",
                  card: {
                    id: card.id,
                    front: front.trim(),
                    back: back.trim(),
                    tags: tags
                      .split(",")
                      .map((tag) => tag.trim())
                      .filter(Boolean)
                      .slice(0, 24),
                    ...(lessonId ? { lessonId } : {}),
                  },
                },
                `card-${card.id}`,
              )
            }
          >
            <KeatingGlyph name="save" size={12} /> Save
          </Button>
          <Button
            type="button"
            className="cb-danger"
            onClick={() => {
              requestRemoval("Remove this card?", () =>
                void mutate(
                  {
                    ...operationBase(snapshot),
                    type: "card.delete",
                    cardId: card.id,
                  },
                  `card-delete-${card.id}`,
                ));
            }}
          >
            <KeatingGlyph name="trash" size={12} /> Remove
          </Button>
        </div>
      </div>
    </Card>
  );
}

function AnkiImportPanel({
  snapshot,
  activeLesson,
  onSnapshot,
  onError,
}: {
  snapshot: CourseViewerSnapshot;
  activeLesson?: CourseLesson;
  onSnapshot(snapshot: CourseViewerSnapshot): void;
  onError(message: string): void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<AnkiFileImport | null>(null);
  const [chosenDecks, setChosenDecks] = useState<Set<string>>(new Set());
  const [attachToLesson, setAttachToLesson] = useState(Boolean(activeLesson));
  const [tagWithDeck, setTagWithDeck] = useState(true);
  const [saveToDecks, setSaveToDecks] = useState(true);
  const [status, setStatus] = useState("");

  useEffect(() => {
    setAttachToLesson(Boolean(activeLesson));
  }, [activeLesson?.id]);

  const decks = useMemo(
    () => (imported ? imported.decks.filter((deck) => chosenDecks.has(deck.id)) : []),
    [chosenDecks, imported],
  );
  const selection = useMemo(
    () =>
      courseCardsFromAnkiDecks(decks, {
        existingCards: snapshot.course.cards,
        ...(attachToLesson && activeLesson ? { lessonId: activeLesson.id } : {}),
        tagWithDeck,
      }),
    [activeLesson, attachToLesson, decks, snapshot.course.cards, tagWithDeck],
  );

  const read = (file: File) => {
    setReading(true);
    setStatus("");
    void readAnkiFile(file)
      .then((result) => {
        setImported(result);
        setChosenDecks(new Set(result.decks.map((deck) => deck.id)));
        if (result.warnings.length) setStatus(result.warnings.join(" "));
      })
      .catch((cause) =>
        onError(
          cause instanceof Error
            ? cause.message
            : "That Anki file could not be read.",
        ),
      )
      .finally(() => setReading(false));
  };

  const runImport = async () => {
    if (!imported || !selection.cards.length) return;
    setImporting(true);
    setStatus("");
    let latest = snapshot;
    let appliedCards = 0;
    try {
      for (const batch of chunkCourseCards(selection.cards)) {
        const result = await applyCourseOperation({
          id: newCourseOperationId(),
          courseId: snapshot.course.id,
          baseRevision: latest.course.revision,
          type: "cards.import",
          cards: batch,
        });
        latest = result.snapshot;
        appliedCards += batch.length;
      }
      onSnapshot(latest);
    } catch (cause) {
      const reason =
        cause instanceof Error ? cause.message : "the course stopped responding";
      if (appliedCards) {
        onSnapshot(latest);
        setStatus(
          `Added ${appliedCards} card${appliedCards === 1 ? "" : "s"} before the import stopped. The remaining cards were not added: ${reason}.`,
        );
      } else {
        onError(reason);
      }
      setImporting(false);
      return;
    }

    let savedNote = "";
    if (saveToDecks) {
      try {
        let added = 0;
        await getInitPromise();
        for (const deck of tagWithDeck ? withDeckNameTags(decks) : decks) {
          const existing = await keatingStorage.getDeck(deck.id);
          const merged = mergeAnkiDeck(existing, deck);
          await keatingStorage.saveDeck(merged.deck);
          added += merged.added + merged.updated;
        }
        savedNote = ` · ${added} card${added === 1 ? "" : "s"} also queued for review`;
      } catch (cause) {
        const reason =
          cause instanceof Error ? cause.message : "local storage was unavailable";
        setStatus(
          `Added ${selection.cards.length} card${selection.cards.length === 1 ? "" : "s"} to the course. The review-deck copy could not be saved: ${reason}.`,
        );
        setImported(null);
        setChosenDecks(new Set());
        setImporting(false);
        return;
      }
    }

    setStatus(
      `Added ${selection.cards.length} card${selection.cards.length === 1 ? "" : "s"} from ${imported.fileName}${
        selection.duplicates
          ? ` · skipped ${selection.duplicates} already here`
          : ""
      }${savedNote}.`,
    );
    setImported(null);
    setChosenDecks(new Set());
    setImporting(false);
  };

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files?.[0];
        if (file) read(file);
      }}
      className="cb-drop k-grid"
      style={
        dragging
          ? {
              borderColor: "var(--green-deep)",
              backgroundColor: "var(--k-wash)",
            }
          : undefined
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept={ANKI_FILE_ACCEPT}
        className={css({ display: "none" })}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) read(file);
        }}
      />
      <div
        className={css({
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
        })}
      >
        <span className={css({ minW: 0 })}>
          <strong data-glyph-host
            className={css({
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              fontSize: "0.84rem",
            })}
          >
            <KeatingGlyph name="import" size={14} /> Import from Anki
          </strong>
          <small className={css({ color: "var(--ink-soft)" })}>
            Drop an .apkg export here, or a .txt, .tsv, or .csv card file
          </small>
        </span>
        <Button
          type="button"
          variant="primary"
          disabled={reading || importing}
          onClick={() => fileRef.current?.click()}
        >
          {reading ? <Loading size="inline" label="Reading…" /> : <><KeatingGlyph name="import" size={13} /> Choose Anki file</>}
        </Button>
      </div>
      {imported ? (
        <div
          className={css({
            display: "grid",
            gap: "0.5rem",
            bg: "var(--card)",
            p: "0.65rem",
          })}
        >
          <p
            className={cx(
              "k-eyebrow",
              css({ overflowWrap: "anywhere" }),
            )}
          >
            {imported.fileName} · {imported.cardCount} card
            {imported.cardCount === 1 ? "" : "s"} ·{" "}
            {imported.format === "text" ? "text export" : "Anki package"}
          </p>
          <div className={css({ display: "grid", gap: "0.25rem" })}>
            {imported.decks.map((deck) => (
              <label
                key={deck.id}
                className={css({
                  display: "flex",
                  alignItems: "center",
                  gap: "0.45rem",
                  fontSize: "0.78rem",
                })}
              >
                <input
                  type="checkbox"
                  checked={chosenDecks.has(deck.id)}
                  onChange={() =>
                    setChosenDecks((current) => {
                      const next = new Set(current);
                      if (next.has(deck.id)) next.delete(deck.id);
                      else next.add(deck.id);
                      return next;
                    })
                  }
                />
                <span className={css({ minW: 0, flex: 1 })}>
                  <span
                    className={css({
                      overflowWrap: "anywhere",
                    })}
                  >
                    {deck.title}
                  </span>
                </span>
                <Chip>{deck.cards.length}</Chip>
              </label>
            ))}
          </div>
          <div className={css({ display: "grid", gap: "0.3rem" })}>
            {activeLesson ? (
              <label
                className={css({
                  display: "flex",
                  alignItems: "center",
                  gap: "0.45rem",
                  fontSize: "0.75rem",
                })}
              >
                <input
                  type="checkbox"
                  checked={attachToLesson}
                  onChange={(event) => setAttachToLesson(event.target.checked)}
                />
                Attach to “{activeLesson.title}”
              </label>
            ) : null}
            <label
              className={css({
                display: "flex",
                alignItems: "center",
                gap: "0.45rem",
                fontSize: "0.75rem",
              })}
            >
              <input
                type="checkbox"
                checked={tagWithDeck}
                onChange={(event) => setTagWithDeck(event.target.checked)}
              />
              Tag each card with its Anki deck
            </label>
            <label
              className={css({
                display: "flex",
                alignItems: "center",
                gap: "0.45rem",
                fontSize: "0.75rem",
              })}
            >
              <input
                type="checkbox"
                checked={saveToDecks}
                onChange={(event) => setSaveToDecks(event.target.checked)}
              />
              Also keep them in my review decks, with their Anki scheduling
            </label>
          </div>
          <p className={css({ fontSize: "0.74rem", color: "var(--ink-soft)" })}>
            {summarizeAnkiImport(imported, selection)}
          </p>
          <div
            className={css({
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "space-between",
              gap: "0.4rem",
            })}
          >
            <Button
              type="button"
              variant="line"
              disabled={importing}
              onClick={() => {
                setImported(null);
                setChosenDecks(new Set());
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={importing || !selection.cards.length}
              onClick={() => void runImport()}
            >
              {!importing && <KeatingGlyph name="plus" size={13} />}
              {importing
                ? <Loading size="inline" label="Importing…" />
                : `Add ${selection.cards.length} card${selection.cards.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      ) : null}
      {status ? (
        <p
          role="status"
          className={css({ fontSize: "0.74rem", color: "var(--ink-soft)" })}
        >
          {status}
        </p>
      ) : null}
    </div>
  );
}

function CardsSection({
  snapshot,
  activeLesson,
  saving,
  mutate,
  onSnapshot,
  onError,
}: {
  snapshot: CourseViewerSnapshot;
  activeLesson?: CourseLesson;
  saving: string;
  mutate: Mutate;
  onSnapshot(snapshot: CourseViewerSnapshot): void;
  onError(message: string): void;
}) {
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [decks, setDecks] = useState<FlashcardDeck[]>([]);
  const [deckId, setDeckId] = useState("");
  const [filter, setFilter] = useState("");
  const [attachImported, setAttachImported] = useState(Boolean(activeLesson));
  useEffect(() => {
    let cancelled = false;
    void getInitPromise()
      .then(() => keatingStorage.getDecks())
      .then((items) => {
        if (!cancelled) setDecks(items);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [snapshot.course.revision]);

  const addCard = async () => {
    if (!front.trim() || !back.trim()) return;
    await mutate(
      {
        ...operationBase(snapshot),
        type: "card.upsert",
        card: {
          id: `card_${crypto.randomUUID().replaceAll("-", "")}`,
          front: front.trim(),
          back: back.trim(),
          tags: [],
          ...(activeLesson ? { lessonId: activeLesson.id } : {}),
        },
      },
      "card-add",
    );
    setFront("");
    setBack("");
  };

  const importDeck = () => {
    const deck = decks.find((candidate) => candidate.id === deckId);
    if (!deck) return;
    const selection = courseCardsFromAnkiDecks([deck], {
      existingCards: snapshot.course.cards,
      ...(attachImported && activeLesson ? { lessonId: activeLesson.id } : {}),
      tagWithDeck: false,
    });
    if (!selection.cards.length) {
      onError(
        selection.duplicates
          ? "Every card in that deck is already in this course."
          : "That deck has no cards to import.",
      );
      return;
    }
    void mutate(
      {
        ...operationBase(snapshot),
        type: "cards.import",
        cards: selection.cards,
      },
      `deck-import-${deck.id}`,
    );
  };

  const needle = filter.trim().toLowerCase();
  const cards = needle
    ? snapshot.course.cards.filter((card) =>
        `${card.front} ${card.back} ${card.tags.join(" ")}`
          .toLowerCase()
          .includes(needle),
      )
    : snapshot.course.cards;

  return (
    <>
      <SectionHeader
        title="Recall deck"
        description="Cards the course carries with it. Import an Anki deck, write your own, or pull in a deck you already keep in Keating."
      />
      <div className={css({ display: "grid", gap: "0.7rem" })}>
        <AnkiImportPanel
          snapshot={snapshot}
          {...(activeLesson ? { activeLesson } : {})}
          onSnapshot={onSnapshot}
          onError={onError}
        />
        <div
          className={css({
            display: "grid",
            gap: "0.4rem",
            bg: "var(--paper)",
            p: "0.6rem",
          })}
        >
          <TextArea
            value={front}
            onChange={(event) => setFront(event.target.value)}
            rows={2}
            placeholder="New card front"
          />
          <TextArea
            value={back}
            onChange={(event) => setBack(event.target.value)}
            rows={2}
            placeholder="New card back"
          />
          <Button
            type="button"
            variant="line"
            disabled={!front.trim() || !back.trim() || saving === "card-add"}
            onClick={() => void addCard()}
          >
            <KeatingGlyph name="plus" size={13} /> Add card{activeLesson ? " to this lesson" : ""}
          </Button>
        </div>
        {decks.length ? (
          <div
            className={css({
              display: "grid",
              gap: "0.4rem",
              bg: "var(--paper)",
              p: "0.6rem",
            })}
          >
            <Select
              value={deckId}
              onValueChange={(value) => setDeckId(value)}
              className="k-input"
              aria-label="Saved deck to import"
            >
              <option value="">Choose one of your saved decks…</option>
              {decks.map((deck) => (
                <option key={deck.id} value={deck.id}>
                  {deck.title} ({deck.cards.length})
                </option>
              ))}
            </Select>
            {activeLesson ? (
              <label
                className={css({
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  fontSize: "0.74rem",
                })}
              >
                <input
                  type="checkbox"
                  checked={attachImported}
                  onChange={(event) => setAttachImported(event.target.checked)}
                />
                Attach imported cards to this lesson
              </label>
            ) : null}
            <Button
              type="button"
              variant="line"
              disabled={!deckId || saving.startsWith("deck-import-")}
              onClick={importDeck}
            >
              <KeatingGlyph name="import" size={12} /> Import saved deck
            </Button>
          </div>
        ) : null}
        {snapshot.course.cards.length > 6 ? (
          <TextInput
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter cards…"
            aria-label="Filter cards"
          />
        ) : null}
        {cards.length ? (
          <div className={css({ display: "grid", gap: "0.35rem" })}>
            {cards.map((card) => (
              <CardEditor
                key={card.id}
                snapshot={snapshot}
                card={card}
                saving={saving}
                mutate={mutate}
              />
            ))}
          </div>
        ) : (
          <EmptyState heading={snapshot.course.cards.length
              ? "No card matches that filter."
              : "No cards yet."} />
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------- access */

function AccessSection({
  snapshot,
  saving,
  mutate,
  onInvite,
}: {
  snapshot: CourseViewerSnapshot;
  saving: string;
  mutate: Mutate;
  onInvite(): void;
}) {
  const { course, viewer, permissions } = snapshot;
  const isOwner = viewer.role === "owner";
  const setSettings = (patch: Partial<typeof course.settings>) =>
    void mutate(
      { ...operationBase(snapshot), type: "course.update", patch: { settings: patch } },
      "course-settings",
    );
  return (
    <>
      <SectionHeader
        title="People and permissions"
        description="Who is in the room, what peers may change, and what stays private until a learner says otherwise."
        actions={
          permissions.canInvite ? (
            <Button
              type="button"
              variant="primary"
              onClick={onInvite}
            >
              <KeatingGlyph name="share" size={13} /> Invite
            </Button>
          ) : undefined
        }
      />
      <div className={css({ display: "grid", gap: "0.7rem", maxW: "46rem" })}>
        <div className={cx("cb-card", css({ p: "0.7rem" }))}>
          <Eyebrow>Collaboration rules</Eyebrow>
          <div className={css({ mt: "0.5rem", display: "grid", gap: "0.5rem" })}>
            <Switch label="Peers can comment and react" checked={course.settings.allowPeerComments}
              disabled={saving === "course-settings"} onChange={allowPeerComments => setSettings({allowPeerComments})}/>
            <Switch label="Peers can edit the recall deck" checked={course.settings.allowPeerDeckEdits}
              disabled={saving === "course-settings"} onChange={allowPeerDeckEdits => setSettings({allowPeerDeckEdits})}/>
            <label className={css({ fontSize: "0.8rem" })}>
              <FieldLabel>Teacher access policy</FieldLabel>
              <Select
                value={course.settings.teacherAccessPolicy}
                disabled={saving === "course-settings"}
                onValueChange={(value) =>
                  setSettings({
                    teacherAccessPolicy: value as typeof course.settings.teacherAccessPolicy,
                  })
                }
                className="k-input"
              >
                <option value="request">
                  Ask each learner before reading their work
                </option>
                <option value="required-on-enrollment">
                  Require full access when joining
                </option>
              </Select>
            </label>
          </div>
        </div>
        <div className="cb-card">
          <p className={cx("k-eyebrow", css({ px: "0.7rem", pt: "0.6rem" }))}>
            Members · {course.members.length}
          </p>
          <div className={css({ mt: "0.35rem" })}>
            {course.members.map((member) => (
              <div
                key={member.accountId}
                className={css({
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) auto",
                  alignItems: "center",
                  gap: "0.5rem",
                  borderTop: "1px solid color-mix(in srgb, var(--ink) 18%, transparent)",
                  px: "0.7rem",
                  py: "0.5rem",
                })}
              >
                <span className={css({ minW: 0 })}>
                  <strong
                    className={css({
                      display: "block",
                      overflowWrap: "anywhere",
                      fontSize: "0.82rem",
                    })}
                  >
                    {member.accountId === viewer.accountId
                      ? `${member.displayName} (you)`
                      : member.displayName}
                  </strong>
                  <small className={css({ color: "var(--ink-soft)" })}>
                    teacher access: {member.teacherAccess}
                  </small>
                </span>
                {isOwner && member.role !== "owner" ? (
                  <Select
                    value={member.role}
                    disabled={saving === `role-${member.accountId}`}
                    className={cx("k-input", css({ w: "auto" }))}
                    aria-label={`Role for ${member.displayName}`}
                    onValueChange={(value) =>
                      void mutate(
                        {
                          ...operationBase(snapshot),
                          type: "member.role.update",
                          memberAccountId: member.accountId,
                          role: value as
                            | "teacher"
                            | "student"
                            | "peer",
                        },
                        `role-${member.accountId}`,
                      )
                    }
                  >
                    <option value="teacher">teacher</option>
                    <option value="student">student</option>
                    <option value="peer">peer</option>
                  </Select>
                ) : (
                  <span
                    className={css({
                      fontFamily: "var(--mono-display)",
                      fontSize: "0.66rem",
                      textTransform: "uppercase",
                      color: "var(--ink-soft)",
                    })}
                  >
                    {member.role}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ builder */

/**
 * The single place a course is edited. Everything that used to live in a
 * collapsed strip above the desk and a second copy in the right rail is here,
 * one section at a time.
 */
export function CourseBuilder({
  snapshot,
  activeLesson,
  section: requestedSection,
  error,
  saving,
  onSectionChange,
  mutate,
  onSnapshot,
  onSelectLesson,
  onInvite,
  onError,
}: BuilderProps) {
  const section = requestedSection === "lesson" ? "outline" : requestedSection;
  const [removal, setRemoval] = useState<{message: string; remove(): void}>();
  const [mobile, setMobile] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [localError, setLocalError] = useState("");
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => { setLocalError(""); setSheetOpen(requestedSection === "lesson"); }, [requestedSection]);
  const reportError = (message: string) => { setLocalError(message); onError(message); };
  useEffect(() => { setLocalError(""); }, [saving, snapshot.course.revision]);
  const canEdit = snapshot.permissions.canEditCourse;
  const canCards = snapshot.permissions.canEditDeck;
  const lessonCount = useMemo(
    () =>
      snapshot.course.modules.reduce(
        (count, module) => count + module.lessons.length,
        0,
      ),
    [snapshot.course.modules],
  );

  const sections = useMemo(() => {
    const items: { id: CourseBuilderSection; label: string; count?: number }[] =
      [];
    if (canEdit) {
      items.push(
        { id: "details", label: "Details" },
        { id: "outline", label: "Outline", count: lessonCount },
        { id: "documents", label: "Documents", count: snapshot.course.materials.length },
        {
          id: "assignments",
          label: "Assignments",
          count: snapshot.course.assignments.length,
        },
        {
          id: "artifacts",
          label: "Artifacts",
          count: snapshot.course.artifacts.length,
        },
      );
    }
    if (canCards)
      items.push({
        id: "cards",
        label: "Cards",
        count: snapshot.course.cards.length,
      });
    if (canEdit)
      items.push({
        id: "access",
        label: "People",
        count: snapshot.course.members.length,
      });
    return items;
  }, [
    canCards,
    canEdit,
    lessonCount,
    snapshot.course.artifacts.length,
    snapshot.course.assignments.length,
    snapshot.course.cards.length,
    snapshot.course.materials.length,
    snapshot.course.members.length,
  ]);

  useEffect(() => {
    if (!sections.length) return;
    if (!sections.some((item) => item.id === section))
      onSectionChange(sections[0]!.id);
  }, [onSectionChange, section, sections]);

  if (!sections.length) return null;

  const icons = {details:"info", outline:"tree", lesson:"book", documents:"doc", assignments:"checklist", artifacts:"shapes", cards:"layers", access:"people"} as const;
  const editor = activeLesson && <LessonSection key={activeLesson.id} lesson={activeLesson} snapshot={snapshot} saving={saving} mutate={mutate}
    {...(mobile ? {sheet:{open:sheetOpen, close:() => setSheetOpen(false)}} : {})}
    {...(error ? {error} : {})}
    onSectionChange={onSectionChange} attach={<CourseAddMenu triggerLabel="Attach" activeLessonId={activeLesson.id} snapshot={snapshot} saving={saving}
      mutate={mutate} onSnapshot={onSnapshot} onError={reportError} onOpenBuilder={onSectionChange}/>}/>;
  return (
    <RemovalContext.Provider value={(message, remove) => setRemoval({message, remove})}>
    <div className="cb-builder">
      <header className="cb-toolbar">
        <span className="cb-last-save" role="status"><StatusDot tone={saving ? "idle" : "ok"}/>
          {saving ? "Saving…" : <>Saved <time dateTime={snapshot.course.updatedAt}>{new Date(snapshot.course.updatedAt).toLocaleTimeString([], {hour:"numeric", minute:"2-digit"})}</time></>}
        </span>
        {canEdit && <Note data-glyph-host glyph="verified" className="cb-review"><CourseJudgementPanel snapshot={snapshot}/></Note>}
      </header>
      <div className="cb-layout">
        <nav aria-label="Course builder sections" className="cb-nav">
          {sections.map(item => <button type="button" key={item.id} aria-current={section === item.id ? "page" : undefined}
            onClick={() => onSectionChange(item.id)}><KeatingGlyph name={icons[item.id]} size={14}/>{item.label}
            {item.count !== undefined && <small>{item.count}</small>}</button>)}
        </nav>
        <div className="cb-body" data-outline={section === "outline" && Boolean(editor)}>
        <section className="cb-work">
        {(error || localError) && <Note role="alert">{error || localError}</Note>}
      {section === "details" && canEdit ? (
        <DetailsSection snapshot={snapshot} saving={saving} mutate={mutate} />
      ) : null}
      {section === "outline" && canEdit ? (
        <OutlineSection
          snapshot={snapshot}
          {...(activeLesson ? { activeLesson } : {})}
          saving={saving}
          mutate={mutate}
          onSelectLesson={id => { onSelectLesson(id); setSheetOpen(mobile); }}
        />
      ) : null}
      {section === "documents" && canEdit ? (
        <DocumentsSection
          snapshot={snapshot}
          {...(activeLesson ? { activeLesson } : {})}
          saving={saving}
          mutate={mutate}
          onSnapshot={onSnapshot}
          onError={reportError}
        />
      ) : null}
      {section === "assignments" && canEdit ? (
        <>
          <SectionHeader
            title="Long-range assignments"
            description="Work that spans lessons: what to make, what counts as done, and when it is due."
          />
          <AssignmentManager
            snapshot={snapshot}
            {...(activeLesson ? { activeLessonId: activeLesson.id } : {})}
            saving={saving}
            mutate={mutate}
          />
        </>
      ) : null}
      {section === "artifacts" && canEdit ? (
        <>
          <SectionHeader
            title="Quizzes, visuals, and artifacts"
            description="Author a quiz here, or pull in work you and Keating already made elsewhere in Keating."
          />
          <ArtifactManager
            snapshot={snapshot}
            {...(activeLesson ? { activeLessonId: activeLesson.id } : {})}
            saving={saving}
            mutate={mutate}
          />
        </>
      ) : null}
      {section === "cards" && canCards ? (
        <CardsSection
          snapshot={snapshot}
          {...(activeLesson ? { activeLesson } : {})}
          saving={saving}
          mutate={mutate}
          onSnapshot={onSnapshot}
          onError={reportError}
        />
      ) : null}
      {section === "access" && canEdit ? (
        <AccessSection
          snapshot={snapshot}
          saving={saving}
          mutate={mutate}
          onInvite={onInvite}
        />
      ) : null}
        </section>
        {requestedSection === "lesson" && !activeLesson && canEdit && <LessonSection attach={null} snapshot={snapshot} saving={saving} mutate={mutate} onSectionChange={onSectionChange}/>}
        {section === "outline" && canEdit && editor}
        </div>
      </div>
      {removal && <ConfirmDialog open title="Confirm removal" description={removal.message} confirmLabel="Remove"
        onCancel={() => setRemoval(undefined)} onConfirm={() => { setRemoval(undefined); removal.remove(); }}/>}
    </div>
    </RemovalContext.Provider>
  );
}

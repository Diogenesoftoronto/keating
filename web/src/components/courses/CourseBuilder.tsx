import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  BookUp,
  CreditCard,
  ExternalLink,
  FilePlus2,
  FileQuestion,
  FileText,
  Image as ImageIcon,
  Layers3,
  Link2,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Shapes,
  Share2,
  SlidersHorizontal,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
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
import {
  courseButtonClass,
  courseCardClass,
  courseCountChipClass,
  courseDangerButtonClass,
  courseEmptyClass,
  courseInputClass,
  courseLabelClass,
  coursePrimaryButtonClass,
} from "./course-ui";

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

function confirmRemoval(message: string): boolean {
  return typeof window === "undefined" || window.confirm(message);
}

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
    <div
      className={css({
        display: "flex",
        flexWrap: "wrap",
        alignItems: "end",
        justifyContent: "space-between",
        gap: "0.75rem",
        mb: "0.9rem",
      })}
    >
      <div>
        <h3
          className={css({
            fontFamily: "Georgia, serif",
            fontSize: "1.4rem",
            lineHeight: 1.15,
          })}
        >
          {title}
        </h3>
        <p
          className={css({
            mt: "0.25rem",
            maxW: "58ch",
            fontSize: "0.8rem",
            lineHeight: 1.5,
            color: "var(--ink-soft)",
          })}
        >
          {description}
        </p>
      </div>
      {actions ? (
        <div className={css({ display: "flex", gap: "0.4rem" })}>{actions}</div>
      ) : null}
    </div>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className={cx(courseLabelClass, css({ display: "block", mb: "0.25rem" }))}>
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
          <input
            value={title}
            maxLength={240}
            onChange={(event) => setTitle(event.target.value)}
            className={courseInputClass}
          />
        </label>
        <label>
          <FieldLabel>Description</FieldLabel>
          <textarea
            value={description}
            maxLength={4_000}
            rows={4}
            onChange={(event) => setDescription(event.target.value)}
            className={courseInputClass}
            placeholder="Who it is for, what it covers, and where it ends."
          />
        </label>
        <label>
          <FieldLabel>Outcomes · one per line</FieldLabel>
          <textarea
            value={outcomes}
            rows={5}
            onChange={(event) => setOutcomes(event.target.value)}
            className={courseInputClass}
            placeholder={"Distinguish intervention from observation\nCritique a causal diagram"}
          />
        </label>
        <div className={css({ display: "flex", justifyContent: "flex-end" })}>
          <button
            type="button"
            className={cx(courseButtonClass, coursePrimaryButtonClass)}
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
            <Save size={13} />
            {saving === "course-details" ? "Saving…" : "Save course details"}
          </button>
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
    <section className={courseCardClass}>
      <header
        className={css({
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
          borderBottom: "1px solid var(--ink)",
          bg: "var(--paper-deep, #e9e2d2)",
          px: "0.7rem",
          py: "0.5rem",
        })}
      >
        <span
          className={css({
            display: "inline-flex",
            alignItems: "center",
            gap: "0.45rem",
            fontSize: "0.85rem",
            fontWeight: 800,
          })}
        >
          <Layers3 size={14} /> {module.title}
          <span className={courseCountChipClass}>{module.lessons.length}</span>
        </span>
        <span className={css({ display: "flex", gap: "0.3rem" })}>
          <button
            type="button"
            className={courseButtonClass}
            onClick={() => setEditing((value) => !value)}
          >
            <Settings2 size={12} /> {editing ? "Done" : "Rename"}
          </button>
          <button
            type="button"
            className={cx(courseButtonClass, courseDangerButtonClass)}
            onClick={() => {
              if (confirmRemoval(`Remove “${module.title}” and its lessons?`))
                void mutate(
                  {
                    ...operationBase(snapshot),
                    type: "module.delete",
                    moduleId: module.id,
                  },
                  `module-delete-${module.id}`,
                );
            }}
          >
            <Trash2 size={12} />
          </button>
        </span>
      </header>
      {editing ? (
        <div
          className={css({
            display: "grid",
            gap: "0.4rem",
            borderBottom: "1px solid var(--ink)",
            bg: "var(--paper)",
            p: "0.6rem",
          })}
        >
          <input
            value={title}
            maxLength={240}
            onChange={(event) => setTitle(event.target.value)}
            className={courseInputClass}
            aria-label="Module title"
          />
          <textarea
            value={description}
            maxLength={2_000}
            rows={2}
            onChange={(event) => setDescription(event.target.value)}
            className={courseInputClass}
            placeholder="What this module is for"
            aria-label="Module description"
          />
          <button
            type="button"
            className={courseButtonClass}
            disabled={!title.trim() || saving === `module-${module.id}`}
            onClick={() => void saveModule().then(() => setEditing(false))}
          >
            <Save size={12} /> Save module
          </button>
        </div>
      ) : null}
      <ol className={css({ listStyle: "none" })}>
        {module.lessons.map((lesson, index) => (
          <li
            key={lesson.id}
            className={css({
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto",
              alignItems: "center",
              gap: "0.5rem",
              borderBottom: "1px solid color-mix(in srgb, var(--ink) 18%, transparent)",
              px: "0.6rem",
              py: "0.45rem",
            })}
            style={
              lesson.id === activeLessonId
                ? { background: "var(--course-wash, #ddebdd)" }
                : undefined
            }
          >
            <button
              type="button"
              className={css({
                display: "flex",
                minW: 0,
                alignItems: "center",
                gap: "0.45rem",
                textAlign: "left",
                cursor: "pointer",
              })}
              onClick={() => onSelectLesson(lesson.id)}
            >
              <span
                className={css({
                  fontFamily: "var(--mono-display)",
                  fontSize: "0.65rem",
                  color: "var(--ink-soft)",
                })}
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <span
                className={css({
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontSize: "0.82rem",
                  fontWeight: 650,
                })}
              >
                {lesson.title}
              </span>
            </button>
            <span className={css({ display: "flex", gap: "0.15rem" })}>
              <button
                type="button"
                aria-label={`Move ${lesson.title} up`}
                className={courseButtonClass}
                disabled={index === 0 || saving === `module-order-${module.id}`}
                onClick={() => move(index, -1)}
              >
                <ArrowUp size={12} />
              </button>
              <button
                type="button"
                aria-label={`Move ${lesson.title} down`}
                className={courseButtonClass}
                disabled={
                  index === module.lessons.length - 1 ||
                  saving === `module-order-${module.id}`
                }
                onClick={() => move(index, 1)}
              >
                <ArrowDown size={12} />
              </button>
              <button
                type="button"
                aria-label={`Remove ${lesson.title}`}
                className={cx(courseButtonClass, courseDangerButtonClass)}
                onClick={() => {
                  if (
                    confirmRemoval(
                      `Remove “${lesson.title}”? Its notes, work, and discussion go with it.`,
                    )
                  )
                    void mutate(
                      {
                        ...operationBase(snapshot),
                        type: "lesson.delete",
                        moduleId: module.id,
                        lessonId: lesson.id,
                      },
                      `lesson-delete-${lesson.id}`,
                    );
                }}
              >
                <Trash2 size={12} />
              </button>
            </span>
          </li>
        ))}
      </ol>
      <div
        className={css({
          display: "flex",
          alignItems: "stretch",
          gap: "0.35rem",
          p: "0.6rem",
        })}
      >
        <input
          value={lessonTitle}
          maxLength={240}
          onChange={(event) => setLessonTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void addLesson();
          }}
          className={courseInputClass}
          placeholder={`New lesson in ${module.title}`}
          aria-label={`New lesson in ${module.title}`}
        />
        <button
          type="button"
          className={courseButtonClass}
          disabled={!lessonTitle.trim() || saving === `lesson-add-${module.id}`}
          onClick={() => void addLesson()}
        >
          <Plus size={12} /> Lesson
        </button>
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
      <div
        className={css({
          display: "flex",
          alignItems: "stretch",
          gap: "0.35rem",
          mb: "0.85rem",
          maxW: "34rem",
        })}
      >
        <input
          value={moduleTitle}
          maxLength={240}
          onChange={(event) => setModuleTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void addModule();
          }}
          className={courseInputClass}
          placeholder="New module title"
          aria-label="New module title"
        />
        <button
          type="button"
          className={cx(courseButtonClass, coursePrimaryButtonClass)}
          disabled={!moduleTitle.trim() || saving === "module-add"}
          onClick={() => void addModule()}
        >
          <Plus size={13} /> Module
        </button>
      </div>
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
        <p className={courseEmptyClass}>
          A blank course is valid. Add the first module when the shape is clear —
          or add documents, assignments, and cards first and shape the outline
          around them.
        </p>
      )}
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
}: {
  snapshot: CourseViewerSnapshot;
  lesson?: CourseLesson;
  saving: string;
  mutate: Mutate;
  onSectionChange(section: CourseBuilderSection): void;
}) {
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
  useEffect(() => {
    setTitle(lesson?.title ?? "");
    setSummary(lesson?.summary ?? "");
    setMinutes(lesson?.estimatedMinutes ? String(lesson.estimatedMinutes) : "");
    setReading(lesson?.reading ?? "");
    setObjectives(lesson?.objectives.join("\n") ?? "");
    setHasQuestion(Boolean(lesson?.exercise));
    setPrompt(lesson?.exercise?.prompt ?? "");
    setPlaceholder(lesson?.exercise?.placeholder ?? "");
    setRubric(lesson?.exercise?.rubric.join("\n") ?? "");
  }, [lesson]);

  if (!lesson || !module) {
    return (
      <>
        <SectionHeader
          title="No lesson open"
          description="Choose a lesson in the outline to edit its reading, objectives, and practice question."
        />
        <button
          type="button"
          className={courseButtonClass}
          onClick={() => onSectionChange("outline")}
        >
          <Layers3 size={13} /> Go to the outline
        </button>
      </>
    );
  }

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

  return (
    <>
      <SectionHeader
        title={lesson.title}
        description={`In ${module.title}. Everything a learner reads and answers on the desk.`}
        actions={
          <button
            type="button"
            className={cx(courseButtonClass, courseDangerButtonClass)}
            onClick={() => {
              if (
                confirmRemoval(
                  `Remove “${lesson.title}”? Its notes, work, and discussion go with it.`,
                )
              )
                void mutate(
                  {
                    ...operationBase(snapshot),
                    type: "lesson.delete",
                    moduleId: module.id,
                    lessonId: lesson.id,
                  },
                  `lesson-delete-${lesson.id}`,
                );
            }}
          >
            <Trash2 size={12} /> Remove lesson
          </button>
        }
      />
      <div className={css({ display: "grid", gap: "0.75rem", maxW: "48rem" })}>
        <div
          className={css({
            display: "grid",
            gap: "0.6rem",
            sm: { gridTemplateColumns: "minmax(0, 1fr) 9rem" },
          })}
        >
          <label>
            <FieldLabel>Title</FieldLabel>
            <input
              value={title}
              maxLength={240}
              onChange={(event) => setTitle(event.target.value)}
              className={courseInputClass}
            />
          </label>
          <label>
            <FieldLabel>Minutes</FieldLabel>
            <input
              type="number"
              min="1"
              max="1440"
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
              className={courseInputClass}
              placeholder="Self paced"
            />
          </label>
        </div>
        <label>
          <FieldLabel>Summary</FieldLabel>
          <textarea
            value={summary}
            maxLength={2_000}
            rows={2}
            onChange={(event) => setSummary(event.target.value)}
            className={courseInputClass}
            placeholder="One sentence a learner reads under the title."
          />
        </label>
        <label>
          <FieldLabel>Objectives · one per line</FieldLabel>
          <textarea
            value={objectives}
            rows={3}
            onChange={(event) => setObjectives(event.target.value)}
            className={courseInputClass}
          />
        </label>
        <label>
          <FieldLabel>Reading</FieldLabel>
          <textarea
            value={reading}
            maxLength={120_000}
            rows={12}
            onChange={(event) => setReading(event.target.value)}
            className={cx(courseInputClass, css({ lineHeight: 1.6 }))}
            placeholder="The lesson itself: explanation, worked examples, instructions."
          />
        </label>
        <div className={cx(courseCardClass, css({ p: "0.7rem" }))}>
          <div
            className={css({
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.5rem",
            })}
          >
            <span
              className={css({
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                fontSize: "0.8rem",
                fontWeight: 750,
              })}
            >
              <FileQuestion size={14} /> Practice question
            </span>
            <button
              type="button"
              className={courseButtonClass}
              onClick={() => setHasQuestion((value) => !value)}
            >
              {hasQuestion ? "Remove question" : "Add question"}
            </button>
          </div>
          {hasQuestion ? (
            <div className={css({ mt: "0.55rem", display: "grid", gap: "0.4rem" })}>
              <textarea
                value={prompt}
                maxLength={30_000}
                rows={4}
                onChange={(event) => setPrompt(event.target.value)}
                className={courseInputClass}
                placeholder="What should the learner work out here?"
              />
              <input
                value={placeholder}
                maxLength={240}
                onChange={(event) => setPlaceholder(event.target.value)}
                className={courseInputClass}
                placeholder="Answer field hint (optional)"
              />
              <textarea
                value={rubric}
                rows={3}
                onChange={(event) => setRubric(event.target.value)}
                className={courseInputClass}
                placeholder="One rubric point per line"
              />
            </div>
          ) : (
            <p
              className={css({
                mt: "0.4rem",
                fontSize: "0.75rem",
                color: "var(--ink-soft)",
              })}
            >
              This lesson has no question. Add one when practice belongs here.
            </p>
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
          <span
            className={css({
              display: "flex",
              flexWrap: "wrap",
              gap: "0.4rem",
              fontSize: "0.72rem",
              color: "var(--ink-soft)",
            })}
          >
            <button
              type="button"
              className={courseButtonClass}
              onClick={() => onSectionChange("documents")}
            >
              <FileText size={12} /> {attachedMaterials} documents
            </button>
            <button
              type="button"
              className={courseButtonClass}
              onClick={() => onSectionChange("artifacts")}
            >
              <Shapes size={12} /> {attachedArtifacts} artifacts
            </button>
            <button
              type="button"
              className={courseButtonClass}
              onClick={() => onSectionChange("assignments")}
            >
              <BookUp size={12} /> {attachedAssignments} assignments
            </button>
            <button
              type="button"
              className={courseButtonClass}
              onClick={() => onSectionChange("cards")}
            >
              <CreditCard size={12} /> {attachedCards} cards
            </button>
          </span>
          <button
            type="button"
            className={cx(courseButtonClass, coursePrimaryButtonClass)}
            disabled={
              !title.trim() ||
              (hasQuestion && !prompt.trim()) ||
              saving === `lesson-edit-${lesson.id}`
            }
            onClick={() => void save()}
          >
            <Save size={13} />
            {saving === `lesson-edit-${lesson.id}` ? "Saving…" : "Save lesson"}
          </button>
        </div>
      </div>
    </>
  );
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
  const Icon =
    material.kind === "image"
      ? ImageIcon
      : material.kind === "link"
        ? Link2
        : FileText;

  return (
    <div className={courseCardClass}>
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
        <Icon size={15} />
        <button
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
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
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
        </button>
        <span className={css({ display: "flex", gap: "0.25rem" })}>
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${material.title}`}
            className={cx(courseButtonClass, css({ color: "inherit", textDecoration: "none" }))}
          >
            <ExternalLink size={12} />
          </a>
          <button
            type="button"
            className={courseButtonClass}
            onClick={() => setOpen((value) => !value)}
          >
            <Settings2 size={12} />
          </button>
        </span>
      </div>
      {open ? (
        <div
          className={css({
            display: "grid",
            gap: "0.4rem",
            borderTop: "1px solid var(--ink)",
            bg: "var(--paper)",
            p: "0.6rem",
          })}
        >
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className={courseInputClass}
            aria-label={`Title for ${material.title}`}
          />
          <select
            value={lessonId}
            onChange={(event) => setLessonId(event.target.value)}
            className={courseInputClass}
            aria-label={`Attach ${material.title} to a lesson`}
          >
            <option value="">Course-wide</option>
            {lessons.map((lesson) => (
              <option key={lesson.id} value={lesson.id}>
                {lesson.title}
              </option>
            ))}
          </select>
          <div
            className={css({
              display: "flex",
              justifyContent: "space-between",
              gap: "0.4rem",
            })}
          >
            <button
              type="button"
              className={courseButtonClass}
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
              <Save size={12} /> Save
            </button>
            <button
              type="button"
              className={cx(courseButtonClass, courseDangerButtonClass)}
              disabled={busy}
              onClick={() => {
                if (!confirmRemoval(`Remove “${material.title}”?`)) return;
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
              }}
            >
              <Trash2 size={12} /> Remove
            </button>
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
          className={css({
            display: "grid",
            gap: "0.5rem",
            border: "2px dashed color-mix(in srgb, var(--ink) 45%, transparent)",
            bg: "var(--paper)",
            p: "1rem",
            textAlign: "center",
          })}
          style={
            dragging
              ? {
                  borderColor: "var(--course-green, #1e9b50)",
                  background: "var(--course-wash, #ddebdd)",
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
          <p className={css({ fontSize: "0.85rem", fontWeight: 700 })}>
            {busy ? "Uploading…" : "Drop a file here, or choose one"}
          </p>
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
            <button
              type="button"
              className={cx(courseButtonClass, coursePrimaryButtonClass)}
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {busy ? <RefreshCw size={13} /> : <Upload size={13} />} Choose file
            </button>
            <select
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              className={cx(courseInputClass, css({ w: "auto", maxW: "16rem" }))}
              aria-label="Attach new sources to"
            >
              <option value="">Course-wide</option>
              {lessons.map((lesson) => (
                <option key={lesson.id} value={lesson.id}>
                  Attach to: {lesson.title}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div
          className={css({
            display: "grid",
            gap: "0.4rem",
            border: "1px solid var(--ink)",
            bg: "var(--paper)",
            p: "0.6rem",
            sm: { gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) auto" },
          })}
        >
          <input
            value={linkTitle}
            onChange={(event) => setLinkTitle(event.target.value)}
            className={courseInputClass}
            placeholder="Link title"
            aria-label="Link title"
          />
          <input
            value={linkUrl}
            type="url"
            onChange={(event) => setLinkUrl(event.target.value)}
            className={courseInputClass}
            placeholder="https://…"
            aria-label="Link address"
          />
          <button
            type="button"
            className={courseButtonClass}
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
            <Link2 size={13} /> Add link
          </button>
        </div>
        {snapshot.course.materials.length > 4 ? (
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className={courseInputClass}
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
          <p className={courseEmptyClass}>
            {snapshot.course.materials.length
              ? "No source matches that filter."
              : "No documents, images, or links yet."}
          </p>
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
    <details className={courseCardClass}>
      <summary
        className={css({
          cursor: "pointer",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
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
          borderTop: "1px solid var(--ink)",
          p: "0.6rem",
        })}
      >
        <textarea
          value={front}
          onChange={(event) => setFront(event.target.value)}
          className={courseInputClass}
          rows={2}
          placeholder="Front"
        />
        <textarea
          value={back}
          onChange={(event) => setBack(event.target.value)}
          className={courseInputClass}
          rows={3}
          placeholder="Back"
        />
        <input
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          className={courseInputClass}
          placeholder="tags, separated, by commas"
        />
        <select
          value={lessonId}
          onChange={(event) => setLessonId(event.target.value)}
          className={courseInputClass}
          aria-label="Attach card to lesson"
        >
          <option value="">Course-wide card</option>
          {lessons.map((lesson) => (
            <option key={lesson.id} value={lesson.id}>
              {lesson.title}
            </option>
          ))}
        </select>
        <div
          className={css({
            display: "flex",
            justifyContent: "space-between",
            gap: "0.4rem",
          })}
        >
          <button
            type="button"
            className={courseButtonClass}
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
            <Save size={12} /> Save
          </button>
          <button
            type="button"
            className={cx(courseButtonClass, courseDangerButtonClass)}
            onClick={() => {
              if (confirmRemoval("Remove this card?"))
                void mutate(
                  {
                    ...operationBase(snapshot),
                    type: "card.delete",
                    cardId: card.id,
                  },
                  `card-delete-${card.id}`,
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
      className={css({
        display: "grid",
        minW: 0,
        gap: "0.55rem",
        border: "2px dashed color-mix(in srgb, var(--ink) 45%, transparent)",
        bg: "var(--paper)",
        p: "0.85rem",
      })}
      style={
        dragging
          ? {
              borderColor: "var(--course-green, #1e9b50)",
              background: "var(--course-wash, #ddebdd)",
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
          <strong
            className={css({
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              fontSize: "0.84rem",
            })}
          >
            <Upload size={14} /> Import from Anki
          </strong>
          <small className={css({ color: "var(--ink-soft)" })}>
            Drop an .apkg export here, or a .txt, .tsv, or .csv card file
          </small>
        </span>
        <button
          type="button"
          className={cx(courseButtonClass, coursePrimaryButtonClass)}
          disabled={reading || importing}
          onClick={() => fileRef.current?.click()}
        >
          {reading ? <RefreshCw size={13} /> : <Upload size={13} />}
          {reading ? "Reading…" : "Choose Anki file"}
        </button>
      </div>
      {imported ? (
        <div
          className={css({
            display: "grid",
            gap: "0.5rem",
            border: "1px solid var(--ink)",
            bg: "var(--card)",
            p: "0.65rem",
          })}
        >
          <p
            className={cx(
              courseLabelClass,
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
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    })}
                  >
                    {deck.title}
                  </span>
                </span>
                <span className={courseCountChipClass}>{deck.cards.length}</span>
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
            <button
              type="button"
              className={courseButtonClass}
              disabled={importing}
              onClick={() => {
                setImported(null);
                setChosenDecks(new Set());
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className={cx(courseButtonClass, coursePrimaryButtonClass)}
              disabled={importing || !selection.cards.length}
              onClick={() => void runImport()}
            >
              {importing ? <RefreshCw size={13} /> : <Plus size={13} />}
              {importing
                ? "Importing…"
                : `Add ${selection.cards.length} card${selection.cards.length === 1 ? "" : "s"}`}
            </button>
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
            border: "1px solid var(--ink)",
            bg: "var(--paper)",
            p: "0.6rem",
          })}
        >
          <textarea
            value={front}
            onChange={(event) => setFront(event.target.value)}
            className={courseInputClass}
            rows={2}
            placeholder="New card front"
          />
          <textarea
            value={back}
            onChange={(event) => setBack(event.target.value)}
            className={courseInputClass}
            rows={2}
            placeholder="New card back"
          />
          <button
            type="button"
            className={courseButtonClass}
            disabled={!front.trim() || !back.trim() || saving === "card-add"}
            onClick={() => void addCard()}
          >
            <Plus size={13} /> Add card{activeLesson ? " to this lesson" : ""}
          </button>
        </div>
        {decks.length ? (
          <div
            className={css({
              display: "grid",
              gap: "0.4rem",
              border: "1px solid var(--ink)",
              bg: "var(--paper)",
              p: "0.6rem",
            })}
          >
            <select
              value={deckId}
              onChange={(event) => setDeckId(event.target.value)}
              className={courseInputClass}
              aria-label="Saved deck to import"
            >
              <option value="">Choose one of your saved decks…</option>
              {decks.map((deck) => (
                <option key={deck.id} value={deck.id}>
                  {deck.title} ({deck.cards.length})
                </option>
              ))}
            </select>
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
            <button
              type="button"
              className={courseButtonClass}
              disabled={!deckId || saving.startsWith("deck-import-")}
              onClick={importDeck}
            >
              <Upload size={12} /> Import saved deck
            </button>
          </div>
        ) : null}
        {snapshot.course.cards.length > 6 ? (
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className={courseInputClass}
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
          <p className={courseEmptyClass}>
            {snapshot.course.cards.length
              ? "No card matches that filter."
              : "No cards yet."}
          </p>
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
            <button
              type="button"
              className={cx(courseButtonClass, coursePrimaryButtonClass)}
              onClick={onInvite}
            >
              <Share2 size={13} /> Invite
            </button>
          ) : undefined
        }
      />
      <div className={css({ display: "grid", gap: "0.7rem", maxW: "46rem" })}>
        <div className={cx(courseCardClass, css({ p: "0.7rem" }))}>
          <p className={courseLabelClass}>Collaboration rules</p>
          <div className={css({ mt: "0.5rem", display: "grid", gap: "0.5rem" })}>
            <label
              className={css({
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                fontSize: "0.8rem",
              })}
            >
              <input
                type="checkbox"
                checked={course.settings.allowPeerComments}
                disabled={saving === "course-settings"}
                onChange={(event) =>
                  setSettings({ allowPeerComments: event.target.checked })
                }
              />
              Peers can comment and react
            </label>
            <label
              className={css({
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                fontSize: "0.8rem",
              })}
            >
              <input
                type="checkbox"
                checked={course.settings.allowPeerDeckEdits}
                disabled={saving === "course-settings"}
                onChange={(event) =>
                  setSettings({ allowPeerDeckEdits: event.target.checked })
                }
              />
              Peers can edit the recall deck
            </label>
            <label className={css({ fontSize: "0.8rem" })}>
              <FieldLabel>Teacher access policy</FieldLabel>
              <select
                value={course.settings.teacherAccessPolicy}
                disabled={saving === "course-settings"}
                onChange={(event) =>
                  setSettings({
                    teacherAccessPolicy: event.target
                      .value as typeof course.settings.teacherAccessPolicy,
                  })
                }
                className={courseInputClass}
              >
                <option value="request">
                  Ask each learner before reading their work
                </option>
                <option value="required-on-enrollment">
                  Require full access when joining
                </option>
              </select>
            </label>
          </div>
        </div>
        <div className={courseCardClass}>
          <p className={cx(courseLabelClass, css({ px: "0.7rem", pt: "0.6rem" }))}>
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
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
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
                  <select
                    value={member.role}
                    disabled={saving === `role-${member.accountId}`}
                    className={cx(courseInputClass, css({ w: "auto" }))}
                    aria-label={`Role for ${member.displayName}`}
                    onChange={(event) =>
                      void mutate(
                        {
                          ...operationBase(snapshot),
                          type: "member.role.update",
                          memberAccountId: member.accountId,
                          role: event.target.value as
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
                  </select>
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

const SECTION_ICON: Record<CourseBuilderSection, typeof BookOpen> = {
  details: SlidersHorizontal,
  outline: Layers3,
  lesson: BookOpen,
  documents: FilePlus2,
  assignments: BookUp,
  artifacts: Shapes,
  cards: CreditCard,
  access: Users,
};

/**
 * The single place a course is edited. Everything that used to live in a
 * collapsed strip above the desk and a second copy in the right rail is here,
 * one section at a time.
 */
export function CourseBuilder({
  snapshot,
  activeLesson,
  section,
  saving,
  onSectionChange,
  mutate,
  onSnapshot,
  onSelectLesson,
  onInvite,
  onError,
}: BuilderProps) {
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
        { id: "lesson", label: "Lesson" },
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

  return (
    <div className={css({ mx: "auto", maxW: "60rem" })}>
      <nav
        aria-label="Course builder sections"
        className={css({
          display: "flex",
          flexWrap: "wrap",
          gap: "0.3rem",
          borderBottom: "2px solid var(--ink)",
          pb: "0.7rem",
          mb: "1.1rem",
        })}
      >
        {sections.map((item) => {
          const Icon = SECTION_ICON[item.id];
          const current = item.id === section;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={current}
              onClick={() => onSectionChange(item.id)}
              className={css({
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                border: "1px solid var(--ink)",
                px: "0.6rem",
                py: "0.4rem",
                fontSize: "0.74rem",
                fontWeight: 750,
                cursor: "pointer",
                _hover: { bg: "var(--course-wash, #ddebdd)" },
              })}
              style={
                current
                  ? { background: "var(--ink)", color: "var(--paper)" }
                  : undefined
              }
            >
              <Icon size={13} /> {item.label}
              {typeof item.count === "number" ? (
                <span
                  className={css({
                    fontFamily: "var(--mono-display)",
                    fontSize: "0.62rem",
                    opacity: 0.75,
                  })}
                >
                  {item.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>
      {section === "details" && canEdit ? (
        <DetailsSection snapshot={snapshot} saving={saving} mutate={mutate} />
      ) : null}
      {section === "outline" && canEdit ? (
        <OutlineSection
          snapshot={snapshot}
          {...(activeLesson ? { activeLesson } : {})}
          saving={saving}
          mutate={mutate}
          onSelectLesson={onSelectLesson}
        />
      ) : null}
      {section === "lesson" && canEdit ? (
        <LessonSection
          snapshot={snapshot}
          {...(activeLesson ? { lesson: activeLesson } : {})}
          saving={saving}
          mutate={mutate}
          onSectionChange={onSectionChange}
        />
      ) : null}
      {section === "documents" && canEdit ? (
        <DocumentsSection
          snapshot={snapshot}
          {...(activeLesson ? { activeLesson } : {})}
          saving={saving}
          mutate={mutate}
          onSnapshot={onSnapshot}
          onError={onError}
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
          onError={onError}
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
    </div>
  );
}

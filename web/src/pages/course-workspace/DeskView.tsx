/**
 * The reading desk: the centre column of the course workspace. With a selected
 * lesson it reads top to bottom as one article (header, objectives, reading,
 * sources, worked exercise, assignments, course shelves, shared notes,
 * completion); without one it shows the empty-course desk. Each band is its own
 * small component so the page-level order stays a flat list.
 */
import {
  Check,
  Circle,
  Layers3,
  MessageSquareText,
  PenLine,
  Send,
  StickyNote,
} from "lucide-react";
import { css, cx } from "../../../styled-system/css";
import { CourseDocumentUploadButton } from "../../components/courses/CourseAddMenu";
import type { CourseBuilderSection } from "../../components/courses/CourseBuilder";
import { courseEmptyClass } from "../../components/courses/course-ui";
import type {
  CourseArtifact,
  CourseAssignment,
  CourseLesson,
  CourseMaterial,
  CourseViewerSnapshot,
} from "../../courses/contracts";
import {
  ArtifactWithReactions,
  AssignmentSubmissionCard,
  CourseSourceCard,
} from "./DeskCards";
import type { ToggleReaction, WorkspaceMutate } from "./state";
import { workspaceStyles as s } from "./styles";

export interface DeskViewProps {
  snapshot: CourseViewerSnapshot;
  lesson?: CourseLesson;
  moduleTitle: string;
  completed: boolean;
  mutate: WorkspaceMutate;
  saving: string;
  noteText: string;
  setNoteText(value: string): void;
  sharedNoteVersion: number;
  answer: string;
  setAnswer(value: string): void;
  shareAnswer: boolean;
  setShareAnswer(value: boolean): void;
  threadCount: number;
  onSnapshot(snapshot: CourseViewerSnapshot): void;
  onError(message: string): void;
  onToggleReaction: ToggleReaction;
  onOpenBuilder(section: CourseBuilderSection): void;
  onDiscuss(): void;
  onComplete(): void;
  onSaveNote(): void;
  onSaveAnswer(): void;
}
export function DeskView(props: DeskViewProps) {
  const { snapshot, lesson } = props;
  const { course } = snapshot;
  const courseArtifacts = course.artifacts.filter(
    (artifact) => !artifact.lessonId,
  );
  const courseAssignments = course.assignments.filter(
    (assignment) => !assignment.lessonId,
  );
  const courseMaterials = course.materials.filter(
    (material) => !material.lessonId,
  );

  if (!lesson)
    return (
      <EmptyDesk
        {...props}
        courseMaterials={courseMaterials}
        courseArtifacts={courseArtifacts}
        courseAssignments={courseAssignments}
      />
    );

  const lessonMaterials = course.materials.filter(
    (material) => material.lessonId === lesson.id,
  );
  const lessonArtifacts = course.artifacts.filter(
    (artifact) => artifact.lessonId === lesson.id,
  );
  const lessonAssignments = course.assignments.filter(
    (assignment) => assignment.lessonId === lesson.id,
  );

  return (
    <article className={css({ mx: "auto", maxW: "48rem" })}>
      <LessonHeader {...props} lesson={lesson} />
      <LessonIntro lesson={lesson} />
      <LessonReading
        lesson={lesson}
        canEditCourse={snapshot.permissions.canEditCourse}
      />
      {lessonMaterials.length ? (
        <section className={css({ mt: "2rem" })}>
          <p className={s.sectionLabel}>Lesson sources</p>
          {lessonMaterials.map((material) => (
            <CourseSourceCard
              key={material.id}
              snapshot={snapshot}
              material={material}
              onToggleReaction={props.onToggleReaction}
            />
          ))}
        </section>
      ) : null}
      {lessonArtifacts.map((artifact) => (
        <ArtifactWithReactions
          key={artifact.id}
          snapshot={snapshot}
          artifact={artifact}
          onToggleReaction={props.onToggleReaction}
        />
      ))}
      {lesson.exercise && <WorkedExercise {...props} exercise={lesson.exercise} />}
      {lessonAssignments.map((assignment) => (
        <AssignmentSubmissionCard
          key={assignment.id}
          snapshot={snapshot}
          assignment={assignment}
          mutate={props.mutate}
          saving={props.saving}
          onToggleReaction={props.onToggleReaction}
        />
      ))}
      <CourseWideShelves
        {...props}
        courseAssignments={courseAssignments}
        courseArtifacts={courseArtifacts}
      />
      <SharedNotes {...props} />
      <CompleteLessonBar completed={props.completed} onComplete={props.onComplete} />
    </article>
  );
}

interface CourseWideContent {
  courseMaterials: CourseMaterial[];
  courseArtifacts: CourseArtifact[];
  courseAssignments: CourseAssignment[];
}

/** Desk for a course with no lessons: an invitation to build, plus any course-wide content. */
function EmptyDesk(props: DeskViewProps & CourseWideContent) {
  const { snapshot, courseMaterials, courseArtifacts, courseAssignments } =
    props;
  const { course, permissions } = snapshot;
  return (
    <div className={css({ mx: "auto", maxW: "48rem" })}>
      <p className={s.sectionLabel}>Reading desk</p>
      <h2
        className={css({
          mt: "0.5rem",
          fontFamily: "Georgia, serif",
          fontSize: { base: "2.2rem", md: "3rem" },
          lineHeight: 1.03,
        })}
      >
        Nothing to read yet.
      </h2>
      <p
        className={css({
          mt: "0.9rem",
          maxW: "46ch",
          color: "var(--ink-soft)",
          lineHeight: 1.65,
        })}
      >
        This course has no lessons. That is a valid state — add documents,
        assignments, or cards first and shape the outline around them.
      </p>
      {permissions.canEditCourse ? (
        <div
          className={css({
            mt: "1.25rem",
            display: "flex",
            flexWrap: "wrap",
            gap: "0.5rem",
          })}
        >
          <button
            type="button"
            className={cx(s.button, s.primaryButton)}
            onClick={() => props.onOpenBuilder("outline")}
          >
            <Layers3 size={14} /> Build the outline
          </button>
          <CourseDocumentUploadButton
            courseId={course.id}
            onSnapshot={props.onSnapshot}
            onError={props.onError}
          />
        </div>
      ) : null}
      {courseMaterials.map((material) => (
        <CourseSourceCard
          key={material.id}
          snapshot={snapshot}
          material={material}
          onToggleReaction={props.onToggleReaction}
        />
      ))}
      {courseArtifacts.map((artifact) => (
        <ArtifactWithReactions
          key={artifact.id}
          snapshot={snapshot}
          artifact={artifact}
          onToggleReaction={props.onToggleReaction}
          courseWide
        />
      ))}
      {courseAssignments.map((assignment) => (
        <AssignmentSubmissionCard
          key={assignment.id}
          snapshot={snapshot}
          assignment={assignment}
          mutate={props.mutate}
          saving={props.saving}
          onToggleReaction={props.onToggleReaction}
          courseWide
        />
      ))}
    </div>
  );
}

/** Module/duration label and the discuss / add-document / edit actions. */
function LessonHeader(props: DeskViewProps & { lesson: CourseLesson }) {
  const { snapshot, lesson } = props;
  const { course, permissions } = snapshot;
  return (
    <div
      className={css({
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.5rem",
      })}
    >
      <p className={s.sectionLabel}>
        {props.moduleTitle} ·{" "}
        {lesson.estimatedMinutes
          ? `${lesson.estimatedMinutes} min`
          : "self paced"}
      </p>
      <div className={css({ display: "flex", flexWrap: "wrap", gap: "0.35rem" })}>
        <button type="button" className={s.button} onClick={props.onDiscuss}>
          <MessageSquareText size={13} /> Discuss
          {props.threadCount ? ` · ${props.threadCount}` : ""}
        </button>
        {permissions.canEditCourse ? (
          <>
            <CourseDocumentUploadButton
              courseId={course.id}
              lessonId={lesson.id}
              onSnapshot={props.onSnapshot}
              onError={props.onError}
              label="Add document"
            />
            <button
              type="button"
              className={s.button}
              onClick={() => props.onOpenBuilder("lesson")}
            >
              <PenLine size={13} /> Edit
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Title, summary, and "By the end" objectives. */
function LessonIntro({ lesson }: { lesson: CourseLesson }) {
  return (
    <>
      <h2
        className={css({
          mt: "0.75rem",
          maxW: "18ch",
          fontFamily: "Georgia, serif",
          fontSize: { base: "2.35rem", md: "3.35rem" },
          lineHeight: 1.02,
          letterSpacing: "-0.035em",
        })}
      >
        {lesson.title}
      </h2>
      {lesson.summary ? (
        <p
          className={css({
            mt: "0.8rem",
            fontFamily: "Georgia, serif",
            fontSize: "1.15rem",
            fontStyle: "italic",
            color: "var(--ink-soft)",
          })}
        >
          {lesson.summary}
        </p>
      ) : null}
      {lesson.objectives.length > 0 && (
        <div
          className={css({
            mt: "1.5rem",
            borderLeft: "4px solid var(--course-green)",
            bg: "var(--course-wash, #ddebdd)",
            p: "1rem",
          })}
        >
          <p className={s.sectionLabel}>By the end</p>
          <ul
            className={css({
              mt: "0.5rem",
              pl: "1.1rem",
              lineHeight: 1.65,
              listStyle: "square",
            })}
          >
            {lesson.objectives.map((objective) => (
              <li key={objective}>{objective}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function LessonReading({
  lesson,
  canEditCourse,
}: {
  lesson: CourseLesson;
  canEditCourse: boolean;
}) {
  if (!lesson.reading.trim())
    return (
      <p className={cx(courseEmptyClass, css({ mt: "1.5rem" }))}>
        This lesson has no reading yet.
        {canEditCourse ? " Open Build → Lesson to write it." : ""}
      </p>
    );
  return (
    <div
      className={css({
        mt: "2rem",
        fontFamily: "Georgia, serif",
        fontSize: { base: "1.08rem", md: "1.17rem" },
        lineHeight: 1.85,
        "& p + p": { mt: "1.25rem" },
      })}
    >
      {lesson.reading.split(/\n\n+/).map((paragraph) => (
        <p key={paragraph.slice(0, 32)}>{paragraph}</p>
      ))}
    </div>
  );
}

/** The lesson's exercise prompt with the learner's answer box and save control. */
function WorkedExercise({
  exercise,
  ...props
}: DeskViewProps & { exercise: NonNullable<CourseLesson["exercise"]> }) {
  return (
    <section
      className={css({
        mt: "2.5rem",
        border: "2px solid var(--ink)",
        bg: "var(--paper)",
        boxShadow: "5px 5px 0 var(--amber, #e8a33d)",
      })}
    >
      <header
        className={css({
          borderBottom: "1px solid var(--ink)",
          px: "1rem",
          py: "0.65rem",
        })}
      >
        <p className={s.sectionLabel}>Worked exercise</p>
      </header>
      <div className={css({ p: "1rem" })}>
        <p
          className={css({
            fontFamily: "Georgia, serif",
            fontSize: "1.1rem",
            lineHeight: 1.6,
          })}
        >
          {exercise.prompt}
        </p>
        <textarea
          value={props.answer}
          onChange={(event) => props.setAnswer(event.target.value)}
          placeholder={exercise.placeholder}
          rows={7}
          className={cx(
            s.input,
            css({ mt: "1rem", resize: "vertical", lineHeight: 1.55 }),
          )}
        />
        <div
          className={css({
            mt: "0.75rem",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.75rem",
          })}
        >
          <label
            className={css({
              display: "inline-flex",
              alignItems: "center",
              gap: "0.45rem",
              fontSize: "0.78rem",
            })}
          >
            <input
              type="checkbox"
              checked={props.shareAnswer}
              onChange={(event) => props.setShareAnswer(event.target.checked)}
            />
            Share with peers
          </label>
          <button
            type="button"
            className={cx(s.button, s.primaryButton)}
            disabled={!props.answer.trim() || props.saving === "answer"}
            onClick={props.onSaveAnswer}
          >
            <Send size={14} />{" "}
            {props.saving === "answer" ? "Saving…" : "Save work"}
          </button>
        </div>
      </div>
    </section>
  );
}

/** Collapsible shelves for assignments and artifacts that belong to the whole course. */
function CourseWideShelves(
  props: DeskViewProps &
    Pick<CourseWideContent, "courseAssignments" | "courseArtifacts">,
) {
  const { snapshot, courseAssignments, courseArtifacts } = props;
  const shelf = css({
    mt: "2rem",
    borderTop: "2px solid var(--ink)",
    pt: "1rem",
  });
  const summary = css({
    cursor: "pointer",
    fontFamily: "Georgia, serif",
    fontSize: "1.2rem",
    fontWeight: 700,
  });
  return (
    <>
      {courseAssignments.length ? (
        <details className={shelf}>
          <summary className={summary}>
            Course-wide assignments · {courseAssignments.length}
          </summary>
          {courseAssignments.map((assignment) => (
            <AssignmentSubmissionCard
              key={assignment.id}
              snapshot={snapshot}
              assignment={assignment}
              mutate={props.mutate}
              saving={props.saving}
              onToggleReaction={props.onToggleReaction}
              courseWide
            />
          ))}
        </details>
      ) : null}
      {courseArtifacts.length ? (
        <details className={shelf}>
          <summary className={summary}>
            Course artifact shelf · {courseArtifacts.length}
          </summary>
          {courseArtifacts.map((artifact) => (
            <ArtifactWithReactions
              key={artifact.id}
              snapshot={snapshot}
              artifact={artifact}
              onToggleReaction={props.onToggleReaction}
              courseWide
            />
          ))}
        </details>
      ) : null}
    </>
  );
}

function SharedNotes(props: DeskViewProps) {
  return (
    <section className={css({ mt: "2.5rem" })}>
      <div
        className={css({
          display: "flex",
          alignItems: "end",
          justifyContent: "space-between",
          gap: "1rem",
        })}
      >
        <div>
          <p className={s.sectionLabel}>
            Shared notes · version {props.sharedNoteVersion}
          </p>
          <h3
            className={css({
              mt: "0.25rem",
              fontFamily: "Georgia, serif",
              fontSize: "1.45rem",
            })}
          >
            The margin everyone can write in.
          </h3>
        </div>
        <StickyNote size={22} />
      </div>
      <textarea
        value={props.noteText}
        onChange={(event) => props.setNoteText(event.target.value)}
        rows={7}
        className={cx(
          s.input,
          css({
            mt: "0.8rem",
            resize: "vertical",
            bg: "#fff9dc",
            lineHeight: 1.55,
          }),
        )}
        placeholder="Add a definition, question, or useful example…"
      />
      <div
        className={css({
          mt: "0.65rem",
          display: "flex",
          justifyContent: "flex-end",
        })}
      >
        <button
          type="button"
          className={s.button}
          disabled={props.saving === "note"}
          onClick={props.onSaveNote}
        >
          {props.saving === "note" ? "Saving…" : "Save shared notes"}
        </button>
      </div>
    </section>
  );
}

function CompleteLessonBar({
  completed,
  onComplete,
}: {
  completed: boolean;
  onComplete(): void;
}) {
  return (
    <div
      className={css({
        mt: "2.5rem",
        display: "flex",
        justifyContent: "flex-end",
        borderTop: "1px solid var(--ink)",
        pt: "1rem",
      })}
    >
      <button
        type="button"
        className={cx(s.button, completed && s.primaryButton)}
        onClick={onComplete}
      >
        {completed ? <Check size={15} /> : <Circle size={15} />}
        {completed ? "Lesson complete" : "Mark complete"}
      </button>
    </div>
  );
}

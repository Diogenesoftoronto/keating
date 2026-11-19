import { motion } from "motion/react";
import { DURATION, useMotionAllowed } from "../../design-system/motion";
import { Button, Card, Chip, EmptyState, Eyebrow, Prose, TextArea } from "../../design-system/kit";
import { KeatingGlyph } from "../../design-system/glyphs";
/**
 * The reading desk: the centre column of the course workspace. With a selected
 * lesson it reads top to bottom as one article (header, objectives, reading,
 * sources, worked exercise, assignments, course shelves, shared notes,
 * completion); without one it shows the empty-course desk. Each band is its own
 * small component so the page-level order stays a flat list.
 */
import { css } from "../../../styled-system/css";

import type { CourseBuilderSection } from "../../components/courses/CourseBuilder";

import { LessonPrivateFork } from "../../components/private-fork/LessonPrivateFork";
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
  nextAction?: { label: string; run(): void };
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
  const allowMotion = useMotionAllowed();
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
    <motion.article key={lesson.id} className="cw-desk" initial={allowMotion ? { opacity: 0.75 } : false} animate={{ opacity: 1 }} transition={{ duration: allowMotion ? DURATION.quick : 0 }}>
      <LessonHeader {...props} lesson={lesson} />
      <LessonIntro lesson={lesson} />
      <LessonReading
        lesson={lesson}
        canEditCourse={snapshot.permissions.canEditCourse}
      />
      {!lesson.exercise && lesson.reading.trim() && <Card as="section" className="cw-fork">
        <PrivateContinuation snapshot={snapshot} lesson={lesson} />
      </Card>}
      {lessonMaterials.length ? (
        <Card as="section">
          <Eyebrow>Lesson sources</Eyebrow>
          {lessonMaterials.map((material) => (
            <CourseSourceCard
              key={material.id}
              snapshot={snapshot}
              material={material}
              onToggleReaction={props.onToggleReaction}
            />
          ))}
        </Card>
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
      <footer className="cw-completion">
        <Button variant="line" glyph="check" aria-pressed={props.completed} onClick={props.onComplete}>
          {props.completed ? "Lesson complete" : "Mark complete"}
        </Button>
        {props.nextAction && <Button variant="primary" onClick={props.nextAction.run}>{props.nextAction.label}<KeatingGlyph name="right" /></Button>}
      </footer>
    </motion.article>
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
  const { permissions } = snapshot;
  return (
    <div className={css({ mx: "auto", maxW: "48rem" })}>
      <p className={s.sectionLabel}>Reading desk</p>
      <h2 className="cw-empty-title">Nothing to read yet.</h2>
      <EmptyState heading="This course has no lessons.">{permissions.canEditCourse && " Open Build to shape the outline, or use Add for course materials."}
      </EmptyState>
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

function LessonHeader(props: DeskViewProps & { lesson: CourseLesson }) {
  return <header className="cw-lesson-header">
    <Eyebrow>{props.moduleTitle} · {props.lesson.estimatedMinutes ? `${props.lesson.estimatedMinutes} min` : "self paced"}</Eyebrow>
  </header>;
}

function LessonIntro({ lesson }: { lesson: CourseLesson }) {
  return <div className="cw-lesson-intro">
    <h2 tabIndex={-1}>{lesson.title}</h2>
    {lesson.summary && <p>{lesson.summary}</p>}
    {lesson.objectives.length > 0 && <div className="cw-row cw-objectives">
      <Eyebrow muted>By the end</Eyebrow>
      {lesson.objectives.map((objective, index) => <Chip key={index}>{objective}</Chip>)}
    </div>}
  </div>;
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
      <EmptyState heading="Nothing to read yet.">
        {canEditCourse ? <> Open Build <KeatingGlyph name="chevr" size={12} /> Lesson to write it.</> : ""}
      </EmptyState>
    );
  return (
    <Prose id={`lesson-reading-${lesson.id}`} tabIndex={-1} aria-label={`${lesson.title} reading`} className="cw-reading">
      {lesson.reading.split(/\n\n+/).map((paragraph) => (
        <p key={paragraph.slice(0, 32)}>{paragraph}</p>
      ))}
    </Prose>
  );
}

function PrivateContinuation({ snapshot, lesson }: { snapshot: CourseViewerSnapshot; lesson: CourseLesson }) {
  // Private forks can verify reading passages only. A lesson without reading
  // can still open a private chat, without copying the answer or course data.
  if (!lesson.reading.trim()) return <a className="cw-private-link" href="/chat" target="_blank" rel="noreferrer">
    Continue privately with Keating
  </a>;
  return <div className="cw-private-continuation">
    <LessonPrivateFork key={snapshot.viewer.accountId} context={{
      courseId: snapshot.course.id, courseTitle: snapshot.course.title,
      lessonId: lesson.id, lessonTitle: lesson.title,
      revision: snapshot.course.revision, reading: lesson.reading,
    }} />
    <small>with Keating</small>
  </div>;
}

function WorkedExercise({
  exercise,
  ...props
}: DeskViewProps & { exercise: NonNullable<CourseLesson["exercise"]> }) {
  const audience = ["You"];
  if (props.snapshot.viewer.teacherAccess === "full") audience.push("teachers");
  if (props.shareAnswer) audience.push("peers");
  return (
    <Card as="section" className="cw-exercise">
      <Eyebrow>Worked exercise</Eyebrow>
      <Prose><p>{exercise.prompt}</p></Prose>
      <TextArea aria-label="Exercise answer" value={props.answer}
        onChange={event => props.setAnswer(event.target.value)}
        placeholder={exercise.placeholder} rows={4} />
      <div className="cw-answer-visibility">
        <label><input type="checkbox" checked={props.shareAnswer}
          onChange={event => props.setShareAnswer(event.target.checked)} /> Share with peers</label>
        <span role="status">Visible after saving · {audience.join(", ")}</span>
      </div>
      <footer>
        {props.lesson && <PrivateContinuation snapshot={props.snapshot} lesson={props.lesson} />}
        <Button variant="primary" glyph="save"
          disabled={!props.answer.trim() || props.saving === "answer"} onClick={props.onSaveAnswer}>
          {props.saving === "answer" ? "Saving…" : "Save work"}
        </Button>
      </footer>
    </Card>
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
    borderTop: "1px solid var(--line)",
    pt: "1rem",
  });
  const summary = css({
    cursor: "pointer",
    fontFamily: "var(--font-ui)",
    fontSize: ".82rem",
    fontWeight: 700,
  });
  return (
    <>
      {courseAssignments.length ? (
        <Card as="details" className={shelf}>
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
        </Card>
      ) : null}
      {courseArtifacts.length ? (
        <Card as="details" className={shelf}>
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
        </Card>
      ) : null}
    </>
  );
}

function SharedNotes(props: DeskViewProps) {
  return (
    <Card as="section">
      <div data-glyph-host
        className={css({
          display: "flex",
          alignItems: "end",
          justifyContent: "space-between",
          gap: "1rem",
        })}
      >
        <div>
          <Eyebrow>
            Shared notes · version {props.sharedNoteVersion}
          </Eyebrow>
          <h3 className="cw-notes-title">
            The margin everyone can write in.
          </h3>
        </div>
        <KeatingGlyph name="note" size={22} />
      </div>
      <TextArea aria-label="Shared notes"
        value={props.noteText}
        onChange={(event) => props.setNoteText(event.target.value)}
        rows={7}
        className="cw-shared-note"
        placeholder="Add a definition, question, or useful example…"
      />
      <div
        className={css({
          mt: "0.65rem",
          display: "flex",
          justifyContent: "flex-end",
        })}
      >
        <Button
          type="button"
          variant="line"
          disabled={props.saving === "note"}
          onClick={props.onSaveNote}
        >
          {props.saving === "note" ? "Saving…" : "Save shared notes"}
        </Button>
      </div>
    </Card>
  );
}

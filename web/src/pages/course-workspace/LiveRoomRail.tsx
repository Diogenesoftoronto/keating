/**
 * Right rail of the course workspace: who is in the live room, the viewer's
 * progress, the private Keating helper, shared study rooms, recent activity, and (for Pear-backed courses)
 * the read-only feed key.
 */
import { CourseKeatingPanel } from "../../components/courses/CourseKeatingPanel";
import { formatCourseRelative } from "../../components/courses/course-ui";
import { CourseRooms } from "../../components/rooms/CourseRooms";
import { allCourseLessons, type CourseLesson, type CourseViewerSnapshot } from "../../courses/contracts";
import { Avatar, EmptyState, Eyebrow, StatusDot } from "../../design-system/kit";
import { Meter } from "../../design-system/charts";
import { memberName } from "./model";
import type { WorkspaceView } from "./state";
import { workspaceStyles as s } from "./styles";

export function LiveRoomRail({
  snapshot,
  onlineAccountIds,
  activeLesson,
  view,
}: {
  snapshot: CourseViewerSnapshot;
  onlineAccountIds: ReadonlySet<string>;
  activeLesson: CourseLesson | undefined;
  view: WorkspaceView;
}) {
  const { course, viewer } = snapshot;
  const lessons = allCourseLessons(course);
  const done = lessons.filter((item) => viewer.progress.completedLessonIds.includes(item.id)).length;
  const present = course.members.filter(member => onlineAccountIds.has(member.accountId));
  const renderMember = (member: typeof viewer) => {
        const online = onlineAccountIds.has(member.accountId);
        return (
          <div className="cw-person" key={member.accountId}>
            <Avatar name={member.displayName} />
            <div>
              <strong>{memberName(member, viewer.accountId)}</strong>
              <small>
                <StatusDot tone={online ? "ok" : "idle"} /> {member.role} ·{" "}
                {online ? "Online" : "Offline"}
              </small>
            </div>
          </div>
        );
      };
  return (
    <aside className={s.right}>
      <Eyebrow className="cw-rail-heading k-halftone" muted>Here now</Eyebrow>
      {present.length ? present.map(renderMember) : <EmptyState className="k-halftone" heading="Nobody here now." />}
      <details className="cw-roster-disclosure">
        <summary>Everyone in this course</summary>
        {course.members.map(renderMember)}
      </details>
      <div className="cw-progress">
        <Meter value={done} max={lessons.length} label="Progress" aria-valuetext={`${done} of ${lessons.length}`} />
        <small>
          {done} of {lessons.length}
        </small>
      </div>
      <CourseKeatingPanel
        courseId={course.id}
        courseTitle={course.title}
        {...(activeLesson ? { activeLesson } : {})}
        view={view}
      />
      <CourseRooms
        courseId={course.id}
        courseRole={viewer.role}
        activeLesson={activeLesson}
        displayName={viewer.displayName}
      />
      <section className="cw-activity">
        <Eyebrow muted>Recent activity</Eyebrow>
        {course.activity.length ? course.activity.slice(0, 6).map(item => (
          <p key={item.id}>{item.message} <time dateTime={item.createdAt}>{formatCourseRelative(item.createdAt)}</time></p>
        )) : <EmptyState className="k-halftone" heading="Nothing has happened here yet." />}
      </section>
    </aside>
  );
}

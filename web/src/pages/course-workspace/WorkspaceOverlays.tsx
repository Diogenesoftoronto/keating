/**
 * Modal overlays of the course workspace: the invite dialog and the course
 * search palette. "Ask Keating" from the palette opens a pre-filled chat in a
 * new tab, scoped to this course and the open lesson.
 */
import { CourseCommandPalette } from "../../components/courses/CourseCommandPalette";
import { CourseInviteDialog } from "../../components/courses/CourseInviteDialog";
import type { Course, CourseLesson } from "../../courses/contracts";
import { courseChatSearch, courseSearchAsk } from "../../courses/course-ask";
import type { CourseSearchResult } from "../../courses/course-search";

/** Open the Keating chat for this course in a new tab with `ask` prefilled. */
export function openKeatingChat(courseId: string, ask: string): void {
  const params = new URLSearchParams(
    courseChatSearch(courseId, ask) as Record<string, string>,
  );
  window.open(`/chat?${params.toString()}`, "_blank", "noopener");
}

export function WorkspaceOverlays({
  courseId,
  course,
  activeLesson,
  inviteOpen,
  paletteOpen,
  onCloseInvite,
  onClosePalette,
  onSelectResult,
}: {
  /** The route parameter, which is what the invite dialog and chat link use. */
  courseId: string;
  course: Course;
  activeLesson: CourseLesson | undefined;
  inviteOpen: boolean;
  paletteOpen: boolean;
  onCloseInvite(): void;
  onClosePalette(): void;
  onSelectResult(result: CourseSearchResult): void;
}) {
  return (
    <>
      {inviteOpen && (
        <CourseInviteDialog courseId={courseId} onClose={onCloseInvite} />
      )}
      {paletteOpen && (
        <CourseCommandPalette
          course={course}
          onClose={onClosePalette}
          onSelect={onSelectResult}
          onAskKeating={(query) => {
            onClosePalette();
            openKeatingChat(
              courseId,
              courseSearchAsk(query, {
                courseTitle: course.title,
                ...(activeLesson ? { lessonTitle: activeLesson.title } : {}),
              }),
            );
          }}
        />
      )}
    </>
  );
}

/**
 * Pure derivations for the course workspace: which tabs a viewer gets, which
 * lesson is open and the records attached to it, the network indicator, and the
 * display name used in the live room. No React, so each rule is unit-testable.
 */
import {
  BookUp,
  ClipboardCheck,
  FileText,
  Hammer,
  MessageSquareText,
} from "lucide-react";
import type {
  Course,
  CourseLesson,
  CourseMember,
  CourseModule,
  CoursePermissions,
  CourseSharedNote,
  CourseSubmission,
  CourseViewerSnapshot,
} from "../../courses/contracts";
import type { CourseRealtimeState } from "../../courses/useCourseRealtime";
import type { WorkspaceView } from "./state";

export interface WorkspaceTab {
  id: WorkspaceView;
  label: string;
  icon: typeof BookUp;
}

/** Whoever can edit the course or its deck gets the Build tab. */
export function canBuild(permissions: CoursePermissions): boolean {
  return permissions.canEditCourse || permissions.canEditDeck;
}

/** Read and Discuss for everyone; Review for reviewers; Build for editors. */
export function workspaceTabs(permissions: CoursePermissions): WorkspaceTab[] {
  return [
    { id: "read", label: "Read", icon: FileText },
    { id: "discuss", label: "Discuss", icon: MessageSquareText },
    ...(permissions.canReview
      ? [{ id: "review" as const, label: "Review", icon: ClipboardCheck }]
      : []),
    ...(canBuild(permissions)
      ? [{ id: "build" as const, label: "Build", icon: Hammer }]
      : []),
  ];
}

export function memberName(member: CourseMember, viewerId: string): string {
  return member.accountId === viewerId ? "You" : member.displayName;
}

/** The live socket wins unless it is connected, then the course network reports. */
export function networkStatusOf(
  realtimeStatus: CourseRealtimeState["status"],
  courseNetworkStatus: CourseRealtimeState["status"] | undefined,
): CourseRealtimeState["status"] {
  return realtimeStatus === "connected"
    ? (courseNetworkStatus ?? "connected")
    : realtimeStatus;
}

export interface LessonContext {
  /** The selected lesson, falling back to the first lesson in the course. */
  activeLesson: CourseLesson | undefined;
  activeModule: CourseModule | undefined;
  sharedNote: CourseSharedNote | undefined;
  /** The viewer's own saved answer for the active lesson. */
  ownSubmission: CourseSubmission | undefined;
}

export function resolveLessonContext(
  course: Course | undefined,
  lessons: readonly CourseLesson[],
  activeLessonId: string,
  viewerAccountId: string | undefined,
): LessonContext {
  const activeLesson =
    lessons.find((lesson) => lesson.id === activeLessonId) ?? lessons[0];
  return {
    activeLesson,
    activeModule: course?.modules.find((module) =>
      module.lessons.some((lesson) => lesson.id === activeLesson?.id),
    ),
    sharedNote: course?.sharedNotes.find(
      (note) => note.lessonId === activeLesson?.id,
    ),
    ownSubmission: course?.submissions.find(
      (submission) =>
        submission.lessonId === activeLesson?.id &&
        submission.accountId === viewerAccountId,
    ),
  };
}

export function isLessonCompleted(
  snapshot: CourseViewerSnapshot,
  lesson: CourseLesson | undefined,
): boolean {
  return lesson
    ? snapshot.viewer.progress.completedLessonIds.includes(lesson.id)
    : false;
}

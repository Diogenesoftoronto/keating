/**
 * Where a command-palette result should take the viewer. Resolution is pure
 * and permission-aware (a learner opening a module lands on its first lesson;
 * an editor lands in the builder); the workspace executes the returned step.
 */
import type { CourseBuilderSection } from "../../components/courses/CourseBuilder";
import { courseMaterialUrl } from "../../courses/client";
import type { Course, CoursePermissions } from "../../courses/contracts";
import type { CourseSearchResult } from "../../courses/course-search";
import type { WorkspaceView } from "./state";

export type WorkspaceNavigation =
  | { kind: "lesson"; lessonId: string; view: WorkspaceView }
  | { kind: "builder"; section: CourseBuilderSection }
  /** Open a comment thread: a lesson's, or the course-wide one when absent. */
  | { kind: "discussion"; lessonId?: string }
  | { kind: "url"; url: string };

export function resolveSearchNavigation(
  result: CourseSearchResult,
  course: Course,
  permissions: CoursePermissions,
): WorkspaceNavigation | null {
  switch (result.kind) {
    case "lesson":
      return { kind: "lesson", lessonId: result.id, view: "read" };
    case "module": {
      if (permissions.canEditCourse)
        return { kind: "builder", section: "outline" };
      const firstLesson = course.modules.find(
        (module) => module.id === result.id,
      )?.lessons[0];
      return firstLesson
        ? { kind: "lesson", lessonId: firstLesson.id, view: "read" }
        : null;
    }
    case "document": {
      const material = course.materials.find((item) => item.id === result.id);
      return material
        ? {
            kind: "url",
            url: material.url ?? courseMaterialUrl(course.id, material.id),
          }
        : null;
    }
    case "comment":
      return {
        kind: "discussion",
        ...(result.lessonId ? { lessonId: result.lessonId } : {}),
      };
    case "card":
      return permissions.canEditDeck
        ? { kind: "builder", section: "cards" }
        : null;
    case "member":
      return permissions.canEditCourse
        ? { kind: "builder", section: "access" }
        : null;
    default:
      if (result.lessonId)
        return { kind: "lesson", lessonId: result.lessonId, view: "read" };
      return permissions.canEditCourse
        ? {
            kind: "builder",
            section: result.kind === "assignment" ? "assignments" : "artifacts",
          }
        : null;
  }
}

/**
 * Outline operations: course details, modules, lessons, and lesson completion.
 * Each handler receives the cloned course (mutated in place), the acting
 * member, the operation, and the clock. Revision checks and the single
 * revision increment live in the dispatcher, not here.
 */
import {
  type Course,
  type CourseMember,
  type CourseOperation,
} from "../contracts";
import {
  CourseAuthorizationError,
  CourseConflictError,
  CourseNotFoundError,
} from "./errors";
import {
  activity,
  appendActivity,
  assertLesson,
  removeLessonState,
  roleCanTeach,
} from "./shared";

const OUTLINE_TYPES = ["course.update", "module.upsert", "module.delete", "lesson.update", "lesson.delete", "lesson.complete"] as const;

export type OutlineOperation = Extract<
  CourseOperation,
  { type: (typeof OUTLINE_TYPES)[number] }
>;

export function isOutlineOperation(
  operation: CourseOperation,
): operation is OutlineOperation {
  return ((OUTLINE_TYPES as readonly string[])).includes(operation.type);
}

export function applyOutlineOperation(
  next: Course,
  actor: CourseMember,
  operation: OutlineOperation,
  now: string,
): void {
  const actorAccountId = actor.accountId;
  switch (operation.type) {
    case "course.update": {
      if (!roleCanTeach(actor.role)) {
        throw new CourseAuthorizationError(
          "Only course teachers can change course details.",
        );
      }
      const { settings, ...details } = operation.patch;
      Object.assign(next, details);
      if (settings) {
        next.settings = {
          ...next.settings,
          ...Object.fromEntries(
            Object.entries(settings).filter(([, value]) => value !== undefined),
          ),
        };
      }
      break;
    }
    case "module.upsert": {
      if (!roleCanTeach(actor.role)) {
        throw new CourseAuthorizationError(
          "Only course teachers can edit modules.",
        );
      }
      const duplicateLesson = operation.module.lessons.find((lesson) =>
        next.modules.some(
          (module) =>
            module.id !== operation.module.id &&
            module.lessons.some((item) => item.id === lesson.id),
        ),
      );
      if (duplicateLesson) {
        throw new CourseConflictError(
          "A lesson with this id already exists in another module.",
          next.revision,
        );
      }
      const index = next.modules.findIndex(
        (module) => module.id === operation.module.id,
      );
      if (index === -1) next.modules.push(operation.module);
      else {
        const retainedIds = new Set(
          operation.module.lessons.map((lesson) => lesson.id),
        );
        const removedIds = new Set(
          next.modules[index]!.lessons.map((lesson) => lesson.id).filter(
            (id) => !retainedIds.has(id),
          ),
        );
        if (removedIds.size) removeLessonState(next, removedIds);
        next.modules[index] = operation.module;
      }
      appendActivity(
        next,
        activity(
          operation.id,
          "module-updated",
          actorAccountId,
          "Updated the course outline",
          now,
        ),
      );
      break;
    }
    case "module.delete": {
      if (!roleCanTeach(actor.role)) {
        throw new CourseAuthorizationError(
          "Only course teachers can remove modules.",
        );
      }
      const index = next.modules.findIndex(
        (module) => module.id === operation.moduleId,
      );
      if (index === -1)
        throw new CourseNotFoundError(
          "This module is no longer part of the course.",
        );
      const lessonIds = new Set(
        next.modules[index]!.lessons.map((lesson) => lesson.id),
      );
      next.modules.splice(index, 1);
      removeLessonState(next, lessonIds);
      appendActivity(
        next,
        activity(
          operation.id,
          "module-removed",
          actorAccountId,
          "Removed a course module",
          now,
        ),
      );
      break;
    }
    case "lesson.update": {
      if (!roleCanTeach(actor.role)) {
        throw new CourseAuthorizationError(
          "Only course teachers can edit lessons.",
        );
      }
      const module = next.modules.find(
        (candidate) => candidate.id === operation.moduleId,
      );
      if (!module)
        throw new CourseNotFoundError(
          "This module is no longer part of the course.",
        );
      if (
        next.modules.some(
          (candidate) =>
            candidate.id !== module.id &&
            candidate.lessons.some(
              (lesson) => lesson.id === operation.lesson.id,
            ),
        )
      ) {
        throw new CourseConflictError(
          "A lesson with this id already exists in another module.",
          next.revision,
        );
      }
      const index = module.lessons.findIndex(
        (lesson) => lesson.id === operation.lesson.id,
      );
      if (index === -1) module.lessons.push(operation.lesson);
      else module.lessons[index] = operation.lesson;
      appendActivity(
        next,
        activity(
          operation.id,
          "lesson-updated",
          actorAccountId,
          "Updated a course lesson",
          now,
          operation.lesson.id,
        ),
      );
      break;
    }
    case "lesson.delete": {
      if (!roleCanTeach(actor.role)) {
        throw new CourseAuthorizationError(
          "Only course teachers can remove lessons.",
        );
      }
      const module = next.modules.find(
        (candidate) => candidate.id === operation.moduleId,
      );
      if (!module)
        throw new CourseNotFoundError(
          "This module is no longer part of the course.",
        );
      const index = module.lessons.findIndex(
        (lesson) => lesson.id === operation.lessonId,
      );
      if (index === -1)
        throw new CourseNotFoundError(
          "This lesson is no longer part of the course.",
        );
      module.lessons.splice(index, 1);
      removeLessonState(next, new Set([operation.lessonId]));
      appendActivity(
        next,
        activity(
          operation.id,
          "lesson-removed",
          actorAccountId,
          "Removed a course lesson",
          now,
        ),
      );
      break;
    }
    case "lesson.complete": {
      assertLesson(next, operation.lessonId);
      const target = next.members.find(
        (member) => member.accountId === actorAccountId,
      )!;
      const completed = new Set(target.progress.completedLessonIds);
      if (operation.completed) completed.add(operation.lessonId);
      else completed.delete(operation.lessonId);
      target.progress.completedLessonIds = [...completed];
      target.progress.activeLessonId = operation.lessonId;
      target.progress.lastActiveAt = now;
      appendActivity(
        next,
        activity(
          operation.id,
          "lesson-completed",
          actorAccountId,
          operation.completed ? "Completed a lesson" : "Reopened a lesson",
          now,
          operation.lessonId,
        ),
      );
      break;
    }
  }
}

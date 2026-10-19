/**
 * Authoritative course operation engine. `applyCourseOperation` validates the
 * target course and base revision, clones the course, delegates the mutation
 * to the handler group that owns the operation type, and stamps exactly one
 * revision increment. Viewer projection and permission derivation live here;
 * the per-type handlers and shared helpers live in `./operations/`.
 */
import {
  type Course,
  type CourseMember,
  type CourseOperation,
  type CoursePermissions,
  type CourseSubmission,
  type CourseAssignmentSubmission,
  type CourseViewerSnapshot,
} from "./contracts";
import {
  CourseConflictError,
  CourseNotFoundError,
} from "./operations/errors";
import {
  applyContentOperation,
  isContentOperation,
} from "./operations/content";
import {
  applyDiscussionOperation,
  isDiscussionOperation,
} from "./operations/discussion";
import {
  applyMembershipOperation,
  isMembershipOperation,
} from "./operations/membership";
import {
  applyOutlineOperation,
  isOutlineOperation,
} from "./operations/outline";
import { memberFor, roleCanTeach } from "./operations/shared";

export {
  CourseAuthorizationError,
  CourseConflictError,
  CourseNotFoundError,
} from "./operations/errors";

function operationNeedsCurrentRevision(operation: CourseOperation): boolean {
  return (
    operation.type === "course.update" ||
    operation.type === "module.upsert" ||
    operation.type === "module.delete" ||
    operation.type === "lesson.update" ||
    operation.type === "lesson.delete" ||
    operation.type === "card.upsert" ||
    operation.type === "cards.import" ||
    operation.type === "card.delete" ||
    operation.type === "artifact.upsert" ||
    operation.type === "artifacts.import" ||
    operation.type === "artifact.delete" ||
    operation.type === "assignment.upsert" ||
    operation.type === "assignment.delete" ||
    operation.type === "material.add" ||
    operation.type === "material.delete" ||
    operation.type === "member.role.update"
  );
}

export function permissionsFor(
  course: Course,
  accountId: string,
): CoursePermissions {
  const member = memberFor(course, accountId);
  const canTeach = roleCanTeach(member.role);
  return {
    canEditCourse: canTeach,
    canInvite: canTeach,
    canReview: canTeach,
    canEditDeck: canTeach || course.settings.allowPeerDeckEdits,
    canRequestTeacherAccess: canTeach,
  };
}

export function applyCourseOperation(
  current: Course,
  actorAccountId: string,
  operation: CourseOperation,
  now = new Date().toISOString(),
): Course {
  if (operation.courseId !== current.id) {
    throw new CourseNotFoundError("The operation targets a different course.");
  }
  if (
    operationNeedsCurrentRevision(operation) &&
    operation.baseRevision !== current.revision
  ) {
    throw new CourseConflictError(
      "The course changed while you were editing. Refresh and try again.",
      current.revision,
    );
  }

  const actor = memberFor(current, actorAccountId);
  const next = structuredClone(current);

  if (isOutlineOperation(operation)) {
    applyOutlineOperation(next, actor, operation, now);
  } else if (isDiscussionOperation(operation)) {
    applyDiscussionOperation(next, actor, operation, now);
  } else if (isContentOperation(operation)) {
    applyContentOperation(next, actor, operation, now);
  } else if (isMembershipOperation(operation)) {
    applyMembershipOperation(next, actor, operation, now);
  }

  next.revision += 1;
  next.updatedAt = now;
  return next;
}

function canSeeSubmission(
  course: Course,
  viewer: CourseMember,
  submission: CourseSubmission,
): boolean {
  if (submission.accountId === viewer.accountId) return true;
  if (roleCanTeach(viewer.role)) {
    return memberFor(course, submission.accountId).teacherAccess === "full";
  }
  return submission.sharedWithPeers;
}

function canSeeAssignmentSubmission(
  course: Course,
  viewer: CourseMember,
  submission: CourseAssignmentSubmission,
): boolean {
  if (submission.accountId === viewer.accountId) return true;
  if (roleCanTeach(viewer.role)) {
    return memberFor(course, submission.accountId).teacherAccess === "full";
  }
  return submission.sharedWithPeers;
}

function canSeeMemberPrivateState(
  viewer: CourseMember,
  member: CourseMember,
): boolean {
  if (member.accountId === viewer.accountId) return true;
  return (
    roleCanTeach(viewer.role) &&
    !roleCanTeach(member.role) &&
    member.teacherAccess === "full"
  );
}

function canSeeMemberConsentState(
  viewer: CourseMember,
  member: CourseMember,
): boolean {
  if (member.accountId === viewer.accountId) return true;
  return roleCanTeach(viewer.role) && !roleCanTeach(member.role);
}

function projectMemberForViewer(
  course: Course,
  viewer: CourseMember,
  member: CourseMember,
): CourseMember {
  if (canSeeMemberPrivateState(viewer, member)) return structuredClone(member);
  return {
    accountId: member.accountId,
    displayName: member.displayName,
    role: member.role,
    teacherAccess: canSeeMemberConsentState(viewer, member)
      ? member.teacherAccess
      : "private",
    // CourseMember remains schema-compatible without revealing member-specific timestamps.
    joinedAt: course.createdAt,
    progress: {
      completedLessonIds: [],
      lastActiveAt: course.createdAt,
    },
  };
}

export function projectCourseForViewer(
  course: Course,
  viewerAccountId: string,
): CourseViewerSnapshot {
  const viewer = memberFor(course, viewerAccountId);
  const projected = structuredClone(course);
  projected.materials = projected.materials.map((material) => {
    const { storageKey: _storageKey, ...publicMaterial } = material;
    return publicMaterial;
  });
  projected.members = course.members.map((member) =>
    projectMemberForViewer(course, viewer, member),
  );
  projected.submissions = projected.submissions.filter((submission) =>
    canSeeSubmission(course, viewer, submission),
  );
  projected.assignmentSubmissions = projected.assignmentSubmissions.filter(
    (submission) => canSeeAssignmentSubmission(course, viewer, submission),
  );
  projected.activity = projected.activity.filter((item) => {
    const member = course.members.find(
      (candidate) => candidate.accountId === item.accountId,
    );
    return member ? canSeeMemberPrivateState(viewer, member) : false;
  });
  return {
    course: projected,
    viewer: structuredClone(viewer),
    permissions: permissionsFor(course, viewerAccountId),
  };
}

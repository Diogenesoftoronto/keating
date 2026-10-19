/**
 * Membership operations: teacher-access requests and responses, and member role changes.
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
} from "./errors";
import {
  activity,
  appendActivity,
  memberFor,
  roleCanOwn,
  roleCanTeach,
} from "./shared";

const MEMBERSHIP_TYPES = ["teacher-access.request", "teacher-access.respond", "member.role.update"] as const;

export type MembershipOperation = Extract<
  CourseOperation,
  { type: (typeof MEMBERSHIP_TYPES)[number] }
>;

export function isMembershipOperation(
  operation: CourseOperation,
): operation is MembershipOperation {
  return ((MEMBERSHIP_TYPES as readonly string[])).includes(operation.type);
}

export function applyMembershipOperation(
  next: Course,
  actor: CourseMember,
  operation: MembershipOperation,
  now: string,
): void {
  const actorAccountId = actor.accountId;
  switch (operation.type) {
    case "teacher-access.request": {
      if (!roleCanTeach(actor.role)) {
        throw new CourseAuthorizationError(
          "Only course teachers can request full access.",
        );
      }
      const target = memberFor(next, operation.memberAccountId);
      if (roleCanTeach(target.role)) {
        throw new CourseAuthorizationError(
          "Teacher access applies to learners and invited peers.",
        );
      }
      target.teacherAccess = "requested";
      appendActivity(
        next,
        activity(
          operation.id,
          "teacher-access-requested",
          actorAccountId,
          "Requested full teacher access",
          now,
        ),
      );
      break;
    }
    case "teacher-access.respond": {
      const target = memberFor(next, actorAccountId);
      if (target.teacherAccess !== "requested") {
        throw new CourseConflictError(
          "There is no active teacher-access request.",
          next.revision,
        );
      }
      target.teacherAccess = operation.approve ? "full" : "private";
      appendActivity(
        next,
        activity(
          operation.id,
          "teacher-access-changed",
          actorAccountId,
          operation.approve
            ? "Granted full teacher access"
            : "Declined full teacher access",
          now,
        ),
      );
      break;
    }
    case "member.role.update": {
      if (!roleCanOwn(actor.role)) {
        throw new CourseAuthorizationError(
          "Only the course owner can change member roles.",
        );
      }
      const target = memberFor(next, operation.memberAccountId);
      if (target.role === "owner") {
        throw new CourseAuthorizationError(
          "Transfer ownership before changing the owner role.",
        );
      }
      target.role = operation.role;
      appendActivity(
        next,
        activity(
          operation.id,
          "member-role-changed",
          actorAccountId,
          "Changed a course member role",
          now,
        ),
      );
      break;
    }
  }
}

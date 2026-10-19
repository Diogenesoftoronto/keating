/**
 * Content operations: deck cards, artifacts, assignments and their submissions, and materials.
 * Each handler receives the cloned course (mutated in place), the acting
 * member, the operation, and the clock. Revision checks and the single
 * revision increment live in the dispatcher, not here.
 */
import {
  allCourseLessons,
  type Course,
  type CourseAssignmentSubmission,
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
  assertAssignment,
  assertLesson,
  dropReactions,
  memberFor,
  removeCardReferences,
  removeMaterialReferences,
  roleCanTeach,
} from "./shared";

const CONTENT_TYPES = ["card.upsert", "cards.import", "card.delete", "artifact.upsert", "artifacts.import", "artifact.delete", "assignment.upsert", "assignment.delete", "assignment.submission.save", "assignment.submission.review", "material.add", "material.delete"] as const;

export type ContentOperation = Extract<
  CourseOperation,
  { type: (typeof CONTENT_TYPES)[number] }
>;

export function isContentOperation(
  operation: CourseOperation,
): operation is ContentOperation {
  return ((CONTENT_TYPES as readonly string[])).includes(operation.type);
}

export function applyContentOperation(
  next: Course,
  actor: CourseMember,
  operation: ContentOperation,
  now: string,
): void {
  const actorAccountId = actor.accountId;
  switch (operation.type) {
    case "card.upsert": {
      if (!roleCanTeach(actor.role) && !next.settings.allowPeerDeckEdits) {
        throw new CourseAuthorizationError(
          "Only course teachers can edit this deck.",
        );
      }
      if (operation.card.lessonId) assertLesson(next, operation.card.lessonId);
      const index = next.cards.findIndex(
        (card) => card.id === operation.card.id,
      );
      const card = {
        ...operation.card,
        updatedAt: now,
        updatedBy: actorAccountId,
      };
      if (index === -1) next.cards.push(card);
      else next.cards[index] = card;
      removeCardReferences(next, card.id);
      if (card.lessonId) {
        const lesson = allCourseLessons(next).find(
          (candidate) => candidate.id === card.lessonId,
        )!;
        lesson.cardIds.push(card.id);
      }
      appendActivity(
        next,
        activity(
          operation.id,
          "card-updated",
          actorAccountId,
          "Updated an Anki card",
          now,
          card.lessonId,
        ),
      );
      break;
    }
    case "cards.import": {
      if (!roleCanTeach(actor.role) && !next.settings.allowPeerDeckEdits) {
        throw new CourseAuthorizationError(
          "Only course teachers can edit this deck.",
        );
      }
      for (const imported of operation.cards) {
        if (imported.lessonId) assertLesson(next, imported.lessonId);
        const index = next.cards.findIndex((card) => card.id === imported.id);
        const card = { ...imported, updatedAt: now, updatedBy: actorAccountId };
        if (index === -1) next.cards.push(card);
        else next.cards[index] = card;
        removeCardReferences(next, card.id);
        if (card.lessonId) {
          const lesson = allCourseLessons(next).find(
            (candidate) => candidate.id === card.lessonId,
          )!;
          lesson.cardIds.push(card.id);
        }
      }
      appendActivity(
        next,
        activity(
          operation.id,
          "card-updated",
          actorAccountId,
          `Imported ${operation.cards.length} course cards`,
          now,
        ),
      );
      break;
    }
    case "card.delete": {
      if (!roleCanTeach(actor.role) && !next.settings.allowPeerDeckEdits) {
        throw new CourseAuthorizationError(
          "Only course teachers can edit this deck.",
        );
      }
      const index = next.cards.findIndex(
        (card) => card.id === operation.cardId,
      );
      if (index === -1)
        throw new CourseNotFoundError(
          "This card is no longer part of the course.",
        );
      next.cards.splice(index, 1);
      removeCardReferences(next, operation.cardId);
      appendActivity(
        next,
        activity(
          operation.id,
          "card-removed",
          actorAccountId,
          "Removed a course card",
          now,
        ),
      );
      break;
    }
    case "artifact.upsert": {
      if (!roleCanTeach(actor.role)) {
        throw new CourseAuthorizationError(
          "Only course teachers can edit course artifacts.",
        );
      }
      if (operation.artifact.lessonId)
        assertLesson(next, operation.artifact.lessonId);
      const index = next.artifacts.findIndex(
        (artifact) => artifact.id === operation.artifact.id,
      );
      const artifact = {
        ...operation.artifact,
        updatedAt: now,
        updatedBy: actorAccountId,
      };
      if (index === -1) next.artifacts.push(artifact);
      else next.artifacts[index] = artifact;
      appendActivity(
        next,
        activity(
          operation.id,
          "artifact-updated",
          actorAccountId,
          `Updated ${artifact.title}`,
          now,
          artifact.lessonId,
        ),
      );
      break;
    }
    case "artifacts.import": {
      if (!roleCanTeach(actor.role)) {
        throw new CourseAuthorizationError(
          "Only course teachers can import course artifacts.",
        );
      }
      for (const imported of operation.artifacts) {
        if (imported.lessonId) assertLesson(next, imported.lessonId);
        const index = next.artifacts.findIndex(
          (artifact) => artifact.id === imported.id,
        );
        const artifact = {
          ...imported,
          updatedAt: now,
          updatedBy: actorAccountId,
        };
        if (index === -1) next.artifacts.push(artifact);
        else next.artifacts[index] = artifact;
      }
      appendActivity(
        next,
        activity(
          operation.id,
          "artifact-updated",
          actorAccountId,
          `Imported ${operation.artifacts.length} course artifacts`,
          now,
        ),
      );
      break;
    }
    case "artifact.delete": {
      if (!roleCanTeach(actor.role)) {
        throw new CourseAuthorizationError(
          "Only course teachers can remove course artifacts.",
        );
      }
      const index = next.artifacts.findIndex(
        (artifact) => artifact.id === operation.artifactId,
      );
      if (index === -1)
        throw new CourseNotFoundError(
          "This artifact is no longer part of the course.",
        );
      const [removed] = next.artifacts.splice(index, 1);
      dropReactions(next, "artifact", new Set([operation.artifactId]));
      appendActivity(
        next,
        activity(
          operation.id,
          "artifact-removed",
          actorAccountId,
          `Removed ${removed?.title ?? "a course artifact"}`,
          now,
        ),
      );
      break;
    }
    case "assignment.upsert": {
      if (!roleCanTeach(actor.role)) {
        throw new CourseAuthorizationError(
          "Only course teachers can edit assignments.",
        );
      }
      if (operation.assignment.lessonId)
        assertLesson(next, operation.assignment.lessonId);
      const index = next.assignments.findIndex(
        (assignment) => assignment.id === operation.assignment.id,
      );
      const assignment = {
        ...operation.assignment,
        updatedAt: now,
        updatedBy: actorAccountId,
      };
      if (index === -1) next.assignments.push(assignment);
      else next.assignments[index] = assignment;
      appendActivity(
        next,
        activity(
          operation.id,
          "assignment-updated",
          actorAccountId,
          `Updated ${assignment.title}`,
          now,
          assignment.lessonId,
        ),
      );
      break;
    }
    case "assignment.delete": {
      if (!roleCanTeach(actor.role)) {
        throw new CourseAuthorizationError(
          "Only course teachers can remove assignments.",
        );
      }
      const index = next.assignments.findIndex(
        (assignment) => assignment.id === operation.assignmentId,
      );
      if (index === -1)
        throw new CourseNotFoundError(
          "This assignment is no longer part of the course.",
        );
      const [removed] = next.assignments.splice(index, 1);
      next.assignmentSubmissions = next.assignmentSubmissions.filter(
        (submission) => submission.assignmentId !== operation.assignmentId,
      );
      dropReactions(next, "assignment", new Set([operation.assignmentId]));
      appendActivity(
        next,
        activity(
          operation.id,
          "assignment-removed",
          actorAccountId,
          `Removed ${removed?.title ?? "an assignment"}`,
          now,
        ),
      );
      break;
    }
    case "assignment.submission.save": {
      assertAssignment(next, operation.assignmentId);
      const assignment = next.assignments.find((entry) => entry.id === operation.assignmentId)!;
      if (operation.status === "submitted" && assignment.availableFrom && Date.parse(now) < Date.parse(assignment.availableFrom)) {
        throw new CourseAuthorizationError("This assignment is not open for submission yet.");
      }
      const index = next.assignmentSubmissions.findIndex(
        (submission) =>
          submission.id === operation.submissionId &&
          submission.accountId === actorAccountId,
      );
      const existing = index === -1 ? null : next.assignmentSubmissions[index];
      if (existing && existing.version !== operation.baseVersion) {
        throw new CourseConflictError(
          "This assignment draft changed while you were editing. Review the latest version before saving.",
          next.revision,
        );
      }
      const submission: CourseAssignmentSubmission = {
        id: operation.submissionId,
        assignmentId: operation.assignmentId,
        accountId: actorAccountId,
        answer: operation.answer,
        attachments: operation.attachments ?? [],
        status: operation.status,
        sharedWithPeers: operation.sharedWithPeers,
        version: (existing?.version ?? 0) + 1,
        updatedAt: now,
        ...(existing?.review ? { review: existing.review } : {}),
      };
      if (index === -1) next.assignmentSubmissions.push(submission);
      else next.assignmentSubmissions[index] = submission;
      appendActivity(
        next,
        activity(
          operation.id,
          "assignment-submitted",
          actorAccountId,
          operation.status === "submitted"
            ? "Submitted an assignment"
            : "Saved an assignment draft",
          now,
        ),
      );
      break;
    }
    case "assignment.submission.review": {
      if (!roleCanTeach(actor.role)) {
        throw new CourseAuthorizationError(
          "Only course teachers can review assignment submissions.",
        );
      }
      const submission = next.assignmentSubmissions.find(
        (candidate) => candidate.id === operation.submissionId,
      );
      if (!submission)
        throw new CourseNotFoundError(
          "This assignment submission could not be found.",
        );
      const student = memberFor(next, submission.accountId);
      if (student.teacherAccess !== "full") {
        throw new CourseAuthorizationError(
          "The learner has not granted full teacher access.",
        );
      }
      submission.review = {
        status: operation.status,
        feedback: operation.feedback,
        reviewerAccountId: actorAccountId,
        updatedAt: now,
      };
      appendActivity(
        next,
        activity(
          operation.id,
          "assignment-reviewed",
          actorAccountId,
          "Reviewed an assignment submission",
          now,
        ),
      );
      break;
    }
    case "material.add": {
      if (!roleCanTeach(actor.role)) {
        throw new CourseAuthorizationError(
          "Only course teachers can add course materials.",
        );
      }
      if (operation.material.lessonId)
        assertLesson(next, operation.material.lessonId);
      const material = {
        ...operation.material,
        createdAt: now,
        createdBy: actorAccountId,
      };
      const index = next.materials.findIndex(
        (candidate) => candidate.id === material.id,
      );
      if (index === -1) next.materials.push(material);
      else next.materials[index] = material;
      removeMaterialReferences(next, material.id);
      if (material.lessonId) {
        const lesson = allCourseLessons(next).find(
          (candidate) => candidate.id === material.lessonId,
        )!;
        lesson.materialIds.push(material.id);
      }
      appendActivity(
        next,
        activity(
          operation.id,
          "material-added",
          actorAccountId,
          "Added course material",
          now,
        ),
      );
      break;
    }
    case "material.delete": {
      if (!roleCanTeach(actor.role)) {
        throw new CourseAuthorizationError(
          "Only course teachers can remove course materials.",
        );
      }
      const index = next.materials.findIndex(
        (material) => material.id === operation.materialId,
      );
      if (index === -1)
        throw new CourseNotFoundError(
          "This source is no longer part of the course.",
        );
      next.materials.splice(index, 1);
      removeMaterialReferences(next, operation.materialId);
      dropReactions(next, "material", new Set([operation.materialId]));
      appendActivity(
        next,
        activity(
          operation.id,
          "material-removed",
          actorAccountId,
          "Removed course material",
          now,
        ),
      );
      break;
    }
  }
}

import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import type { Course, CourseOperation } from "../courses/contracts";
import { applyCourseOperation } from "../courses/operations";

const NOW = "2026-08-03T16:00:00.000Z";
const LATER = "2026-08-04T09:30:00.000Z";
const COURSE_ID = "course_props";
const REVISION = 7;

const ACTORS = ["owner_1", "teacher_1", "student_1", "peer_1", "stranger"];
const IDS = ["a", "b", "lesson_1", "module_1", "card_1", "note_1", "c1", "c2"];

function courseFixture(studentAccess: "private" | "requested" = "private"): Course {
  const member = (
    accountId: string,
    role: "owner" | "teacher" | "student" | "peer",
    teacherAccess: "private" | "requested" | "full" = "private",
  ) => ({
    accountId,
    displayName: accountId,
    role,
    teacherAccess,
    joinedAt: NOW,
    progress: { completedLessonIds: [], lastActiveAt: NOW },
  });
  return {
    schemaVersion: 1,
    id: COURSE_ID,
    title: "Properties",
    description: "",
    outcomes: [],
    ownerAccountId: "owner_1",
    createdAt: NOW,
    updatedAt: NOW,
    revision: REVISION,
    modules: [
      {
        id: "module_1",
        title: "One",
        description: "",
        lessons: [
          {
            id: "lesson_1",
            title: "Lesson",
            summary: "",
            objectives: [],
            reading: "",
            materialIds: [],
            cardIds: [],
            exercise: { id: "exercise_1", prompt: "?", rubric: [] },
          },
        ],
      },
    ],
    materials: [],
    cards: [],
    artifacts: [],
    assignments: [],
    members: [
      member("owner_1", "owner", "full"),
      member("teacher_1", "teacher", "full"),
      member("student_1", "student", studentAccess),
      member("peer_1", "peer"),
    ],
    sharedNotes: [],
    submissions: [],
    assignmentSubmissions: [],
    comments: [],
    reactions: [],
    activity: [],
    settings: {
      teacherAccessPolicy: "request",
      allowPeerDeckEdits: false,
      allowPeerComments: true,
    },
  };
}

const idArb = fc.constantFrom(...IDS);
const base = (revision: number) =>
  fc.record({
    id: fc.string({ minLength: 1, maxLength: 8 }),
    courseId: fc.constant(COURSE_ID),
    baseRevision: fc.constant(revision),
  });

/** A spread of operation types covering every handler group. */
function operationArb(revision: number): fc.Arbitrary<CourseOperation> {
  const b = base(revision);
  return fc.oneof(
    fc
      .tuple(b, fc.string({ minLength: 1, maxLength: 20 }))
      .map(
        ([o, title]): CourseOperation => ({
          ...o,
          type: "course.update",
          patch: { title },
        }),
      ),
    fc
      .tuple(b, idArb)
      .map(
        ([o, moduleId]): CourseOperation => ({
          ...o,
          type: "module.delete",
          moduleId,
        }),
      ),
    fc
      .tuple(b, idArb, fc.boolean())
      .map(
        ([o, lessonId, completed]): CourseOperation => ({
          ...o,
          type: "lesson.complete",
          lessonId,
          completed,
        }),
      ),
    fc
      .tuple(b, idArb, idArb, fc.option(idArb, { nil: undefined }))
      .map(
        ([o, commentId, lessonId, parentId]): CourseOperation => ({
          ...o,
          type: "comment.add",
          commentId,
          lessonId,
          parentId,
          body: "hello",
        }),
      ),
    fc
      .tuple(b, idArb)
      .map(
        ([o, commentId]): CourseOperation => ({
          ...o,
          type: "comment.delete",
          commentId,
        }),
      ),
    fc
      .tuple(b, idArb)
      .map(
        ([o, cardId]): CourseOperation => ({ ...o, type: "card.delete", cardId }),
      ),
    fc
      .tuple(b, idArb)
      .map(
        ([o, materialId]): CourseOperation => ({
          ...o,
          type: "material.delete",
          materialId,
        }),
      ),
    fc
      .tuple(b, fc.constantFrom(...ACTORS))
      .map(
        ([o, memberAccountId]): CourseOperation => ({
          ...o,
          type: "teacher-access.request",
          memberAccountId,
        }),
      ),
    fc
      .tuple(b, fc.boolean())
      .map(
        ([o, approve]): CourseOperation => ({
          ...o,
          type: "teacher-access.respond",
          approve,
        }),
      ),
    fc
      .tuple(b, fc.constantFrom(...ACTORS), fc.constantFrom("teacher", "student", "peer" as const))
      .map(
        ([o, memberAccountId, role]): CourseOperation => ({
          ...o,
          type: "member.role.update",
          memberAccountId,
          role: role as "teacher" | "student" | "peer",
        }),
      ),
  );
}

function attempt(
  course: Course,
  actor: string,
  operation: CourseOperation,
): { ok: true; next: Course } | { ok: false } {
  try {
    return {
      ok: true,
      next: applyCourseOperation(course, actor, operation, LATER),
    };
  } catch {
    return { ok: false };
  }
}

let accepted = 0;
describe("course operation invariants", () => {
  test("a rejected operation leaves the course untouched", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ACTORS),
        operationArb(REVISION),
        (actor, op) => {
          const course = courseFixture();
          const before = structuredClone(course);
          const result = attempt(course, actor, op);
          expect(course).toEqual(before);
          if (!result.ok) expect(course.revision).toBe(REVISION);
        },
      ),
      { numRuns: 400 },
    );
  });

  test("an accepted operation bumps the revision by exactly one and never mutates the input", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ACTORS),
        operationArb(REVISION),
        (actor, op) => {
          const course = courseFixture();
          const before = structuredClone(course);
          const result = attempt(course, actor, op);
          expect(course).toEqual(before);
          if (result.ok) {
            accepted += 1;
            expect(result.next.revision).toBe(REVISION + 1);
            expect(result.next.updatedAt).toBe(LATER);
            expect(result.next.id).toBe(COURSE_ID);
          }
        },
      ),
      { numRuns: 400 },
    );
  });

  test("operations with a stale base revision are rejected for revision-guarded types", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("owner_1", "teacher_1"),
        operationArb(REVISION - 1).filter((op) =>
          [
            "course.update",
            "module.delete",
            "card.delete",
            "material.delete",
            "member.role.update",
          ].includes(op.type),
        ),
        (actor, op) => {
          expect(attempt(courseFixture(), actor, op).ok).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  test("operations aimed at another course are always rejected", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ACTORS),
        operationArb(REVISION),
        (actor, op) => {
          expect(
            attempt(courseFixture(), actor, { ...op, courseId: "other" }).ok,
          ).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  test("learners can only answer their own teacher-access request", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("student_1", "peer_1", "stranger"),
        fc.constantFrom("private", "requested" as const),
        operationArb(REVISION),
        (actor, studentAccess, op) => {
          const course = courseFixture(studentAccess);
          const result = attempt(course, actor, op);
          if (!result.ok) return;
          expect(result.next.ownerAccountId).toBe(course.ownerAccountId);
          const roles = (c: Course) =>
            c.members.map((m) => [m.accountId, m.role]);
          expect(roles(result.next)).toEqual(roles(course));
          // No learner action changes another member's teacher-access consent.
          const othersAccess = (c: Course) =>
            c.members.filter((m) => m.accountId !== actor).map((m) => [m.accountId, m.teacherAccess]);
          expect(othersAccess(result.next)).toEqual(othersAccess(course));
          const before = course.members.find((m) => m.accountId === actor)?.teacherAccess;
          const after = result.next.members.find((m) => m.accountId === actor)?.teacherAccess;
          if (after !== before) {
            // The only self-change is answering an open request.
            expect(op.type).toBe("teacher-access.respond");
            expect(before).toBe("requested");
            expect(after).toBe((op as { approve: boolean }).approve ? "full" : "private");
          }
        },
      ),
      { numRuns: 400 },
    );
  });

  test("a learner's answer to an open request is recorded exactly", () => {
    for (const approve of [true, false]) {
      const result = attempt(courseFixture("requested"), "student_1",
        { id: `respond-${approve}`, courseId: COURSE_ID, baseRevision: REVISION, type: "teacher-access.respond", approve } as CourseOperation);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.next.members.find((m) => m.accountId === "student_1")?.teacherAccess).toBe(approve ? "full" : "private");
      }
    }
    expect(attempt(courseFixture("private"), "student_1",
      { id: "respond-none", courseId: COURSE_ID, baseRevision: REVISION, type: "teacher-access.respond", approve: true } as CourseOperation).ok).toBe(false);
  });

  test("no operation can reassign the owner or demote the owner role", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ACTORS),
        operationArb(REVISION),
        (actor, op) => {
          const result = attempt(courseFixture(), actor, op);
          if (!result.ok) return;
          expect(result.next.ownerAccountId).toBe("owner_1");
          expect(
            result.next.members.find((m) => m.accountId === "owner_1")?.role,
          ).toBe("owner");
        },
      ),
      { numRuns: 400 },
    );
  });

  test("the generators exercise accepted operations, not only rejections", () => {
    expect(accepted).toBeGreaterThan(20);
  });
});

/**
 * Behavioural tests for the workspace's pure logic: which tabs each viewer
 * gets, where search results navigate, and exactly which operation each named
 * action sends. These pin behaviour that used to live inline in the page.
 */
import { describe, expect, test } from "bun:test";
import type { CourseOperation } from "../courses/contracts";
import type { CourseSearchResult } from "../courses/course-search";
import {
  canBuild,
  isLessonCompleted,
  networkStatusOf,
  resolveLessonContext,
  workspaceTabs,
} from "../pages/course-workspace/model";
import { resolveSearchNavigation } from "../pages/course-workspace/search-navigation";
import { createWorkspaceActions } from "../pages/course-workspace/workspace-actions";
import { allCourseLessons } from "../courses/contracts";
import { deskFixture } from "./course-outline-fixtures";

const perms = (over: Partial<ReturnType<typeof base>> = {}) => ({ ...base(), ...over });
const base = () => ({
  canEditCourse: false,
  canInvite: false,
  canReview: false,
  canEditDeck: false,
  canRequestTeacherAccess: false,
});

describe("workspace tabs", () => {
  test("everyone reads and discusses; learners get nothing else", () => {
    expect(workspaceTabs(perms()).map((t) => t.label)).toEqual(["Read", "Discuss"]);
  });
  test("reviewers get Review, editors of course or deck get Build", () => {
    expect(workspaceTabs(perms({ canReview: true })).map((t) => t.label)).toEqual(["Read", "Discuss", "Review"]);
    expect(workspaceTabs(perms({ canEditDeck: true })).map((t) => t.label)).toEqual(["Read", "Discuss", "Build"]);
    expect(
      workspaceTabs(perms({ canReview: true, canEditCourse: true })).map((t) => t.id),
    ).toEqual(["read", "discuss", "review", "build"]);
    expect(canBuild(perms())).toBe(false);
  });
});

describe("network status", () => {
  test("a live socket defers to the course network; otherwise the socket state shows", () => {
    expect(networkStatusOf("connected", "reconnecting")).toBe("reconnecting");
    expect(networkStatusOf("connected", undefined)).toBe("connected");
    expect(networkStatusOf("offline", "connected")).toBe("offline");
    expect(networkStatusOf("reconnecting", "connected")).toBe("reconnecting");
  });
});

describe("lesson context", () => {
  test("falls back to the first lesson and finds its note, module and own answer", () => {
    const { snapshot } = deskFixture();
    const course = snapshot.course;
    course.submissions = [
      { id: "s_other", lessonId: "l1", exerciseId: "ex_l1", accountId: "someone", answer: "x", sharedWithPeers: false, version: 1, updatedAt: "2026-08-03T16:00:00.000Z" },
      { id: "s_mine", lessonId: "l1", exerciseId: "ex_l1", accountId: "student_1", answer: "mine", sharedWithPeers: true, version: 2, updatedAt: "2026-08-03T16:00:00.000Z" },
    ] as never;
    const lessons = allCourseLessons(course);
    const ctx = resolveLessonContext(course, lessons, "missing", "student_1");
    expect(ctx.activeLesson?.id).toBe("l1");
    expect(ctx.activeModule?.id).toBe("m1");
    expect(ctx.sharedNote?.id).toBe("n1");
    expect(ctx.ownSubmission?.id).toBe("s_mine");
    expect(resolveLessonContext(course, lessons, "l2", "student_1").sharedNote).toBeUndefined();
  });
  test("no course resolves to nothing", () => {
    expect(resolveLessonContext(undefined, [], "", undefined).activeLesson).toBeUndefined();
  });
  test("completion reads the viewer's progress", () => {
    const { snapshot } = deskFixture();
    const lesson = snapshot.course.modules[0]!.lessons[0]!;
    expect(isLessonCompleted(snapshot, lesson)).toBe(false);
    snapshot.viewer.progress.completedLessonIds = ["l1"];
    expect(isLessonCompleted(snapshot, lesson)).toBe(true);
    expect(isLessonCompleted(snapshot, undefined)).toBe(false);
  });
});

describe("search result navigation", () => {
  const { snapshot } = deskFixture();
  const course = snapshot.course;
  const result = (kind: string, id: string, lessonId?: string): CourseSearchResult =>
    ({ key: `${kind}:${id}`, kind, id, title: "t", detail: "", score: 1, ...(lessonId ? { lessonId } : {}) }) as CourseSearchResult;
  const editor = perms({ canEditCourse: true, canEditDeck: true });

  test("lessons open on the reading desk", () => {
    expect(resolveSearchNavigation(result("lesson", "l2"), course, perms())).toEqual({ kind: "lesson", lessonId: "l2", view: "read" });
  });
  test("a module opens the outline builder for editors, its first lesson for learners", () => {
    expect(resolveSearchNavigation(result("module", "m1"), course, editor)).toEqual({ kind: "builder", section: "outline" });
    expect(resolveSearchNavigation(result("module", "m1"), course, perms())).toEqual({ kind: "lesson", lessonId: "l1", view: "read" });
    expect(resolveSearchNavigation(result("module", "m2"), course, perms())).toBeNull();
  });
  test("documents open their own url, or the course file route", () => {
    expect(resolveSearchNavigation(result("document", "mat_l"), course, perms())).toEqual({ kind: "url", url: "https://example.com/a" });
    const stored = resolveSearchNavigation(result("document", "mat_c"), course, perms());
    expect(stored?.kind).toBe("url");
    expect((stored as { url: string }).url).toContain("mat_c");
    expect(resolveSearchNavigation(result("document", "gone"), course, perms())).toBeNull();
  });
  test("comments open the lesson thread or the course thread", () => {
    expect(resolveSearchNavigation(result("comment", "c", "l1"), course, perms())).toEqual({ kind: "discussion", lessonId: "l1" });
    expect(resolveSearchNavigation(result("comment", "c"), course, perms())).toEqual({ kind: "discussion" });
  });
  test("cards, members, assignments and artifacts need edit rights unless tied to a lesson", () => {
    expect(resolveSearchNavigation(result("card", "x"), course, perms())).toBeNull();
    expect(resolveSearchNavigation(result("card", "x"), course, editor)).toEqual({ kind: "builder", section: "cards" });
    expect(resolveSearchNavigation(result("member", "x"), course, perms({ canEditDeck: true }))).toBeNull();
    expect(resolveSearchNavigation(result("member", "x"), course, editor)).toEqual({ kind: "builder", section: "access" });
    expect(resolveSearchNavigation(result("assignment", "a"), course, editor)).toEqual({ kind: "builder", section: "assignments" });
    expect(resolveSearchNavigation(result("artifact", "a"), course, editor)).toEqual({ kind: "builder", section: "artifacts" });
    expect(resolveSearchNavigation(result("assignment", "a"), course, perms())).toBeNull();
    expect(resolveSearchNavigation(result("assignment", "a", "l1"), course, perms())).toEqual({ kind: "lesson", lessonId: "l1", view: "read" });
  });
});

describe("workspace actions", () => {
  function setup() {
    const sent: Array<{ op: CourseOperation; label: string }> = [];
    const { snapshot } = deskFixture();
    snapshot.course.revision = 9;
    const actions = createWorkspaceActions(snapshot.course, async (op, label) => {
      sent.push({ op, label });
    });
    return { sent, actions, course: snapshot.course };
  }

  test("every action targets the viewed course and revision with a fresh operation id", () => {
    const { sent, actions } = setup();
    actions.toggleReaction("comment", "c1", "👍");
    actions.respondToTeacherAccess(true);
    expect(sent.map((s) => s.op.courseId)).toEqual(["course_outline", "course_outline"]);
    expect(sent.map((s) => s.op.baseRevision)).toEqual([9, 9]);
    expect(new Set(sent.map((s) => s.op.id)).size).toBe(2);
  });
  test("labels and payloads for each write", () => {
    const { sent, actions, course } = setup();
    const lesson = course.modules[0]!.lessons[0]!;
    actions.toggleReaction("comment", "c1", "👍");
    actions.respondToTeacherAccess(false);
    actions.setLessonCompleted(lesson, true);
    actions.saveSharedNote(lesson, undefined, "text");
    actions.saveSharedNote(lesson, course.sharedNotes[0], "again");
    actions.reviewSubmission("sub", "good");
    actions.reviewAssignmentSubmission("asub", "fine");
    actions.requestTeacherAccess("student_1");
    expect(sent.map((s) => s.label)).toEqual([
      "reaction-c1-👍", "access", "complete", "note", "note", "review", "assignment-review", "access",
    ]);
    expect(sent[1]!.op).toMatchObject({ type: "teacher-access.respond", approve: false });
    expect(sent[2]!.op).toMatchObject({ type: "lesson.complete", lessonId: "l1", completed: true });
    expect(sent[3]!.op).toMatchObject({ type: "shared-note.update", noteId: "note_l1", baseVersion: 0, text: "text", title: `${lesson.title} notes` });
    expect(sent[4]!.op).toMatchObject({ noteId: "n1", baseVersion: 2, text: "again" });
    expect(sent[5]!.op).toMatchObject({ type: "submission.review", status: "reviewed", feedback: "good" });
    expect(sent[6]!.op).toMatchObject({ type: "assignment.submission.review", submissionId: "asub" });
    expect(sent[7]!.op).toMatchObject({ type: "teacher-access.request", memberAccountId: "student_1" });
  });
  test("saving an answer reuses the learner's submission id and skips lessons without an exercise", () => {
    const { sent, actions, course } = setup();
    const lesson = course.modules[0]!.lessons[0]!;
    actions.saveAnswer(lesson, { id: "s_mine" } as never, "a", true);
    actions.saveAnswer(lesson, undefined, "b", false);
    actions.saveAnswer({ ...lesson, exercise: undefined } as never, undefined, "c", false);
    expect(sent).toHaveLength(2);
    expect(sent[0]!.op).toMatchObject({ type: "submission.save", submissionId: "s_mine", exerciseId: "ex_l1", answer: "a", sharedWithPeers: true });
    expect((sent[1]!.op as { submissionId: string }).submissionId).toMatch(/^submission_[a-f0-9]{32}$/);
  });
});

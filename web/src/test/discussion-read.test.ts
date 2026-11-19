import { expect, test } from "bun:test";
import { discussionUnread } from "../courses/discussion-read";
import type { CourseComment } from "../courses/contracts";
import { courseWorkspaceReducer, INITIAL_WORKSPACE_STATE } from "../pages/course-workspace/state";
import { deskFixture } from "./course-outline-fixtures";

test("discussion cursors survive revisits and isolate channels, accounts and courses", () => {
  const data = new Map<string, string>();
  const store = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  };
  const comments: CourseComment[] = [];
  function post(accountId: string, lessonId?: string) {
    const sequence = comments.length + 1;
    comments.push({ id: String(sequence), accountId, body: "Question", createdAt: new Date(sequence * 1000).toISOString(), ...(lessonId ? { lessonId } : {}) });
  }
  const counts = (channel?: string) => discussionUnread(store, "course1", "viewer", comments, channel);
  post("peer", "lesson1");
  expect(counts()).toEqual({});
  post("peer", "lesson1");
  post("peer");
  post("viewer", "lesson1");
  expect(counts()).toEqual({ course: 1, lesson1: 1 });
  expect(counts("lesson1")).toEqual({ course: 1 });
  expect(counts()).toEqual({ course: 1 });
  expect(discussionUnread(store, "course1", "peer", comments)).toEqual({});
  expect(discussionUnread(store, "course2", "viewer", comments)).toEqual({});
  post("peer", "new-lesson");
  expect(counts("__course__")).toEqual({ "new-lesson": 1 });
  expect(counts("__all__")).toEqual({});
  expect(counts()).toEqual({});
});

test("a requested Review tab requires reviewer permission even on an empty course", () => {
  const { snapshot } = deskFixture();
  snapshot.course.modules = [];
  const initial = { ...INITIAL_WORKSPACE_STATE, view: "review" as const };
  snapshot.permissions.canReview = true;
  expect(courseWorkspaceReducer(initial, { type: "snapshot.received", snapshot }).view).toBe("review");
  snapshot.permissions.canReview = false;
  snapshot.permissions.canEditCourse = false;
  expect(courseWorkspaceReducer(initial, { type: "snapshot.received", snapshot }).view).toBe("read");
});

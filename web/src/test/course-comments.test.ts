import { describe, expect, test } from "bun:test";
import {
  buildCommentThreads,
  commentCounts,
  summarizeReactions,
} from "../courses/course-comments";
import type { CourseComment, CourseReaction } from "../courses/contracts";

function comment(
  id: string,
  createdAt: string,
  extra: Partial<CourseComment> = {},
): CourseComment {
  return {
    id,
    accountId: "student_1",
    body: `Body of ${id}`,
    createdAt,
    ...extra,
  };
}

const COMMENTS: CourseComment[] = [
  comment("c_lesson_old", "2026-08-01T10:00:00.000Z", {
    lessonId: "lesson_1",
    body: "Older lesson question about colliders",
  }),
  comment("c_lesson_new", "2026-08-03T10:00:00.000Z", {
    lessonId: "lesson_1",
    body: "Newer lesson question",
  }),
  comment("c_reply", "2026-08-04T10:00:00.000Z", {
    lessonId: "lesson_1",
    parentId: "c_lesson_old",
    body: "A reply that revives the thread",
  }),
  comment("c_course", "2026-08-02T10:00:00.000Z", {
    body: "Course-wide notice",
  }),
];

describe("course comment threads", () => {
  test("a lesson channel shows only its own threads", () => {
    const threads = buildCommentThreads(COMMENTS, {
      kind: "lesson",
      lessonId: "lesson_1",
    });
    expect(threads.map((thread) => thread.comment.id)).toEqual([
      "c_lesson_old",
      "c_lesson_new",
    ]);
    expect(threads[0]?.replies.map((reply) => reply.id)).toEqual(["c_reply"]);
  });

  test("a revived thread floats above a quieter newer one", () => {
    const [first] = buildCommentThreads(COMMENTS, {
      kind: "lesson",
      lessonId: "lesson_1",
    });
    expect(first?.comment.id).toBe("c_lesson_old");
    expect(first?.lastActivityAt).toBe("2026-08-04T10:00:00.000Z");
  });

  test("the course channel holds only comments without a lesson", () => {
    expect(
      buildCommentThreads(COMMENTS, { kind: "course" }).map(
        (thread) => thread.comment.id,
      ),
    ).toEqual(["c_course"]);
  });

  test("a search keeps a thread when only a reply matches", () => {
    const threads = buildCommentThreads(
      COMMENTS,
      { kind: "all" },
      "revives",
    );
    expect(threads.map((thread) => thread.comment.id)).toEqual(["c_lesson_old"]);
    expect(buildCommentThreads(COMMENTS, { kind: "all" }, "nothing")).toEqual(
      [],
    );
  });

  test("counts are per lesson with a bucket for the course thread", () => {
    expect(commentCounts(COMMENTS)).toEqual({ lesson_1: 3, course: 1 });
  });
});

describe("course reactions", () => {
  const reactions: CourseReaction[] = [
    {
      targetKind: "comment",
      targetId: "c_lesson_old",
      emoji: "👍",
      accountId: "student_1",
      createdAt: "2026-08-04T11:00:00.000Z",
    },
    {
      targetKind: "comment",
      targetId: "c_lesson_old",
      emoji: "👍",
      accountId: "teacher_1",
      createdAt: "2026-08-04T11:05:00.000Z",
    },
    {
      targetKind: "comment",
      targetId: "c_lesson_old",
      emoji: "❓",
      accountId: "teacher_1",
      createdAt: "2026-08-04T11:06:00.000Z",
    },
    {
      targetKind: "artifact",
      targetId: "artifact_1",
      emoji: "👍",
      accountId: "student_1",
      createdAt: "2026-08-04T11:07:00.000Z",
    },
  ];

  test("summaries count one target, most used first, and mark the viewer", () => {
    const summary = summarizeReactions(
      reactions,
      "comment",
      "c_lesson_old",
      "student_1",
    );
    expect(summary).toEqual([
      {
        emoji: "👍",
        count: 2,
        reacted: true,
        accountIds: ["student_1", "teacher_1"],
      },
      { emoji: "❓", count: 1, reacted: false, accountIds: ["teacher_1"] },
    ]);
  });

  test("a target with no reactions summarizes to nothing", () => {
    expect(summarizeReactions(reactions, "material", "material_1", "student_1")).toEqual(
      [],
    );
  });
});

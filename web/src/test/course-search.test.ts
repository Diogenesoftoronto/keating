import { describe, expect, test } from "bun:test";
import { courseSchema, type Course } from "../courses/contracts";
import { searchCourse } from "../courses/course-search";
import { courseAskActions, courseChatSearch, truncateAsk } from "../courses/course-ask";

const NOW = "2026-08-10T09:00:00.000Z";

function fixture(): Course {
  return courseSchema.parse({
    schemaVersion: 1,
    id: "course_causal",
    title: "Causal Inference",
    description: "From potential outcomes to identification.",
    outcomes: [],
    ownerAccountId: "teacher_1",
    createdAt: NOW,
    updatedAt: NOW,
    revision: 3,
    modules: [
      {
        id: "module_1",
        title: "Counterfactuals",
        description: "What would have happened otherwise",
        lessons: [
          {
            id: "lesson_1",
            title: "Correlation to intervention",
            summary: "Observation is not intervention",
            reading: "A confounder produces association without causation.",
            objectives: ["Name a plausible confounder"],
            materialIds: [],
            cardIds: [],
          },
          {
            id: "lesson_2",
            title: "Colliders",
            summary: "",
            reading: "Conditioning on a collider opens a path.",
            objectives: [],
            materialIds: [],
            cardIds: [],
          },
        ],
      },
    ],
    materials: [
      {
        id: "material_1",
        kind: "link",
        title: "Book of Why",
        url: "https://example.com/why",
        lessonId: "lesson_1",
        createdAt: NOW,
        createdBy: "teacher_1",
      },
    ],
    cards: [
      {
        id: "card_1",
        front: "What is a collider?",
        back: "A common effect of two variables",
        tags: ["dag"],
        updatedAt: NOW,
        updatedBy: "teacher_1",
      },
    ],
    artifacts: [],
    assignments: [
      {
        id: "assignment_1",
        title: "Field study",
        brief: "Find a confounder in a published claim.",
        deliverables: [],
        rubric: [],
        updatedAt: NOW,
        updatedBy: "teacher_1",
      },
    ],
    members: [
      {
        accountId: "teacher_1",
        displayName: "Professor Keating",
        role: "owner",
        teacherAccess: "full",
        joinedAt: NOW,
        progress: { completedLessonIds: [], lastActiveAt: NOW },
      },
    ],
    sharedNotes: [],
    submissions: [],
    assignmentSubmissions: [],
    comments: [
      {
        id: "comment_1",
        lessonId: "lesson_2",
        accountId: "teacher_1",
        body: "Watch for a collider hiding in the sample.",
        createdAt: NOW,
      },
    ],
    reactions: [],
    activity: [],
    settings: {
      teacherAccessPolicy: "request",
      allowPeerDeckEdits: true,
      allowPeerComments: true,
    },
  });
}

describe("course search", () => {
  test("an empty query returns nothing", () => {
    expect(searchCourse(fixture(), "   ")).toEqual([]);
  });

  test("a title match outranks a body match of the same word", () => {
    const results = searchCourse(fixture(), "collider");
    expect(results[0]?.kind).toBe("lesson");
    expect(results[0]?.id).toBe("lesson_2");
    expect(results.map((result) => result.kind)).toContain("comment");
    expect(results.map((result) => result.kind)).toContain("card");
  });

  test("every token must appear somewhere in the same item", () => {
    expect(
      searchCourse(fixture(), "confounder published").map(
        (result) => result.id,
      ),
    ).toEqual(["assignment_1"]);
    expect(searchCourse(fixture(), "confounder unicorn")).toEqual([]);
  });

  test("results carry the lesson to open and a readable excerpt", () => {
    const [result] = searchCourse(fixture(), "association");
    expect(result?.kind).toBe("lesson");
    expect(result?.lessonId).toBe("lesson_1");
    expect(result?.detail).toContain("association");
  });

  test("kinds can be narrowed and results limited", () => {
    const results = searchCourse(fixture(), "collider", {
      kinds: ["comment"],
      limit: 1,
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.kind).toBe("comment");
  });

  test("documents are searchable by their link", () => {
    expect(searchCourse(fixture(), "example.com")[0]?.id).toBe("material_1");
  });
});

describe("course hand-off to Keating", () => {
  test("lesson actions name the lesson and refuse to act unasked", () => {
    const actions = courseAskActions({
      courseTitle: "Causal Inference",
      lessonTitle: "Colliders",
      lessonId: "lesson_2",
      view: "read",
    });
    const sources = actions.find((action) => action.id === "lesson-sources");
    expect(sources?.prompt).toContain("Colliders");
    expect(sources?.prompt).toContain("lesson_2");
    expect(sources?.prompt).toMatch(/[Aa]sk me before adding/);
  });

  test("a course without an open lesson still offers course-level work", () => {
    const actions = courseAskActions({
      courseTitle: "Causal Inference",
      view: "build",
    });
    expect(actions.map((action) => action.id)).toEqual([
      "course-gaps",
      "course-next",
    ]);
  });

  test("chat links carry the course, edit mode, and a bounded ask", () => {
    expect(courseChatSearch("course_causal")).toEqual({
      course: "course_causal",
      courseMode: "edit",
    });
    const long = "x".repeat(2_500);
    const search = courseChatSearch("course_causal", long);
    expect(search.ask?.length).toBe(2_000);
    expect(truncateAsk("short")).toBe("short");
  });
});

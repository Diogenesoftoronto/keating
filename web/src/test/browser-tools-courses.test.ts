import { afterEach, describe, expect, test } from "bun:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  appendCourseCollaborationPrompt,
  courseCollaborationPrompt,
  createCourseTools,
} from "../keating/browser-tools/courses";
import type { CourseViewerSnapshot } from "../courses/contracts";
import {
  courseChatContext,
  courseCollaborationStarterPrompts,
} from "../keating/course-collaboration";

const originalFetch = globalThis.fetch;
const NOW = "2026-08-09T04:00:00.000Z";

function snapshot(revision = 4): CourseViewerSnapshot {
  return {
    course: {
      schemaVersion: 1,
      id: "course_collab",
      title: "Collaborative Systems",
      description: "A course built with Keating.",
      outcomes: ["Design a collaborative workflow"],
      ownerAccountId: "learner_1",
      createdAt: NOW,
      updatedAt: NOW,
      revision,
      modules: [
        {
          id: "module_foundations",
          title: "Foundations",
          description: "",
          lessons: [
            {
              id: "lesson_existing",
              title: "Existing lesson",
              summary: "",
              objectives: [],
              reading: "Keep this lesson.",
              materialIds: [],
              cardIds: [],
            },
          ],
        },
      ],
      materials: [],
      cards: [],
      artifacts: [],
      assignments: [],
      members: [
        {
          accountId: "learner_1",
          displayName: "Learner",
          role: "owner",
          teacherAccess: "full",
          joinedAt: NOW,
          progress: { completedLessonIds: [], lastActiveAt: NOW },
        },
      ],
      sharedNotes: [],
      submissions: [
        {
          id: "submission_private",
          lessonId: "lesson_existing",
          exerciseId: "exercise_private",
          accountId: "learner_1",
          answer: "PRIVATE SUBMISSION BODY",
          sharedWithPeers: false,
          version: 1,
          updatedAt: NOW,
        },
      ],
      assignmentSubmissions: [],
      comments: [],
      reactions: [],
      activity: [],
      settings: {
        teacherAccessPolicy: "request",
        allowPeerDeckEdits: true,
        allowPeerComments: true,
      },
    },
    viewer: {
      accountId: "learner_1",
      displayName: "Learner",
      role: "owner",
      teacherAccess: "full",
      joinedAt: NOW,
      progress: { completedLessonIds: [], lastActiveAt: NOW },
    },
    permissions: {
      canEditCourse: true,
      canInvite: true,
      canReview: true,
      canEditDeck: true,
      canRequestTeacherAccess: true,
    },
  };
}

async function runTool(
  tools: AgentTool[],
  name: string,
  params: Record<string, unknown> = {},
): Promise<string> {
  const tool = tools.find((candidate) => candidate.name === name);
  expect(tool, `${name} should be registered`).toBeDefined();
  const result = (await tool!.execute!(`call_${name}`, params)) as unknown as {
    content: Array<{ type: string; text: string }>;
  };
  return result.content.map((part) => part.text).join("\n");
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("course collaboration tools", () => {
  test("derives creation and active-course chat entry states", () => {
    expect(courseChatContext({ courseMode: "create" })).toEqual({
      mode: "create",
    });
    expect(
      courseChatContext({ course: "course_collab", courseMode: "create" }),
    ).toEqual({ mode: "edit", activeCourseId: "course_collab" });
    expect(courseChatContext({ courseMode: "edit" })).toBeUndefined();

    const prompts = courseCollaborationStarterPrompts({
      mode: "edit",
      activeCourseId: "course_collab",
    });
    expect(prompts).toHaveLength(3);
    expect(prompts[0]?.text).toContain("Inspect this course");
  });

  test("frames course creation as an agreed, iterative collaboration", () => {
    expect(courseCollaborationPrompt({ mode: "create" })).toContain(
      "Offer a compact outline and invite corrections before calling course_create",
    );
    expect(
      courseCollaborationPrompt({
        mode: "edit",
        activeCourseId: "course_collab",
      }),
    ).toContain("The active course is `course_collab`");
    const switched = appendCourseCollaborationPrompt(
      `Base prompt\n\n${courseCollaborationPrompt({ activeCourseId: "course_old" })}`,
      { mode: "edit", activeCourseId: "course_collab" },
    );
    expect(switched).toContain("The active course is `course_collab`");
    expect(switched).not.toContain("course_old");
    expect(switched.match(/## Course collaboration/g)).toHaveLength(1);
  });

  test("creates an agreed outline and returns a durable workspace link", async () => {
    let request:
      | { url: string; method: string; body: Record<string, unknown> }
      | undefined;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      request = {
        url: String(input),
        method: init?.method ?? "GET",
        body: JSON.parse(String(init?.body ?? "{}")),
      };
      return Response.json(snapshot(0));
    }) as typeof fetch;

    const result = await runTool(createCourseTools(), "course_create", {
      title: "Collaborative Systems",
      description: "For experienced facilitators.",
      outcomes: ["Design a collaborative workflow"],
      modules: [
        {
          title: "Foundations",
          lessons: [
            {
              title: "Shared intent",
              reading: "Start with the decisions collaborators share.",
              estimated_minutes: 30,
            },
          ],
        },
      ],
    });

    expect(request?.url).toBe("/api/courses");
    expect(request?.method).toBe("POST");
    expect(request?.body.modules).toEqual([
      expect.objectContaining({
        title: "Foundations",
        lessons: [
          expect.objectContaining({
            title: "Shared intent",
            estimatedMinutes: 30,
          }),
        ],
      }),
    ]);
    expect(result).toContain("Created “Collaborative Systems”");
    expect(result).toContain("/courses/course_collab");
  });

  test("uses active course context and its current revision for lesson changes", async () => {
    const requests: Array<{
      url: string;
      method: string;
      body?: Record<string, unknown>;
    }> = [];
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const request = {
        url: String(input),
        method: init?.method ?? "GET",
        ...(init?.body
          ? { body: JSON.parse(String(init.body)) as Record<string, unknown> }
          : {}),
      };
      requests.push(request);
      return request.method === "POST"
        ? Response.json({ snapshot: snapshot(5), applied: true })
        : Response.json(snapshot(4));
    }) as typeof fetch;

    const result = await runTool(
      createCourseTools({
        course: { mode: "edit", activeCourseId: "course_collab" },
      }),
      "course_update",
      {
        action: "upsert_lesson",
        module_id: "module_foundations",
        title: "Shared decisions",
        objectives: ["Name the decisions collaborators must share"],
        reading: "Make the shared decisions explicit.",
      },
    );

    expect(requests.map((request) => request.url)).toEqual([
      "/api/courses/course_collab",
      "/api/courses/course_collab/operations",
    ]);
    expect(requests[1]?.body).toEqual(
      expect.objectContaining({
        courseId: "course_collab",
        baseRevision: 4,
        type: "lesson.update",
        moduleId: "module_foundations",
        lesson: expect.objectContaining({
          title: "Shared decisions",
          materialIds: [],
          cardIds: [],
        }),
      }),
    );
    expect(result).toContain("Course revision is now 5");
  });

  test("inspection exposes structure but not submission bodies", async () => {
    globalThis.fetch = (async () =>
      Response.json(snapshot())) as unknown as typeof fetch;

    const result = await runTool(
      createCourseTools({
        course: { mode: "edit", activeCourseId: "course_collab" },
      }),
      "course_inspect",
    );

    expect(result).toContain("module_foundations");
    expect(result).toContain("lesson_existing");
    expect(result).not.toContain("PRIVATE SUBMISSION BODY");
  });
});

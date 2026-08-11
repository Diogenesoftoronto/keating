import { describe, expect, test } from "bun:test";
import {
  normalizeCourseViewerSnapshot,
  type Course,
  type CourseOperation,
  type CourseViewerSnapshot,
} from "../courses/contracts";
import {
  applyCourseOperation,
  CourseAuthorizationError,
  CourseConflictError,
  projectCourseForViewer,
} from "../courses/operations";
import { projectCourseForPear } from "../../server/utils/course-pear-gateway";
import {
  courseDevAccountId,
  localCourseAccountIdFromSecret,
  courseSessionMode,
} from "../../server/utils/course-session";

const NOW = "2026-08-03T16:00:00.000Z";

function courseFixture(): Course {
  return {
    schemaVersion: 1,
    id: "course_causal",
    title: "Causal Inference",
    description: "Work from potential outcomes to identification.",
    outcomes: ["Distinguish intervention from observation"],
    ownerAccountId: "teacher_1",
    createdAt: NOW,
    updatedAt: NOW,
    revision: 4,
    modules: [
      {
        id: "module_1",
        title: "Counterfactuals",
        description: "",
        lessons: [
          {
            id: "lesson_1",
            title: "Correlation to intervention",
            summary: "",
            objectives: [],
            reading: "Correlation observes; causation intervenes.",
            materialIds: [],
            cardIds: [],
            exercise: {
              id: "exercise_1",
              prompt: "Give two non-causal explanations.",
              rubric: [],
            },
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
        accountId: "teacher_1",
        displayName: "Professor Keating",
        role: "owner",
        teacherAccess: "full",
        joinedAt: NOW,
        progress: { completedLessonIds: [], lastActiveAt: NOW },
      },
      {
        accountId: "student_1",
        displayName: "Maya Patel",
        role: "student",
        teacherAccess: "private",
        joinedAt: NOW,
        progress: { completedLessonIds: [], lastActiveAt: NOW },
      },
    ],
    sharedNotes: [],
    submissions: [],
    assignmentSubmissions: [],
    comments: [],
    reactions: [],
    activity: [],
    settings: {
      teacherAccessPolicy: "request",
      allowPeerDeckEdits: true,
      allowPeerComments: true,
    },
  };
}

function operation<T extends CourseOperation>(value: T): T {
  return value;
}

describe("course operations", () => {
  test("normalizes collections missing from legacy course snapshots", () => {
    const legacy = projectCourseForViewer(
      courseFixture(),
      "teacher_1",
    ) as CourseViewerSnapshot;
    delete (legacy.course as Partial<Course>).artifacts;
    delete (legacy.course as Partial<Course>).assignments;
    delete (legacy.course as Partial<Course>).assignmentSubmissions;

    const normalized = normalizeCourseViewerSnapshot(legacy);

    expect(normalized.course.artifacts).toEqual([]);
    expect(normalized.course.assignments).toEqual([]);
    expect(normalized.course.assignmentSubmissions).toEqual([]);
  });

  test("development course auth is impossible in production", () => {
    expect(
      courseDevAccountId({
        NODE_ENV: "production",
        KEATING_COURSES_DEV_ACCOUNT_ID: "demo",
      }),
    ).toBeNull();
    expect(
      courseDevAccountId({
        NODE_ENV: "development",
        KEATING_COURSES_DEV_ACCOUNT_ID: "demo",
      }),
    ).toBe("demo");
  });
  test("courses fall back to local access only when hosted access is disabled", () => {
    expect(courseSessionMode({ NODE_ENV: "development" })).toBe("local");
    expect(courseSessionMode({ NODE_ENV: "production" })).toBe("local");
    expect(courseSessionMode({ NOTORGANIC_ENABLED: "true" })).toBe("hosted");
    expect(
      courseSessionMode({
        NODE_ENV: "development",
        KEATING_COURSES_DEV_ACCOUNT_ID: "demo",
        NOTORGANIC_ENABLED: "true",
      }),
    ).toBe("development");
  });
  test("local course identity does not expose its browser cookie secret", async () => {
    const secret = "0123456789abcdef0123456789abcdef";
    const accountId = await localCourseAccountIdFromSecret(secret);
    expect(accountId).toStartWith("local_");
    expect(accountId).not.toContain(secret);
    expect(await localCourseAccountIdFromSecret(secret)).toBe(accountId);
    expect(
      await localCourseAccountIdFromSecret("fedcba9876543210fedcba9876543210"),
    ).not.toBe(accountId);
  });
  test("learners update only their own progress", () => {
    const next = applyCourseOperation(
      courseFixture(),
      "student_1",
      operation({
        id: "op_complete",
        courseId: "course_causal",
        baseRevision: 4,
        type: "lesson.complete",
        lessonId: "lesson_1",
        completed: true,
      }),
      NOW,
    );

    expect(
      next.members.find((member) => member.accountId === "student_1")?.progress
        .completedLessonIds,
    ).toEqual(["lesson_1"]);
    expect(
      next.members.find((member) => member.accountId === "teacher_1")?.progress
        .completedLessonIds,
    ).toEqual([]);
    expect(next.revision).toBe(5);
    expect(next.activity[0]?.id).toBe("op_complete");
  });

  test("teachers can assemble and remove modules and lessons from a blank outline", () => {
    const blank = courseFixture();
    blank.modules = [];
    const withModule = applyCourseOperation(
      blank,
      "teacher_1",
      operation({
        id: "op_module_add",
        courseId: blank.id,
        baseRevision: 4,
        type: "module.upsert",
        module: {
          id: "module_new",
          title: "New module",
          description: "",
          lessons: [],
        },
      }),
      NOW,
    );
    const withLesson = applyCourseOperation(
      withModule,
      "teacher_1",
      operation({
        id: "op_lesson_add",
        courseId: blank.id,
        baseRevision: 5,
        type: "lesson.update",
        moduleId: "module_new",
        lesson: {
          id: "lesson_new",
          title: "First lesson",
          summary: "",
          objectives: [],
          reading: "",
          materialIds: [],
          cardIds: [],
        },
      }),
      NOW,
    );

    expect(withLesson.modules[0]?.lessons[0]?.title).toBe("First lesson");
    const removed = applyCourseOperation(
      withLesson,
      "teacher_1",
      operation({
        id: "op_lesson_remove",
        courseId: blank.id,
        baseRevision: 6,
        type: "lesson.delete",
        moduleId: "module_new",
        lessonId: "lesson_new",
      }),
      NOW,
    );
    expect(removed.modules[0]?.lessons).toEqual([]);
  });

  test("card edits maintain lesson references and deletion cleans them", () => {
    const withCard = applyCourseOperation(
      courseFixture(),
      "teacher_1",
      operation({
        id: "op_card_add",
        courseId: "course_causal",
        baseRevision: 4,
        type: "card.upsert",
        card: {
          id: "card_new",
          front: "Intervention?",
          back: "A deliberately assigned change.",
          tags: ["causal"],
          lessonId: "lesson_1",
        },
      }),
      NOW,
    );
    expect(withCard.modules[0]?.lessons[0]?.cardIds).toEqual(["card_new"]);

    const removed = applyCourseOperation(
      withCard,
      "teacher_1",
      operation({
        id: "op_card_remove",
        courseId: "course_causal",
        baseRevision: 5,
        type: "card.delete",
        cardId: "card_new",
      }),
      NOW,
    );
    expect(removed.cards).toEqual([]);
    expect(removed.modules[0]?.lessons[0]?.cardIds).toEqual([]);
  });

  test("saved decks import atomically", () => {
    const imported = applyCourseOperation(
      courseFixture(),
      "teacher_1",
      operation({
        id: "op_deck_import",
        courseId: "course_causal",
        baseRevision: 4,
        type: "cards.import",
        cards: [
          {
            id: "card_a",
            front: "Prior",
            back: "A belief before new evidence.",
            tags: ["bayes"],
          },
          {
            id: "card_b",
            front: "Likelihood",
            back: "Evidence expected under a hypothesis.",
            tags: ["bayes"],
            lessonId: "lesson_1",
          },
        ],
      }),
      NOW,
    );

    expect(imported.cards.map((card) => card.id)).toEqual(["card_a", "card_b"]);
    expect(imported.modules[0]?.lessons[0]?.cardIds).toEqual(["card_b"]);
    expect(imported.revision).toBe(5);
  });

  test("teachers can import, attach, edit, and remove durable artifacts", () => {
    const imported = applyCourseOperation(
      courseFixture(),
      "teacher_1",
      operation({
        id: "op_artifacts_import",
        courseId: "course_causal",
        baseRevision: 4,
        type: "artifacts.import",
        artifacts: [
          {
            id: "artifact_quiz",
            kind: "quiz",
            format: "quiz",
            title: "Counterfactual quiz",
            content: "{}",
            lessonId: "lesson_1",
            sourceId: "saved-quiz-1",
          },
        ],
      }),
      NOW,
    );

    expect(imported.artifacts[0]).toMatchObject({
      title: "Counterfactual quiz",
      lessonId: "lesson_1",
      updatedBy: "teacher_1",
    });
    const edited = applyCourseOperation(
      imported,
      "teacher_1",
      operation({
        id: "op_artifact_edit",
        courseId: "course_causal",
        baseRevision: 5,
        type: "artifact.upsert",
        artifact: {
          id: "artifact_quiz",
          kind: "quiz",
          format: "quiz",
          title: "Edited quiz",
          content: '{"questions":[]}',
        },
      }),
      NOW,
    );
    expect(edited.artifacts[0]?.title).toBe("Edited quiz");
    expect(edited.artifacts[0]?.lessonId).toBeUndefined();

    const removed = applyCourseOperation(
      edited,
      "teacher_1",
      operation({
        id: "op_artifact_remove",
        courseId: "course_causal",
        baseRevision: 6,
        type: "artifact.delete",
        artifactId: "artifact_quiz",
      }),
      NOW,
    );
    expect(removed.artifacts).toEqual([]);
  });

  test("removing a lesson returns its artifacts to the course tray", () => {
    const course = courseFixture();
    course.artifacts.push({
      id: "artifact_map",
      kind: "lesson-map",
      format: "mermaid",
      title: "Causal map",
      content: "graph LR; A-->B",
      lessonId: "lesson_1",
      updatedAt: NOW,
      updatedBy: "teacher_1",
    });
    const removed = applyCourseOperation(
      course,
      "teacher_1",
      operation({
        id: "op_lesson_remove_artifact",
        courseId: "course_causal",
        baseRevision: 4,
        type: "lesson.delete",
        moduleId: "module_1",
        lessonId: "lesson_1",
      }),
      NOW,
    );
    expect(removed.artifacts[0]?.lessonId).toBeUndefined();
    expect(removed.artifacts[0]?.content).toBe("graph LR; A-->B");
  });

  test("course-wide and lesson assignments preserve learner drafts and consent", () => {
    const assigned = applyCourseOperation(
      courseFixture(),
      "teacher_1",
      operation({
        id: "op_assignment_add",
        courseId: "course_causal",
        baseRevision: 4,
        type: "assignment.upsert",
        assignment: {
          id: "assignment_fieldwork",
          title: "Intervention audit",
          brief: "Audit one causal claim over several days.",
          deliverables: ["Claim memo", "Revised diagram"],
          rubric: ["Names assumptions", "Uses evidence"],
          estimatedHours: 6,
        },
      }),
      NOW,
    );
    const submitted = applyCourseOperation(
      assigned,
      "student_1",
      operation({
        id: "op_assignment_submit",
        courseId: "course_causal",
        baseRevision: 5,
        type: "assignment.submission.save",
        submissionId: "assignment_submission_1",
        assignmentId: "assignment_fieldwork",
        answer: "Draft memo and evidence log.",
        status: "submitted",
        sharedWithPeers: false,
        baseVersion: 0,
      }),
      NOW,
    );

    expect(
      projectCourseForViewer(submitted, "student_1").course
        .assignmentSubmissions,
    ).toHaveLength(1);
    expect(
      projectCourseForViewer(submitted, "teacher_1").course
        .assignmentSubmissions,
    ).toHaveLength(0);
    submitted.members[1]!.teacherAccess = "full";
    expect(
      projectCourseForViewer(submitted, "teacher_1").course
        .assignmentSubmissions[0]?.status,
    ).toBe("submitted");
  });

  test("viewer snapshots never expose document storage keys", () => {
    const course = courseFixture();
    course.materials.push({
      id: "document_1",
      kind: "document",
      title: "Reading",
      storageKey: "private-storage-key",
      createdAt: NOW,
      createdBy: "teacher_1",
    });
    expect(
      projectCourseForViewer(course, "teacher_1").course.materials[0]
        ?.storageKey,
    ).toBeUndefined();
  });

  test("documents and images can move between lessons and be removed cleanly", () => {
    const added = applyCourseOperation(
      courseFixture(),
      "teacher_1",
      operation({
        id: "op_document_add",
        courseId: "course_causal",
        baseRevision: 4,
        type: "material.add",
        material: {
          id: "material_reading",
          kind: "document",
          title: "Field notes",
          fileName: "notes.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
          storageKey: "course:course_causal:material:material_reading",
          lessonId: "lesson_1",
        },
      }),
      NOW,
    );
    expect(added.modules[0]?.lessons[0]?.materialIds).toEqual([
      "material_reading",
    ]);

    const removed = applyCourseOperation(
      added,
      "teacher_1",
      operation({
        id: "op_document_remove",
        courseId: "course_causal",
        baseRevision: 5,
        type: "material.delete",
        materialId: "material_reading",
      }),
      NOW,
    );
    expect(removed.materials).toEqual([]);
    expect(removed.modules[0]?.lessons[0]?.materialIds).toEqual([]);
  });

  test("teacher access is one request and one learner approval", () => {
    const requested = applyCourseOperation(
      courseFixture(),
      "teacher_1",
      operation({
        id: "op_request",
        courseId: "course_causal",
        baseRevision: 4,
        type: "teacher-access.request",
        memberAccountId: "student_1",
      }),
      NOW,
    );
    expect(requested.members[1]?.teacherAccess).toBe("requested");

    const approved = applyCourseOperation(
      requested,
      "student_1",
      operation({
        id: "op_approve",
        courseId: "course_causal",
        baseRevision: 5,
        type: "teacher-access.respond",
        approve: true,
      }),
      NOW,
    );
    expect(approved.members[1]?.teacherAccess).toBe("full");
  });

  test("teachers cannot review private learner work", () => {
    let course = courseFixture();
    course = applyCourseOperation(
      course,
      "student_1",
      operation({
        id: "op_submit",
        courseId: "course_causal",
        baseRevision: 4,
        type: "submission.save",
        submissionId: "submission_1",
        lessonId: "lesson_1",
        exerciseId: "exercise_1",
        answer: "A common cause or selection bias.",
        sharedWithPeers: false,
      }),
      NOW,
    );

    expect(
      projectCourseForViewer(course, "teacher_1").course.submissions,
    ).toHaveLength(0);
    expect(() =>
      applyCourseOperation(
        course,
        "teacher_1",
        operation({
          id: "op_review",
          courseId: "course_causal",
          baseRevision: 5,
          type: "submission.review",
          submissionId: "submission_1",
          status: "reviewed",
          feedback: "Good distinction.",
        }),
        NOW,
      ),
    ).toThrow(CourseAuthorizationError);
  });

  test("viewer projections honor learner consent without leaking private state to peers", () => {
    const course = courseFixture();
    course.members[1]!.teacherAccess = "requested";
    course.members[1]!.joinedAt = "2026-08-02T10:00:00.000Z";
    course.members[1]!.progress = {
      activeLessonId: "lesson_1",
      completedLessonIds: ["lesson_1"],
      lastActiveAt: "2026-08-03T15:45:00.000Z",
    };
    course.members.push({
      accountId: "peer_1",
      displayName: "Study Partner",
      role: "peer",
      teacherAccess: "private",
      joinedAt: "2026-08-03T12:00:00.000Z",
      progress: {
        completedLessonIds: [],
        lastActiveAt: "2026-08-03T15:30:00.000Z",
      },
    });
    course.activity.push({
      id: "activity_student",
      type: "lesson-completed",
      accountId: "student_1",
      message: "Completed a lesson",
      lessonId: "lesson_1",
      createdAt: "2026-08-03T15:45:00.000Z",
    });

    const teacherView = projectCourseForViewer(course, "teacher_1");
    const requestedLearner = teacherView.course.members.find(
      (member) => member.accountId === "student_1",
    )!;
    expect(requestedLearner.teacherAccess).toBe("requested");
    expect(requestedLearner.progress.completedLessonIds).toEqual([]);
    expect(requestedLearner.progress.lastActiveAt).toBe(course.createdAt);
    expect(requestedLearner.joinedAt).toBe(course.createdAt);
    expect(teacherView.course.activity).toHaveLength(0);

    const selfView = projectCourseForViewer(course, "student_1");
    expect(selfView.viewer.teacherAccess).toBe("requested");
    expect(
      selfView.course.members.find((member) => member.accountId === "student_1")
        ?.progress.completedLessonIds,
    ).toEqual(["lesson_1"]);
    expect(selfView.course.activity.map((item) => item.id)).toEqual([
      "activity_student",
    ]);

    course.members[1]!.teacherAccess = "full";
    const consentedTeacherView = projectCourseForViewer(course, "teacher_1");
    expect(
      consentedTeacherView.course.members.find(
        (member) => member.accountId === "student_1",
      )?.progress.completedLessonIds,
    ).toEqual(["lesson_1"]);
    expect(consentedTeacherView.course.activity.map((item) => item.id)).toEqual(
      ["activity_student"],
    );

    const peerView = projectCourseForViewer(course, "peer_1");
    const peerVisibleLearner = peerView.course.members.find(
      (member) => member.accountId === "student_1",
    )!;
    expect(peerVisibleLearner).toMatchObject({
      accountId: "student_1",
      displayName: "Maya Patel",
      role: "student",
      teacherAccess: "private",
    });
    expect(peerVisibleLearner.progress.completedLessonIds).toEqual([]);
    expect(peerVisibleLearner.progress.lastActiveAt).toBe(course.createdAt);
    expect(peerVisibleLearner.joinedAt).toBe(course.createdAt);
    expect(peerView.course.activity).toHaveLength(0);
  });

  test("shared-note writes reject stale versions", () => {
    const course = courseFixture();
    course.sharedNotes.push({
      id: "note_1",
      lessonId: "lesson_1",
      title: "Shared notes",
      text: "Current text",
      version: 3,
      updatedAt: NOW,
      updatedBy: "student_1",
    });

    expect(() =>
      applyCourseOperation(
        course,
        "student_1",
        operation({
          id: "op_note",
          courseId: "course_causal",
          baseRevision: 4,
          type: "shared-note.update",
          noteId: "note_1",
          lessonId: "lesson_1",
          title: "Shared notes",
          text: "Stale text",
          baseVersion: 2,
        }),
        NOW,
      ),
    ).toThrow(CourseConflictError);
  });

  test("students cannot edit the course definition", () => {
    expect(() =>
      applyCourseOperation(
        courseFixture(),
        "student_1",
        operation({
          id: "op_course_update",
          courseId: "course_causal",
          baseRevision: 4,
          type: "course.update",
          patch: { title: "Taken over" },
        }),
        NOW,
      ),
    ).toThrow(CourseAuthorizationError);
  });

  test("Pear replication keeps shared room data but strips all private account state", () => {
    const course = courseFixture();
    course.members[1]!.teacherAccess = "full";
    course.members[1]!.joinedAt = "2026-08-02T10:00:00.000Z";
    course.members[1]!.progress = {
      activeLessonId: "lesson_1",
      completedLessonIds: ["lesson_1"],
      lastActiveAt: "2026-08-03T15:45:00.000Z",
    };
    course.activity.push({
      id: "activity_student",
      type: "lesson-completed",
      accountId: "student_1",
      message: "Completed a lesson",
      lessonId: "lesson_1",
      createdAt: "2026-08-03T15:45:00.000Z",
    });
    course.materials.push({
      id: "material_1",
      kind: "link",
      title: "Public reading",
      url: "https://example.com/reading",
      storageKey: "private/material-storage-key",
      createdAt: NOW,
      createdBy: "material_author_secret",
    });
    course.cards.push({
      id: "card_1",
      front: "What is exchangeability?",
      back: "Treatment groups have comparable potential outcomes.",
      tags: ["causal-inference"],
      lessonId: "lesson_1",
      updatedAt: NOW,
      updatedBy: "card_author_secret",
    });
    course.artifacts.push({
      id: "artifact_1",
      kind: "lesson-map",
      format: "mermaid",
      title: "Shared map",
      content: "graph LR; Observe-->Intervene",
      lessonId: "lesson_1",
      sourceId: "private-source-id",
      sourceSessionId: "private-session-id",
      updatedAt: NOW,
      updatedBy: "artifact_author_secret",
    });
    course.sharedNotes.push({
      id: "note_public",
      lessonId: "lesson_1",
      title: "Shared synthesis",
      text: "Interventions differ from observations.",
      version: 2,
      updatedAt: NOW,
      updatedBy: "note_author_secret",
    });
    course.comments.push({
      id: "comment_private",
      lessonId: "lesson_1",
      accountId: "comment_author_secret",
      body: "Private course comment",
      createdAt: NOW,
    });
    course.submissions.push(
      {
        id: "submission_private",
        lessonId: "lesson_1",
        exerciseId: "exercise_1",
        accountId: "student_1",
        answer: "Private answer",
        sharedWithPeers: false,
        version: 1,
        updatedAt: NOW,
      },
      {
        id: "submission_shared",
        lessonId: "lesson_1",
        exerciseId: "exercise_1",
        accountId: "student_1",
        answer: "Shared answer",
        sharedWithPeers: true,
        version: 1,
        updatedAt: NOW,
        review: {
          status: "reviewed",
          feedback: "Private teacher feedback",
          reviewerAccountId: "reviewer_secret",
          updatedAt: NOW,
        },
      },
    );

    const replica = projectCourseForPear(course);
    const keys = (value: object) => Object.keys(value).sort();
    expect(keys(replica)).toEqual(
      [
        "schemaVersion",
        "id",
        "title",
        "description",
        "outcomes",
        "createdAt",
        "updatedAt",
        "revision",
        "modules",
        "materials",
        "cards",
        "artifacts",
        "assignments",
        "sharedNotes",
        "submissions",
        "assignmentSubmissions",
      ].sort(),
    );
    expect(keys(replica.modules[0]!)).toEqual([
      "description",
      "id",
      "lessons",
      "title",
    ]);
    expect(keys(replica.modules[0]!.lessons[0]!)).toEqual([
      "cardIds",
      "exercise",
      "id",
      "materialIds",
      "objectives",
      "reading",
      "summary",
      "title",
    ]);
    expect(keys(replica.modules[0]!.lessons[0]!.exercise!)).toEqual([
      "id",
      "prompt",
      "rubric",
    ]);
    expect(keys(replica.materials[0]!)).toEqual(["id", "kind", "title", "url"]);
    expect(keys(replica.cards[0]!)).toEqual([
      "back",
      "front",
      "id",
      "lessonId",
      "tags",
    ]);
    expect(keys(replica.artifacts[0]!)).toEqual([
      "content",
      "format",
      "id",
      "kind",
      "lessonId",
      "title",
    ]);
    expect(keys(replica.sharedNotes[0]!)).toEqual([
      "id",
      "lessonId",
      "text",
      "title",
      "updatedAt",
      "version",
    ]);
    expect(replica.submissions.map((submission) => submission.id)).toEqual([
      "submission_shared",
    ]);
    expect(keys(replica.submissions[0]!)).toEqual([
      "answer",
      "exerciseId",
      "id",
      "lessonId",
    ]);

    const serialized = JSON.stringify(replica);
    for (const secret of [
      "teacher_1",
      "student_1",
      "Professor Keating",
      "Maya Patel",
      "material_author_secret",
      "card_author_secret",
      "artifact_author_secret",
      "private-source-id",
      "private-session-id",
      "note_author_secret",
      "comment_author_secret",
      "reviewer_secret",
      "Private answer",
      "Private course comment",
      "Private teacher feedback",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    for (const prohibitedKey of [
      "ownerAccountId",
      "members",
      "accountId",
      "displayName",
      "role",
      "createdBy",
      "updatedBy",
      "reviewerAccountId",
      "comments",
      "activity",
      "settings",
      "teacherAccess",
      "joinedAt",
      "progress",
      "completedLessonIds",
      "lastActiveAt",
      "sharedWithPeers",
      "review",
      "feedback",
      "storageKey",
    ]) {
      expect(serialized).not.toContain(`\"${prohibitedKey}\"`);
    }
  });
});

describe("course discussion operations", () => {
  function discussionFixture(): Course {
    const course = courseFixture();
    course.comments = [
      {
        id: "comment_root",
        lessonId: "lesson_1",
        accountId: "student_1",
        body: "Why does adjustment fail here?",
        createdAt: NOW,
      },
    ];
    return course;
  }

  test("replies stay two levels deep and inherit the parent's channel", () => {
    const withReply = applyCourseOperation(
      discussionFixture(),
      "teacher_1",
      operation({
        id: "op_reply",
        courseId: "course_causal",
        baseRevision: 0,
        type: "comment.add",
        commentId: "comment_reply",
        parentId: "comment_root",
        body: "Because the collider opens a path.",
      }),
      NOW,
    );
    const nested = applyCourseOperation(
      withReply,
      "student_1",
      operation({
        id: "op_reply_2",
        courseId: "course_causal",
        baseRevision: 0,
        type: "comment.add",
        commentId: "comment_reply_2",
        parentId: "comment_reply",
        body: "So conditioning is the problem.",
      }),
      NOW,
    );

    const deepest = nested.comments.find(
      (comment) => comment.id === "comment_reply_2",
    );
    expect(deepest?.parentId).toBe("comment_root");
    expect(deepest?.lessonId).toBe("lesson_1");
  });

  test("course-wide comments need no lesson and survive lesson removal", () => {
    const withCourseComment = applyCourseOperation(
      discussionFixture(),
      "student_1",
      operation({
        id: "op_course_comment",
        courseId: "course_causal",
        baseRevision: 0,
        type: "comment.add",
        commentId: "comment_course",
        body: "Where should we meet?",
      }),
      NOW,
    );
    expect(
      withCourseComment.comments.find(
        (comment) => comment.id === "comment_course",
      )?.lessonId,
    ).toBeUndefined();

    const withoutLesson = applyCourseOperation(
      withCourseComment,
      "teacher_1",
      operation({
        id: "op_lesson_delete",
        courseId: "course_causal",
        baseRevision: withCourseComment.revision,
        type: "lesson.delete",
        moduleId: "module_1",
        lessonId: "lesson_1",
      }),
      NOW,
    );

    expect(withoutLesson.comments.map((comment) => comment.id)).toEqual([
      "comment_course",
    ]);
  });

  test("only the author edits a comment", () => {
    const edited = applyCourseOperation(
      discussionFixture(),
      "student_1",
      operation({
        id: "op_edit",
        courseId: "course_causal",
        baseRevision: 0,
        type: "comment.update",
        commentId: "comment_root",
        body: "Why does adjustment fail in this design?",
      }),
      NOW,
    );
    expect(edited.comments[0]?.body).toBe(
      "Why does adjustment fail in this design?",
    );
    expect(edited.comments[0]?.editedAt).toBe(NOW);

    expect(() =>
      applyCourseOperation(
        discussionFixture(),
        "teacher_1",
        operation({
          id: "op_edit_other",
          courseId: "course_causal",
          baseRevision: 0,
          type: "comment.update",
          commentId: "comment_root",
          body: "Rewritten by someone else",
        }),
        NOW,
      ),
    ).toThrow(CourseAuthorizationError);
  });

  test("removing a comment takes its replies and reactions with it", () => {
    let course = applyCourseOperation(
      discussionFixture(),
      "teacher_1",
      operation({
        id: "op_reply",
        courseId: "course_causal",
        baseRevision: 0,
        type: "comment.add",
        commentId: "comment_reply",
        parentId: "comment_root",
        body: "Good question.",
      }),
      NOW,
    );
    course = applyCourseOperation(
      course,
      "teacher_1",
      operation({
        id: "op_react",
        courseId: "course_causal",
        baseRevision: 0,
        type: "reaction.toggle",
        targetKind: "comment",
        targetId: "comment_reply",
        emoji: "👍",
      }),
      NOW,
    );
    expect(course.reactions).toHaveLength(1);

    const removed = applyCourseOperation(
      course,
      "student_1",
      operation({
        id: "op_delete",
        courseId: "course_causal",
        baseRevision: 0,
        type: "comment.delete",
        commentId: "comment_root",
      }),
      NOW,
    );

    expect(removed.comments).toEqual([]);
    expect(removed.reactions).toEqual([]);
    expect(removed.activity[0]?.message).toContain("1 replies");
  });

  test("teachers can moderate a comment they did not write", () => {
    const removed = applyCourseOperation(
      discussionFixture(),
      "teacher_1",
      operation({
        id: "op_moderate",
        courseId: "course_causal",
        baseRevision: 0,
        type: "comment.delete",
        commentId: "comment_root",
      }),
      NOW,
    );
    expect(removed.comments).toEqual([]);
  });

  test("a reaction toggles off and stays one per member and emoji", () => {
    const added = applyCourseOperation(
      discussionFixture(),
      "student_1",
      operation({
        id: "op_react",
        courseId: "course_causal",
        baseRevision: 0,
        type: "reaction.toggle",
        targetKind: "comment",
        targetId: "comment_root",
        emoji: "💡",
      }),
      NOW,
    );
    expect(added.reactions).toEqual([
      {
        targetKind: "comment",
        targetId: "comment_root",
        emoji: "💡",
        accountId: "student_1",
        createdAt: NOW,
      },
    ]);

    const removed = applyCourseOperation(
      added,
      "student_1",
      operation({
        id: "op_react_off",
        courseId: "course_causal",
        baseRevision: 0,
        type: "reaction.toggle",
        targetKind: "comment",
        targetId: "comment_root",
        emoji: "💡",
      }),
      NOW,
    );
    expect(removed.reactions).toEqual([]);
  });

  test("reacting to something that is gone fails loudly", () => {
    expect(() =>
      applyCourseOperation(
        discussionFixture(),
        "student_1",
        operation({
          id: "op_react_missing",
          courseId: "course_causal",
          baseRevision: 0,
          type: "reaction.toggle",
          targetKind: "artifact",
          targetId: "artifact_missing",
          emoji: "👍",
        }),
        NOW,
      ),
    ).toThrow(/no longer here/);
  });

  test("peers cannot react when peer comments are off", () => {
    const course = discussionFixture();
    course.settings.allowPeerComments = false;
    expect(() =>
      applyCourseOperation(
        course,
        "student_1",
        operation({
          id: "op_react_blocked",
          courseId: "course_causal",
          baseRevision: 0,
          type: "reaction.toggle",
          targetKind: "comment",
          targetId: "comment_root",
          emoji: "👍",
        }),
        NOW,
      ),
    ).toThrow(CourseAuthorizationError);
  });

  test("course settings patch merges instead of replacing", () => {
    const next = applyCourseOperation(
      courseFixture(),
      "teacher_1",
      operation({
        id: "op_settings",
        courseId: "course_causal",
        baseRevision: 4,
        type: "course.update",
        patch: { settings: { allowPeerComments: false } },
      }),
      NOW,
    );

    expect(next.settings).toEqual({
      teacherAccessPolicy: "request",
      allowPeerDeckEdits: true,
      allowPeerComments: false,
    });
    expect(next.title).toBe("Causal Inference");
  });
});

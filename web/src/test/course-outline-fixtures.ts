import type { Course, CoursePermissions } from "../courses/contracts";

const NOW = "2026-08-03T16:00:00.000Z";

function lesson(id: string, title: string) {
  return {
    id,
    title,
    summary: "",
    objectives: [],
    reading: "",
    materialIds: [],
    cardIds: [],
    exercise: { id: `ex_${id}`, prompt: "?", rubric: [] },
  };
}

function courseFixture(modules: Course["modules"]): Course {
  return {
    schemaVersion: 1,
    id: "course_outline",
    title: "Outline",
    description: "",
    outcomes: [],
    ownerAccountId: "teacher_1",
    createdAt: NOW,
    updatedAt: NOW,
    revision: 1,
    modules,
    materials: [],
    cards: [],
    artifacts: [],
    assignments: [],
    members: [],
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

const teacher: CoursePermissions = {
  canEditCourse: true,
  canInvite: true,
  canReview: true,
  canEditDeck: true,
  canRequestTeacherAccess: true,
};
const learner: CoursePermissions = {
  canEditCourse: false,
  canInvite: false,
  canReview: false,
  canEditDeck: false,
  canRequestTeacherAccess: false,
};

const modules = [
  {
    id: "m1",
    title: "Counterfactuals",
    description: "",
    lessons: [lesson("l1", "Correlation"), lesson("l2", "Intervention")],
  },
  { id: "m2", title: "Empty module", description: "", lessons: [] },
];

/** Fixed inputs for CourseOutline characterization tests. */
export const OUTLINE_FIXTURES = {
  teacherWithProgress: {
    course: courseFixture(modules),
    completedLessonIds: ["l1"],
    permissions: teacher,
    threadCounts: { l1: 3, course: 2 } as Record<string, number>,
    activeLessonId: "l2",
    view: "read" as const,
  },
  learnerBuildView: {
    course: courseFixture(modules),
    completedLessonIds: [],
    permissions: learner,
    threadCounts: {} as Record<string, number>,
    activeLessonId: "l1",
    view: "review" as const,
  },
  blankCourse: {
    course: courseFixture([]),
    completedLessonIds: [],
    permissions: teacher,
    threadCounts: {} as Record<string, number>,
    activeLessonId: "",
    view: "read" as const,
  },
};

/** A course with materials, artifacts and assignments, for DeskView tests. */
export function deskFixture(): {
  snapshot: import("../courses/contracts").CourseViewerSnapshot;
} {
  const course = courseFixture(modules);
  course.ownerAccountId = "teacher_1";
  const viewer = {
    accountId: "student_1",
    displayName: "Maya",
    role: "student" as const,
    teacherAccess: "private" as const,
    joinedAt: NOW,
    progress: { completedLessonIds: [], lastActiveAt: NOW },
  };
  course.members = [viewer];
  course.modules[0]!.lessons[0] = {
    ...course.modules[0]!.lessons[0]!,
    summary: "Seeing versus doing.",
    objectives: ["Name a confounder", "Contrast intervention and observation"],
    reading: "Correlation observes.\n\nCausation intervenes.",
  };
  course.materials = [
    { id: "mat_l", kind: "link", title: "Lesson source", url: "https://example.com/a", lessonId: "l1", createdAt: NOW, createdBy: "teacher_1" },
    { id: "mat_c", kind: "note", title: "Course source", description: "Whole course", createdAt: NOW, createdBy: "teacher_1" },
  ];
  course.assignments = [
    { id: "as_l", title: "Lesson task", brief: "Write it.", deliverables: ["A page"], rubric: ["Clear"], lessonId: "l1", updatedAt: NOW, updatedBy: "teacher_1" },
    { id: "as_c", title: "Course task", brief: "Reflect.", deliverables: [], rubric: [], updatedAt: NOW, updatedBy: "teacher_1" },
  ];
  course.sharedNotes = [{ id: "n1", lessonId: "l1", title: "Notes", text: "hi", version: 2, updatedAt: NOW, updatedBy: "teacher_1" }];
  return { snapshot: { course, viewer, permissions: teacher } };
}

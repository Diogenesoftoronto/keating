import type { CourseFeed } from "../../../packages/p2p-core/src/course-feed.js";
import type {
  Course,
  CourseArtifact,
  CourseAssignment,
  CourseAssignmentSubmission,
  CourseCard,
  CourseExercise,
  CourseLesson,
  CourseMaterial,
  CourseModule,
  CourseNetworkInfo,
  CourseSharedNote,
  CourseSubmission,
} from "../../src/courses/contracts";

type PearCourseExercise = Pick<
  CourseExercise,
  "id" | "prompt" | "placeholder" | "rubric"
>;

type PearCourseLesson = Pick<
  CourseLesson,
  | "id"
  | "title"
  | "summary"
  | "estimatedMinutes"
  | "objectives"
  | "reading"
  | "materialIds"
  | "cardIds"
> & {
  exercise?: PearCourseExercise;
};

type PearCourseModule = Pick<CourseModule, "id" | "title" | "description"> & {
  lessons: PearCourseLesson[];
};

type PearCourseMaterial = Pick<
  CourseMaterial,
  | "id"
  | "kind"
  | "title"
  | "description"
  | "url"
  | "fileName"
  | "mimeType"
  | "sizeBytes"
  | "lessonId"
>;

type PearCourseCard = Pick<
  CourseCard,
  "id" | "front" | "back" | "tags" | "lessonId"
>;

type PearCourseArtifact = Pick<
  CourseArtifact,
  "id" | "kind" | "format" | "title" | "description" | "content" | "lessonId"
>;

type PearCourseAssignment = Pick<
  CourseAssignment,
  | "id"
  | "title"
  | "brief"
  | "deliverables"
  | "rubric"
  | "lessonId"
  | "dueAt"
  | "estimatedHours"
>;

type PearCourseAssignmentSubmission = Pick<
  CourseAssignmentSubmission,
  "id" | "assignmentId" | "answer" | "status"
>;

type PearCourseSharedNote = Pick<
  CourseSharedNote,
  "id" | "lessonId" | "title" | "text" | "version" | "updatedAt"
>;

type PearCourseSubmission = Pick<
  CourseSubmission,
  "id" | "lessonId" | "exerciseId" | "answer"
>;

/** The deliberately small, identity-free document stored on the public Pear feed. */
export interface PearCourseSnapshot {
  schemaVersion: Course["schemaVersion"];
  id: string;
  title: string;
  description: string;
  outcomes: string[];
  createdAt: string;
  updatedAt: string;
  revision: number;
  modules: PearCourseModule[];
  materials: PearCourseMaterial[];
  cards: PearCourseCard[];
  artifacts: PearCourseArtifact[];
  assignments: PearCourseAssignment[];
  sharedNotes: PearCourseSharedNote[];
  submissions: PearCourseSubmission[];
  assignmentSubmissions: PearCourseAssignmentSubmission[];
}

interface GatewayEntry {
  feed: CourseFeed;
  lastRevision: number;
}

interface CoursePearGlobals {
  __keatingCoursePearFeeds?: Map<string, Promise<GatewayEntry>>;
}

const globals = globalThis as typeof globalThis & CoursePearGlobals;
const feeds = (globals.__keatingCoursePearFeeds ??= new Map<
  string,
  Promise<GatewayEntry>
>());

function enabled(): boolean {
  const value = process.env.KEATING_COURSES_PEAR_ENABLED?.trim().toLowerCase();
  return value === "1" || value === "true";
}

function storageBase(): string {
  return (
    process.env.KEATING_COURSES_PEAR_STORAGE_DIR?.trim() ||
    ".data/keating-course-pear"
  );
}

/**
 * Build an allow-listed public document for anyone holding the replication key.
 * Keep this projection explicit: cloning or spreading Course objects can silently
 * publish new private fields when the authenticated course schema grows.
 */
export function projectCourseForPear(course: Course): PearCourseSnapshot {
  return {
    schemaVersion: course.schemaVersion,
    id: course.id,
    title: course.title,
    description: course.description,
    outcomes: [...course.outcomes],
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
    revision: course.revision,
    modules: course.modules.map((module) => ({
      id: module.id,
      title: module.title,
      description: module.description,
      lessons: module.lessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        summary: lesson.summary,
        ...(lesson.estimatedMinutes === undefined
          ? {}
          : { estimatedMinutes: lesson.estimatedMinutes }),
        objectives: [...lesson.objectives],
        reading: lesson.reading,
        ...(lesson.exercise
          ? {
              exercise: {
                id: lesson.exercise.id,
                prompt: lesson.exercise.prompt,
                ...(lesson.exercise.placeholder === undefined
                  ? {}
                  : { placeholder: lesson.exercise.placeholder }),
                rubric: [...lesson.exercise.rubric],
              },
            }
          : {}),
        materialIds: [...lesson.materialIds],
        cardIds: [...lesson.cardIds],
      })),
    })),
    materials: course.materials.map((material) => ({
      id: material.id,
      kind: material.kind,
      title: material.title,
      ...(material.description === undefined
        ? {}
        : { description: material.description }),
      ...(material.url === undefined ? {} : { url: material.url }),
      ...(material.fileName === undefined
        ? {}
        : { fileName: material.fileName }),
      ...(material.mimeType === undefined
        ? {}
        : { mimeType: material.mimeType }),
      ...(material.sizeBytes === undefined
        ? {}
        : { sizeBytes: material.sizeBytes }),
      ...(material.lessonId === undefined
        ? {}
        : { lessonId: material.lessonId }),
    })),
    cards: course.cards.map((card) => ({
      id: card.id,
      front: card.front,
      back: card.back,
      tags: [...card.tags],
      ...(card.lessonId === undefined ? {} : { lessonId: card.lessonId }),
    })),
    artifacts: course.artifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      format: artifact.format,
      title: artifact.title,
      ...(artifact.description === undefined
        ? {}
        : { description: artifact.description }),
      content: artifact.content,
      ...(artifact.lessonId === undefined
        ? {}
        : { lessonId: artifact.lessonId }),
    })),
    assignments: course.assignments.map((assignment) => ({
      id: assignment.id,
      title: assignment.title,
      brief: assignment.brief,
      deliverables: [...assignment.deliverables],
      rubric: [...assignment.rubric],
      ...(assignment.lessonId === undefined
        ? {}
        : { lessonId: assignment.lessonId }),
      ...(assignment.dueAt === undefined ? {} : { dueAt: assignment.dueAt }),
      ...(assignment.estimatedHours === undefined
        ? {}
        : { estimatedHours: assignment.estimatedHours }),
    })),
    sharedNotes: course.sharedNotes.map((note) => ({
      id: note.id,
      lessonId: note.lessonId,
      title: note.title,
      text: note.text,
      version: note.version,
      updatedAt: note.updatedAt,
    })),
    submissions: course.submissions
      .filter((submission) => submission.sharedWithPeers)
      .map((submission) => ({
        id: submission.id,
        lessonId: submission.lessonId,
        exerciseId: submission.exerciseId,
        answer: submission.answer,
      })),
    assignmentSubmissions: course.assignmentSubmissions
      .filter((submission) => submission.sharedWithPeers)
      .map((submission) => ({
        id: submission.id,
        assignmentId: submission.assignmentId,
        answer: submission.answer,
        status: submission.status,
      })),
  };
}

async function openFeed(course: Course): Promise<GatewayEntry> {
  const { CourseFeed } =
    await import("../../../packages/p2p-core/src/course-feed.js");
  const feed = await CourseFeed.openWriter({
    courseId: course.id,
    storageDir: `${storageBase()}/${course.id}`,
  });
  await feed.setSnapshot(projectCourseForPear(course));
  return { feed, lastRevision: course.revision };
}

function offline(): CourseNetworkInfo {
  return { mode: "pear-gateway", status: "offline", peerCount: 0 };
}

export async function mirrorCourseOnPear(
  course: Course,
): Promise<CourseNetworkInfo> {
  if (!enabled()) return offline();
  try {
    let entryPromise = feeds.get(course.id);
    if (!entryPromise) {
      entryPromise = openFeed(course);
      feeds.set(course.id, entryPromise);
    }
    const entry = await entryPromise;
    if (entry.lastRevision < course.revision) {
      await entry.feed.setSnapshot(projectCourseForPear(course));
      entry.lastRevision = course.revision;
    }
    const stats = entry.feed.stats();
    return {
      mode: "pear-gateway",
      status: "connected",
      peerCount: stats.peers,
      publicKey: entry.feed.publicKey,
    };
  } catch (error) {
    feeds.delete(course.id);
    console.warn(
      "Keating course Pear gateway is unavailable:",
      error instanceof Error ? error.message : "unknown error",
    );
    return { mode: "pear-gateway", status: "reconnecting", peerCount: 0 };
  }
}

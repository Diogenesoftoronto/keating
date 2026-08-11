/**
 * The slice of the course contract this app reads. The server owns the full
 * schema (web/src/courses/contracts.ts); these are hand-mirrored structural
 * types for the read paths the native client uses, so the app never needs zod
 * on device. Anything unmodelled is simply ignored.
 */

export type CourseRole = "owner" | "teacher" | "student" | "peer";
export type TeacherAccess = "private" | "requested" | "full";
export type CourseMaterialKind = "document" | "image" | "link" | "note" | "anki";

export interface CourseSessionAccount {
  id: string;
  displayName: string;
  mode: "development" | "local" | "hosted";
}

export interface CourseListItem {
  id: string;
  title: string;
  description: string;
  role: CourseRole;
  memberCount: number;
  lessonCount: number;
  completedLessons: number;
  updatedAt: string;
}

export interface CourseMaterial {
  id: string;
  kind: CourseMaterialKind;
  title: string;
  description?: string;
  url?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  lessonId?: string;
  createdAt: string;
}

export interface CourseLesson {
  id: string;
  title: string;
  summary: string;
  estimatedMinutes?: number;
  objectives: string[];
  reading: string;
  materialIds: string[];
}

export interface CourseModule {
  id: string;
  title: string;
  description: string;
  lessons: CourseLesson[];
}

export interface CourseProgress {
  activeLessonId?: string;
  completedLessonIds: string[];
  lastActiveAt: string;
}

export interface CourseMember {
  accountId: string;
  displayName: string;
  role: CourseRole;
  teacherAccess: TeacherAccess;
  progress: CourseProgress;
}

export interface Course {
  id: string;
  title: string;
  description: string;
  outcomes: string[];
  updatedAt: string;
  revision: number;
  modules: CourseModule[];
  materials: CourseMaterial[];
  members: CourseMember[];
}

export interface CoursePermissions {
  canEditCourse: boolean;
  canInvite: boolean;
  canReview: boolean;
  canEditDeck: boolean;
  canRequestTeacherAccess: boolean;
}

export interface CourseViewerSnapshot {
  course: Course;
  viewer: CourseMember;
  permissions: CoursePermissions;
}

const ROLES = new Set<CourseRole>(["owner", "teacher", "student", "peer"]);
const MATERIAL_KINDS = new Set<CourseMaterialKind>(["document", "image", "link", "note", "anki"]);

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function role(value: unknown): CourseRole {
  return ROLES.has(value as CourseRole) ? value as CourseRole : "student";
}

export function normalizeCourseListItem(value: unknown): CourseListItem {
  const item = record(value);
  return {
    id: str(item.id),
    title: str(item.title, "Untitled course"),
    description: str(item.description),
    role: role(item.role),
    memberCount: typeof item.memberCount === "number" ? item.memberCount : 0,
    lessonCount: typeof item.lessonCount === "number" ? item.lessonCount : 0,
    completedLessons: typeof item.completedLessons === "number" ? item.completedLessons : 0,
    updatedAt: str(item.updatedAt),
  };
}

function normalizeMaterial(value: unknown): CourseMaterial {
  const material = record(value);
  const kind = MATERIAL_KINDS.has(material.kind as CourseMaterialKind)
    ? material.kind as CourseMaterialKind
    : "note";
  return {
    id: str(material.id),
    kind,
    title: str(material.title, "Untitled material"),
    description: typeof material.description === "string" ? material.description : undefined,
    url: typeof material.url === "string" ? material.url : undefined,
    fileName: typeof material.fileName === "string" ? material.fileName : undefined,
    mimeType: typeof material.mimeType === "string" ? material.mimeType : undefined,
    sizeBytes: typeof material.sizeBytes === "number" ? material.sizeBytes : undefined,
    lessonId: typeof material.lessonId === "string" ? material.lessonId : undefined,
    createdAt: str(material.createdAt),
  };
}

function normalizeLesson(value: unknown): CourseLesson {
  const lesson = record(value);
  return {
    id: str(lesson.id),
    title: str(lesson.title, "Untitled lesson"),
    summary: str(lesson.summary),
    estimatedMinutes: typeof lesson.estimatedMinutes === "number" ? lesson.estimatedMinutes : undefined,
    objectives: strArray(lesson.objectives),
    reading: str(lesson.reading),
    materialIds: strArray(lesson.materialIds),
  };
}

function normalizeMember(value: unknown): CourseMember {
  const member = record(value);
  const progress = record(member.progress);
  return {
    accountId: str(member.accountId),
    displayName: str(member.displayName, "Learner"),
    role: role(member.role),
    teacherAccess: member.teacherAccess === "full" || member.teacherAccess === "requested"
      ? member.teacherAccess
      : "private",
    progress: {
      activeLessonId: typeof progress.activeLessonId === "string" ? progress.activeLessonId : undefined,
      completedLessonIds: strArray(progress.completedLessonIds),
      lastActiveAt: str(progress.lastActiveAt),
    },
  };
}

export function normalizeCourseSnapshot(value: unknown): CourseViewerSnapshot {
  const snapshot = record(value);
  const course = record(snapshot.course);
  const permissions = record(snapshot.permissions);
  return {
    course: {
      id: str(course.id),
      title: str(course.title, "Untitled course"),
      description: str(course.description),
      outcomes: strArray(course.outcomes),
      updatedAt: str(course.updatedAt),
      revision: typeof course.revision === "number" ? course.revision : 0,
      modules: (Array.isArray(course.modules) ? course.modules : []).map((module) => {
        const entry = record(module);
        return {
          id: str(entry.id),
          title: str(entry.title, "Untitled module"),
          description: str(entry.description),
          lessons: (Array.isArray(entry.lessons) ? entry.lessons : []).map(normalizeLesson),
        };
      }),
      materials: (Array.isArray(course.materials) ? course.materials : []).map(normalizeMaterial),
      members: (Array.isArray(course.members) ? course.members : []).map(normalizeMember),
    },
    viewer: normalizeMember(snapshot.viewer),
    permissions: {
      canEditCourse: permissions.canEditCourse === true,
      canInvite: permissions.canInvite === true,
      canReview: permissions.canReview === true,
      canEditDeck: permissions.canEditDeck === true,
      canRequestTeacherAccess: permissions.canRequestTeacherAccess === true,
    },
  };
}

/** Lessons across every module, in course order. */
export function allCourseLessons(course: Pick<Course, "modules">): CourseLesson[] {
  return course.modules.flatMap((module) => module.lessons);
}

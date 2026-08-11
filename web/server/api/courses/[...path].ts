import {
  createError,
  defineEventHandler,
  getRequestURL,
  readMultipartFormData,
  readBody,
  setResponseHeaders,
  type H3Event,
} from "h3";
import { z } from "zod";
import {
  courseCreateInputSchema,
  courseOperationSchema,
  courseRoleSchema,
} from "../../../src/courses/contracts";
import {
  CourseAuthorizationError,
  CourseConflictError,
  CourseNotFoundError,
} from "../../../src/courses/operations";
import { NotOrganicOperationalError } from "../../../src/notorganic-provider/server";
import {
  applyStoredCourseOperation,
  CourseEnrollmentConsentRequiredError,
  createCourse,
  createCourseInvite,
  getCourseForAccount,
  getCourseMaterialForAccount,
  joinCourseWithInvite,
  listCoursesForAccount,
} from "../../utils/course-repository";
import {
  courseMaterialStorageKey,
  deleteCourseMaterialBytes,
  getCourseMaterialBytes,
  saveCourseMaterialBytes,
} from "../../utils/course-material-storage";
import { broadcastCourseUpdated } from "../../utils/course-realtime";
import { mirrorCourseOnPear } from "../../utils/course-pear-gateway";
import { requireCourseProductSession } from "../../utils/course-session";

const displayNameSchema = z.string().trim().min(1).max(120);
const createBodySchema = courseCreateInputSchema.extend({
  displayName: displayNameSchema.optional(),
});
const inviteBodySchema = z.object({
  role: courseRoleSchema.exclude(["owner"]),
  expiresInHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(168),
  maxUses: z.number().int().min(1).max(5_000).default(25),
});
const joinBodySchema = z.object({
  displayName: displayNameSchema.optional(),
  acceptTeacherAccess: z.boolean().default(false),
});
const materialPatchSchema = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(2_000).nullable().optional(),
  lessonId: z.string().min(2).max(96).nullable().optional(),
});
const MAX_COURSE_FILE_BYTES = 25 * 1024 * 1024;
const INLINE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
]);

function segments(event: H3Event): string[] {
  return getRequestURL(event)
    .pathname.replace(/^\/api\/courses\/?/, "")
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
}

function defaultDisplayName(accountId: string): string {
  return `Learner ${accountId.slice(-6)}`;
}

function randomCourseId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function safeDownloadName(value: string): string {
  return (
    value.replace(/[^A-Za-z0-9._ -]+/g, "_").slice(0, 180) || "course-document"
  );
}

function fail(
  statusCode: number,
  statusMessage: string,
  code: string,
  data?: Record<string, unknown>,
): never {
  throw createError({ statusCode, statusMessage, data: { code, ...data } });
}

function mapCourseError(error: unknown): never {
  if (error instanceof NotOrganicOperationalError) {
    return fail(error.statusCode, error.message, error.code);
  }
  if (error instanceof z.ZodError) {
    return fail(
      400,
      error.issues[0]?.message ?? "Invalid course request.",
      "course_invalid_request",
    );
  }
  if (error instanceof CourseConflictError) {
    return fail(409, error.message, error.code, {
      currentRevision: error.currentRevision,
    });
  }
  if (error instanceof CourseAuthorizationError)
    return fail(403, error.message, error.code);
  if (error instanceof CourseNotFoundError)
    return fail(404, error.message, error.code);
  if (error instanceof CourseEnrollmentConsentRequiredError)
    return fail(409, error.message, error.code);
  if (error instanceof Error && error.message === "Course not found.") {
    return fail(404, "Course not found.", "course_not_found");
  }
  if (
    error instanceof Error &&
    error.message === "You cannot invite people to this course."
  ) {
    return fail(403, error.message, "course_forbidden");
  }
  throw error;
}

export default defineEventHandler(async (event) => {
  try {
    const session = await requireCourseProductSession(event);
    const path = segments(event);
    if (path[0] === "session" && path.length === 1) {
      if (event.method !== "GET")
        return fail(405, "Method not allowed.", "method_not_allowed");
      return {
        account: {
          id: session.accountId,
          displayName:
            session.mode === "local"
              ? "Local learner"
              : defaultDisplayName(session.accountId),
          mode: session.mode,
        },
      };
    }

    if (path.length === 0) {
      if (event.method === "GET")
        return { courses: await listCoursesForAccount(session.accountId) };
      if (event.method === "POST") {
        const body = createBodySchema.parse(await readBody(event));
        const snapshot = await createCourse(
          session.accountId,
          body.displayName ?? defaultDisplayName(session.accountId),
          body,
        );
        snapshot.network = await mirrorCourseOnPear(snapshot.course);
        return snapshot;
      }
      return fail(405, "Method not allowed.", "method_not_allowed");
    }

    if (path[0] === "join" && path.length === 2) {
      if (event.method !== "POST")
        return fail(405, "Method not allowed.", "method_not_allowed");
      const body = joinBodySchema.parse(await readBody(event));
      const snapshot = await joinCourseWithInvite(
        path[1]!,
        session.accountId,
        body.displayName ?? defaultDisplayName(session.accountId),
        body.acceptTeacherAccess,
      );
      if (!snapshot)
        return fail(
          404,
          "This invite is invalid, expired, or fully used.",
          "course_invite_invalid",
        );
      snapshot.network = await mirrorCourseOnPear(snapshot.course);
      broadcastCourseUpdated(snapshot.course.id, snapshot.course.revision);
      return snapshot;
    }

    const courseId = path[0]!;
    if (path.length === 1) {
      if (event.method !== "GET")
        return fail(405, "Method not allowed.", "method_not_allowed");
      const snapshot = await getCourseForAccount(courseId, session.accountId);
      if (!snapshot) return fail(404, "Course not found.", "course_not_found");
      snapshot.network = await mirrorCourseOnPear(snapshot.course);
      return snapshot;
    }

    if (path[1] === "operations" && path.length === 2) {
      if (event.method !== "POST")
        return fail(405, "Method not allowed.", "method_not_allowed");
      const operation = courseOperationSchema.parse(await readBody(event));
      if (operation.courseId !== courseId) {
        return fail(
          400,
          "The operation targets a different course.",
          "course_invalid_request",
        );
      }
      const result = await applyStoredCourseOperation(
        session.accountId,
        operation,
      );
      result.snapshot.network = await mirrorCourseOnPear(
        result.snapshot.course,
      );
      if (result.applied)
        broadcastCourseUpdated(courseId, result.snapshot.course.revision);
      return result;
    }

    if (path[1] === "materials" && path.length === 2) {
      if (event.method !== "POST")
        return fail(405, "Method not allowed.", "method_not_allowed");
      const snapshot = await getCourseForAccount(courseId, session.accountId);
      if (!snapshot) return fail(404, "Course not found.", "course_not_found");
      if (!snapshot.permissions.canEditCourse)
        return fail(
          403,
          "Only course teachers can add source files.",
          "course_forbidden",
        );
      const parts = await readMultipartFormData(event);
      const file = parts?.find((part) => part.name === "file" && part.filename);
      if (!file?.data?.byteLength)
        return fail(
          400,
          "Choose a document or image to upload.",
          "course_file_required",
        );
      if (file.data.byteLength > MAX_COURSE_FILE_BYTES)
        return fail(
          413,
          "Course files must be 25 MB or smaller.",
          "course_file_too_large",
        );
      const value = (name: string) => {
        const part = parts?.find(
          (candidate) => candidate.name === name && !candidate.filename,
        );
        return part ? Buffer.from(part.data).toString("utf8").trim() : "";
      };
      const materialId = randomCourseId("material");
      const storageKey = courseMaterialStorageKey(courseId, materialId);
      const mimeType = file.type?.slice(0, 160) || "application/octet-stream";
      const lessonId = value("lessonId");
      await saveCourseMaterialBytes(storageKey, file.data);
      try {
        const result = await applyStoredCourseOperation(session.accountId, {
          id: randomCourseId("op"),
          courseId,
          baseRevision: snapshot.course.revision,
          type: "material.add",
          material: {
            id: materialId,
            kind: INLINE_IMAGE_TYPES.has(mimeType) ? "image" : "document",
            title: value("title") || file.filename || "Course document",
            storageKey,
            fileName: file.filename?.slice(0, 255),
            mimeType,
            sizeBytes: file.data.byteLength,
            ...(lessonId ? { lessonId } : {}),
          },
        });
        result.snapshot.network = await mirrorCourseOnPear(
          result.snapshot.course,
        );
        if (result.applied)
          broadcastCourseUpdated(courseId, result.snapshot.course.revision);
        return result.snapshot;
      } catch (error) {
        await deleteCourseMaterialBytes(storageKey);
        throw error;
      }
    }

    if (path[1] === "materials" && path.length === 3) {
      const materialId = path[2]!;
      const material = await getCourseMaterialForAccount(
        courseId,
        session.accountId,
        materialId,
      );
      if (!material)
        return fail(
          404,
          "Course source not found.",
          "course_material_not_found",
        );
      if (event.method === "GET") {
        if (!material.storageKey)
          return fail(
            404,
            "This source has no stored file.",
            "course_material_file_missing",
          );
        const bytes = await getCourseMaterialBytes(material.storageKey);
        if (!bytes)
          return fail(
            404,
            "The stored course file could not be found.",
            "course_material_file_missing",
          );
        const inline =
          material.kind === "image" || material.mimeType === "application/pdf";
        setResponseHeaders(event, {
          "content-type": material.mimeType ?? "application/octet-stream",
          "content-length": String(bytes.byteLength),
          "content-disposition": `${inline ? "inline" : "attachment"}; filename="${safeDownloadName(material.fileName ?? material.title)}"`,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
          "content-security-policy": "sandbox",
        });
        return Buffer.from(bytes);
      }
      const snapshot = await getCourseForAccount(courseId, session.accountId);
      if (!snapshot) return fail(404, "Course not found.", "course_not_found");
      if (!snapshot.permissions.canEditCourse)
        return fail(
          403,
          "Only course teachers can edit source files.",
          "course_forbidden",
        );
      if (event.method === "PATCH") {
        const patch = materialPatchSchema.parse(await readBody(event));
        const {
          createdAt: _createdAt,
          createdBy: _createdBy,
          ...input
        } = material;
        const result = await applyStoredCourseOperation(session.accountId, {
          id: randomCourseId("op"),
          courseId,
          baseRevision: snapshot.course.revision,
          type: "material.add",
          material: {
            ...input,
            title: patch.title,
            ...(patch.description
              ? { description: patch.description }
              : { description: undefined }),
            ...(patch.lessonId
              ? { lessonId: patch.lessonId }
              : { lessonId: undefined }),
          },
        });
        result.snapshot.network = await mirrorCourseOnPear(
          result.snapshot.course,
        );
        if (result.applied)
          broadcastCourseUpdated(courseId, result.snapshot.course.revision);
        return result.snapshot;
      }
      if (event.method === "DELETE") {
        const result = await applyStoredCourseOperation(session.accountId, {
          id: randomCourseId("op"),
          courseId,
          baseRevision: snapshot.course.revision,
          type: "material.delete",
          materialId,
        });
        if (material.storageKey)
          await deleteCourseMaterialBytes(material.storageKey);
        result.snapshot.network = await mirrorCourseOnPear(
          result.snapshot.course,
        );
        if (result.applied)
          broadcastCourseUpdated(courseId, result.snapshot.course.revision);
        return result.snapshot;
      }
      return fail(405, "Method not allowed.", "method_not_allowed");
    }

    if (path[1] === "invites" && path.length === 2) {
      if (event.method !== "POST")
        return fail(405, "Method not allowed.", "method_not_allowed");
      const body = inviteBodySchema.parse(await readBody(event));
      return createCourseInvite(
        courseId,
        session.accountId,
        body.role,
        body.expiresInHours,
        body.maxUses,
      );
    }

    return fail(404, "Not found.", "not_found");
  } catch (error) {
    return mapCourseError(error);
  }
});

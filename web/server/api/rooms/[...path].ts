/**
 * Study-room API. Identity is the Courses session (hosted Not Organic account,
 * development account, or a browser-local cookie identity), so a learner has
 * one identity across courses and rooms.
 *
 *   GET    /api/rooms                         rooms the viewer belongs to
 *   POST   /api/rooms                         create a room (optionally course-linked)
 *   GET    /api/rooms/course/:courseId        rooms linked to a course the viewer is in
 *   GET    /api/rooms/invites/:token          preview an invitation
 *   POST   /api/rooms/invites/:token          accept an invitation
 *   GET    /api/rooms/:id                     viewer snapshot
 *   DELETE /api/rooms/:id                     delete (host only)
 *   POST   /api/rooms/:id/operations          apply one operation
 *   POST   /api/rooms/:id/private-fork-context public context through a selected message
 *   GET    /api/rooms/:id/messages?before=    older messages
 *   POST   /api/rooms/:id/join                join a course-linked room as a course member
 *   GET    /api/rooms/:id/transcript          Markdown transcript of what the viewer can see
 *   GET    /api/rooms/:id/invites             invitation links
 *   POST   /api/rooms/:id/invites             create an invitation link
 *   DELETE /api/rooms/:id/invites/:inviteId   revoke an invitation link
 */
import {
  createError,
  defineEventHandler,
  getQuery,
  getRequestURL,
  setResponseHeaders,
  type H3Event,
} from "h3";
import { z } from "zod";
import {
  allCourseLessons,
  type CourseViewerSnapshot,
} from "../../../src/courses/contracts";
import { NotOrganicOperationalError } from "../../../src/notorganic-provider/server";
import {
  roomCreateInputSchema,
  roomInviteRoleSchema,
  roomOperationSchema,
  roomPrivateForkSourceSchema,
  roomSchema,
  ROOM_MAX_MEMBERS,
  type RoomContext,
} from "../../../src/rooms/contracts";
import { RoomOperationError } from "../../../src/rooms/operations";
import { requireCourseProductSession } from "../../utils/course-session";
import { consumePublicRateLimit } from "../../utils/public-abuse";
import { assertRoomRequestOrigin, readRoomBody } from "../../utils/room-request";
import {
  broadcastRoomChange,
  broadcastRoomRemoved,
} from "../../utils/room-realtime";
import {
  allowRemovedRoomMember,
  applyStoredRoomOperation,
  createRoom,
  createRoomInvite,
  deleteRoom,
  exportRoomTranscript,
  getRoomForAccount,
  getRoomMessagesBefore,
  getRoomPrivateForkContext,
  joinRoomThroughCourse,
  joinRoomWithInvite,
  listRemovedRoomMembers,
  listRoomInvites,
  listRoomsForAccount,
  listRoomsForCourse,
  previewRoomInvite,
  revokeRoomInvite,
} from "../../utils/room-repository";

const displayNameSchema = z.string().trim().min(1).max(120);
const inviteBodySchema = z.object({
  role: roomInviteRoleSchema,
  expiresInHours: z.number().int().min(1).max(24 * 30).default(72),
  maxUses: z.number().int().min(1).max(ROOM_MAX_MEMBERS).default(30),
});
const joinBodySchema = z.object({ displayName: displayNameSchema.optional() });
const messagesQuerySchema = z.object({
  before: z.coerce.number().int().positive(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

async function getCourseForAccount(courseId: string, accountId: string): Promise<CourseViewerSnapshot | null> {
  return (await import("../../utils/course-repository")).getCourseForAccount(courseId, accountId);
}

function segments(event: H3Event): string[] {
  return getRequestURL(event)
    .pathname.replace(/^\/api\/rooms\/?/, "")
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try { return decodeURIComponent(segment); }
      catch { return fail(400, "Invalid room path.", "room_invalid_request"); }
    });
}

function defaultDisplayName(accountId: string): string {
  return `Learner ${accountId.slice(-6)}`;
}

function fail(statusCode: number, statusMessage: string, code: string): never {
  throw createError({ statusCode, statusMessage, data: { code } });
}

function methodNotAllowed(): never {
  return fail(405, "Method not allowed.", "method_not_allowed");
}

function mapRoomError(error: unknown): never {
  if (error instanceof NotOrganicOperationalError) return fail(error.statusCode, "Room account authorization is unavailable. Try again.", error.code);
  if (error instanceof z.ZodError) {
    return fail(400, error.issues[0]?.message ?? "Invalid room request.", "room_invalid_request");
  }
  if (error instanceof RoomOperationError) return fail(error.statusCode, error.message, error.code);
  throw error;
}

/** Course member display names carry over into the course's rooms. */
function courseDisplayName(snapshot: CourseViewerSnapshot | null): string | undefined {
  return snapshot?.viewer.displayName;
}

async function courseContextFor(
  accountId: string,
  courseId: string | undefined,
  lessonId: string | undefined,
): Promise<{ context: RoomContext; course: CourseViewerSnapshot | null }> {
  if (lessonId && !courseId) return fail(400, "Choose a course for this lesson.", "room_invalid_request");
  if (!courseId) return { context: { objectives: [] }, course: null };
  const course = await getCourseForAccount(courseId, accountId);
  if (!course) return fail(404, "Course not found.", "course_not_found");
  if (course.viewer.role !== "owner" && course.viewer.role !== "teacher") {
    return fail(403, "Only course teachers can open course-linked rooms.", "room_course_forbidden");
  }
  const lesson = lessonId
    ? allCourseLessons(course.course).find((candidate) => candidate.id === lessonId)
    : undefined;
  if (lessonId && !lesson) return fail(404, "Lesson not found.", "course_lesson_not_found");
  return {
    course,
    context: {
      courseId,
      courseTitle: course.course.title.slice(0, 240),
      ...(lesson
        ? {
            lessonId: lesson.id,
            lessonTitle: lesson.title.slice(0, 240),
            ...(lesson.summary ? { lessonSummary: lesson.summary.slice(0, 2_000) } : {}),
          }
        : {}),
      objectives: (lesson?.objectives ?? course.course.outcomes).slice(0, 16).map((objective) => objective.slice(0, 1_000)),
    },
  };
}

export default defineEventHandler(async (event) => {
  try {
    if (event.method !== "GET" && event.method !== "HEAD") assertRoomRequestOrigin(event);
    const session = await requireCourseProductSession(event);
    const accountId = session.accountId;
    const path = segments(event);

    if (path.length === 0) {
      if (event.method === "GET") return { rooms: await listRoomsForAccount(accountId) };
      if (event.method !== "POST") return methodNotAllowed();
      await consumePublicRateLimit(event, { bucket: "room-create", key: accountId, limit: 30, windowSeconds: 3_600 });
      const body = roomCreateInputSchema.parse(await readRoomBody(event));
      const { context, course } = await courseContextFor(accountId, body.courseId, body.lessonId);
      return await createRoom(
        accountId,
        body.displayName ?? courseDisplayName(course) ?? defaultDisplayName(accountId),
        body,
        context,
      );
    }

    if (path[0] === "course" && path.length === 2) {
      if (event.method !== "GET") return methodNotAllowed();
      roomSchema.shape.id.parse(path[1]);
      const course = await getCourseForAccount(path[1]!, accountId);
      if (!course) return fail(404, "Course not found.", "course_not_found");
      return { rooms: await listRoomsForCourse(path[1]!, accountId) };
    }

    if (path[0] === "invites" && path.length === 2) {
      const token = path[1]!;
      if (event.method === "GET") {
        await consumePublicRateLimit(event, { bucket: "room-invite-preview", key: accountId, limit: 120, windowSeconds: 60 });
        const preview = await previewRoomInvite(token, accountId);
        if (!preview) return fail(404, "This invitation is invalid, expired, revoked, or the room has ended.", "room_invite_invalid");
        return preview;
      }
      if (event.method !== "POST") return methodNotAllowed();
      await consumePublicRateLimit(event, { bucket: "room-join", key: accountId, limit: 60, windowSeconds: 3_600 });
      const body = joinBodySchema.parse((await readRoomBody(event)) ?? {});
      const joined = await joinRoomWithInvite(token, accountId, body.displayName ?? defaultDisplayName(accountId));
      if (!joined) return fail(404, "This invitation is invalid, expired, revoked, or the room has ended.", "room_invite_invalid");
      if (joined.joined) broadcastRoomChange(joined.room, joined.room.messages.slice(-1).map((message) => message.id));
      return joined.snapshot;
    }

    const roomId = roomSchema.shape.id.parse(path[0]);

    if (path.length === 1) {
      if (event.method === "GET") {
        const snapshot = await getRoomForAccount(roomId, accountId);
        if (!snapshot) return fail(404, "Room not found.", "room_not_found");
        return snapshot;
      }
      if (event.method === "DELETE") {
        await deleteRoom(roomId, accountId);
        broadcastRoomRemoved(roomId);
        return { deleted: true };
      }
      return methodNotAllowed();
    }

    if (path[1] === "operations" && path.length === 2) {
      if (event.method !== "POST") return methodNotAllowed();
      await consumePublicRateLimit(event, { bucket: "room-operation", key: accountId, limit: 180, windowSeconds: 60 });
      const operation = roomOperationSchema.parse(await readRoomBody(event));
      if (operation.roomId !== roomId) return fail(400, "The operation targets a different room.", "room_invalid_request");
      if (operation.type === "message.post" || operation.type === "whisper.post") {
        await consumePublicRateLimit(event, { bucket: "room-post", key: accountId, limit: 40, windowSeconds: 60 });
      }
      const result = await applyStoredRoomOperation(accountId, operation);
      if (result.applied) {
        broadcastRoomChange(result.room, result.touchedMessageIds, result.removedAccountIds);
      }
      return result.snapshot ?? { removed: true };
    }

    if (path[1] === "private-fork-context" && path.length === 2) {
      if (event.method !== "POST") return methodNotAllowed();
      await consumePublicRateLimit(event, { bucket: "room-private-fork-context", key: accountId, limit: 60, windowSeconds: 60 });
      const source = roomPrivateForkSourceSchema.parse(await readRoomBody(event));
      return await getRoomPrivateForkContext(roomId, accountId, source);
    }

    if (path[1] === "messages" && path.length === 2) {
      if (event.method !== "GET") return methodNotAllowed();
      const query = messagesQuerySchema.parse(getQuery(event));
      const page = await getRoomMessagesBefore(roomId, accountId, query.before, query.limit);
      if (!page) return fail(404, "Room not found.", "room_not_found");
      return page;
    }

    if (path[1] === "join" && path.length === 2) {
      if (event.method !== "POST") return methodNotAllowed();
      const body = joinBodySchema.parse((await readRoomBody(event)) ?? {});
      const existing = await getRoomForAccount(roomId, accountId);
      if (existing) return existing;
      await consumePublicRateLimit(event, { bucket: "room-join", key: accountId, limit: 60, windowSeconds: 3_600 });
      const courseId = typeof getQuery(event).courseId === "string" ? String(getQuery(event).courseId) : "";
      if (!courseId) return fail(400, "courseId is required.", "room_invalid_request");
      const course = await getCourseForAccount(courseId, accountId);
      if (!course) return fail(404, "Room not found.", "room_not_found");
      const teaches = course.viewer.role === "owner" || course.viewer.role === "teacher";
      const joined = await joinRoomThroughCourse(
        roomId,
        courseId,
        accountId,
        body.displayName ?? course.viewer.displayName,
        teaches ? "teacher" : "learner",
      );
      if (joined.joined) broadcastRoomChange(joined.room, joined.room.messages.slice(-1).map((message) => message.id));
      return joined.snapshot;
    }

    if (path[1] === "transcript" && path.length === 2) {
      if (event.method !== "GET") return methodNotAllowed();
      const transcript = await exportRoomTranscript(roomId, accountId);
      if (transcript === null) return fail(404, "Room not found.", "room_not_found");
      setResponseHeaders(event, {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="keating-room-${roomId.slice(-8)}.md"`,
      });
      return transcript;
    }

    if (path[1] === "invites" && path.length === 2) {
      if (event.method === "GET") return { invites: await listRoomInvites(roomId, accountId) };
      if (event.method !== "POST") return methodNotAllowed();
      await consumePublicRateLimit(event, { bucket: "room-invite", key: accountId, limit: 60, windowSeconds: 3_600 });
      const body = inviteBodySchema.parse(await readRoomBody(event));
      return await createRoomInvite(roomId, accountId, body.role, body.expiresInHours, body.maxUses);
    }

    if (path[1] === "removed" && path.length === 2) {
      if (event.method !== "GET") return methodNotAllowed();
      return { removed: await listRemovedRoomMembers(roomId, accountId) };
    }

    if (path[1] === "removed" && path.length === 3) {
      if (event.method !== "DELETE") return methodNotAllowed();
      await allowRemovedRoomMember(roomId, accountId, path[2]!);
      return { allowed: true };
    }

    if (path[1] === "invites" && path.length === 3) {
      if (event.method !== "DELETE") return methodNotAllowed();
      await revokeRoomInvite(roomId, accountId, path[2]!);
      return { revoked: true };
    }

    return fail(404, "Not found.", "not_found");
  } catch (error) {
    return mapRoomError(error);
  }
});

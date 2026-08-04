import {
	createError,
	defineEventHandler,
	getRequestURL,
	readBody,
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
import {
	NotOrganicOperationalError,
} from "../../../src/notorganic-provider/server";
import {
	applyStoredCourseOperation,
	CourseEnrollmentConsentRequiredError,
	createCourse,
	createCourseInvite,
	getCourseForAccount,
	joinCourseWithInvite,
	listCoursesForAccount,
} from "../../utils/course-repository";
import { broadcastCourseUpdated } from "../../utils/course-realtime";
import { mirrorCourseOnPear } from "../../utils/course-pear-gateway";
import { requireCourseProductSession } from "../../utils/course-session";

const displayNameSchema = z.string().trim().min(1).max(120);
const createBodySchema = courseCreateInputSchema.extend({ displayName: displayNameSchema.optional() });
const inviteBodySchema = z.object({
	role: courseRoleSchema.exclude(["owner"]),
	expiresInHours: z.number().int().min(1).max(24 * 30).default(168),
	maxUses: z.number().int().min(1).max(5_000).default(25),
});
const joinBodySchema = z.object({
	displayName: displayNameSchema.optional(),
	acceptTeacherAccess: z.boolean().default(false),
});

function segments(event: H3Event): string[] {
	return getRequestURL(event).pathname
		.replace(/^\/api\/courses\/?/, "")
		.split("/")
		.filter(Boolean)
		.map((segment) => decodeURIComponent(segment));
}

function defaultDisplayName(accountId: string): string {
	return `Learner ${accountId.slice(-6)}`;
}

function fail(statusCode: number, statusMessage: string, code: string, data?: Record<string, unknown>): never {
	throw createError({ statusCode, statusMessage, data: { code, ...data } });
}

function mapCourseError(error: unknown): never {
	if (error instanceof NotOrganicOperationalError) {
		return fail(error.statusCode, error.message, error.code);
	}
	if (error instanceof z.ZodError) {
		return fail(400, error.issues[0]?.message ?? "Invalid course request.", "course_invalid_request");
	}
	if (error instanceof CourseConflictError) {
		return fail(409, error.message, error.code, { currentRevision: error.currentRevision });
	}
	if (error instanceof CourseAuthorizationError) return fail(403, error.message, error.code);
	if (error instanceof CourseNotFoundError) return fail(404, error.message, error.code);
	if (error instanceof CourseEnrollmentConsentRequiredError) return fail(409, error.message, error.code);
	if (error instanceof Error && error.message === "Course not found.") {
		return fail(404, "Course not found.", "course_not_found");
	}
	if (error instanceof Error && error.message === "You cannot invite people to this course.") {
		return fail(403, error.message, "course_forbidden");
	}
	throw error;
}

export default defineEventHandler(async (event) => {
	try {
		const session = await requireCourseProductSession(event);
		const path = segments(event);
		if (path[0] === "session" && path.length === 1) {
			if (event.method !== "GET") return fail(405, "Method not allowed.", "method_not_allowed");
			return { account: { id: session.accountId, displayName: defaultDisplayName(session.accountId) } };
		}

		if (path.length === 0) {
			if (event.method === "GET") return { courses: await listCoursesForAccount(session.accountId) };
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
			if (event.method !== "POST") return fail(405, "Method not allowed.", "method_not_allowed");
			const body = joinBodySchema.parse(await readBody(event));
			const snapshot = await joinCourseWithInvite(
				path[1]!,
				session.accountId,
				body.displayName ?? defaultDisplayName(session.accountId),
				body.acceptTeacherAccess,
			);
			if (!snapshot) return fail(404, "This invite is invalid, expired, or fully used.", "course_invite_invalid");
			snapshot.network = await mirrorCourseOnPear(snapshot.course);
			broadcastCourseUpdated(snapshot.course.id, snapshot.course.revision);
			return snapshot;
		}

		const courseId = path[0]!;
		if (path.length === 1) {
			if (event.method !== "GET") return fail(405, "Method not allowed.", "method_not_allowed");
			const snapshot = await getCourseForAccount(courseId, session.accountId);
			if (!snapshot) return fail(404, "Course not found.", "course_not_found");
			snapshot.network = await mirrorCourseOnPear(snapshot.course);
			return snapshot;
		}

		if (path[1] === "operations" && path.length === 2) {
			if (event.method !== "POST") return fail(405, "Method not allowed.", "method_not_allowed");
			const operation = courseOperationSchema.parse(await readBody(event));
			if (operation.courseId !== courseId) {
				return fail(400, "The operation targets a different course.", "course_invalid_request");
			}
			const result = await applyStoredCourseOperation(session.accountId, operation);
			result.snapshot.network = await mirrorCourseOnPear(result.snapshot.course);
			if (result.applied) broadcastCourseUpdated(courseId, result.snapshot.course.revision);
			return result;
		}

		if (path[1] === "invites" && path.length === 2) {
			if (event.method !== "POST") return fail(405, "Method not allowed.", "method_not_allowed");
			const body = inviteBodySchema.parse(await readBody(event));
			return createCourseInvite(courseId, session.accountId, body.role, body.expiresInHours, body.maxUses);
		}

		return fail(404, "Not found.", "not_found");
	} catch (error) {
		return mapCourseError(error);
	}
});

import { createError, defineWebSocketHandler, getQuery, toResponse } from "h3";
import type { CourseRealtimeMessage } from "../../../src/courses/contracts";
import {
	NotOrganicOperationalError,
} from "../../../src/notorganic-provider/server";
import { getCourseForAccount } from "../../utils/course-repository";
import {
	connectCoursePeer,
	disconnectCoursePeer,
} from "../../utils/course-realtime";
import { mirrorCourseOnPear } from "../../utils/course-pear-gateway";
import { requireCourseProductSession } from "../../utils/course-session";
import { assertCourseBridgeOrigin } from "../../utils/course-account-session";

function send(peer: { send(data: unknown): unknown }, message: CourseRealtimeMessage): void {
	peer.send(JSON.stringify(message));
}

export default defineWebSocketHandler((event) => {
	let authorized: { courseId: string; accountId: string } | undefined;
	let recheck: ReturnType<typeof setInterval> | undefined;
	return {
		async upgrade() {
			try {
				assertCourseBridgeOrigin(event);
				const session = await requireCourseProductSession(event);
				const courseId = getQuery(event).courseId;
				if (typeof courseId !== "string" || !courseId) throw createError({ statusCode: 400, statusMessage: "courseId is required." });
				if (!await getCourseForAccount(courseId, session.accountId)) throw createError({ statusCode: 404, statusMessage: "Course not found." });
				authorized = { courseId, accountId: session.accountId };
				return { headers: event.res.headers };
			} catch (error) {
				return toResponse(error instanceof NotOrganicOperationalError ? createError({ statusCode: error.statusCode, statusMessage: error.message }) : error, event, { silent: true });
			}
		},
		async open(peer) {
			if (!authorized) { peer.close(4403, "Course authorization required"); return; }
			const { courseId, accountId } = authorized;
			const snapshot = await getCourseForAccount(courseId, accountId);
			if (!snapshot) { peer.close(4403, "Not a course member"); return; }
			snapshot.network = await mirrorCourseOnPear(snapshot.course);
			connectCoursePeer(courseId, accountId, peer);
			send(peer, { type: "snapshot", snapshot });
			send(peer, { type: "gateway.status", status: snapshot.network?.status ?? "offline" });
			recheck = setInterval(() => {
				void requireCourseProductSession(event).then(async (session) => {
					if (session.accountId !== accountId || !await getCourseForAccount(courseId, accountId)) peer.close(4403, "Course authorization expired");
				}).catch(() => peer.close(4401, "Course account expired"));
			}, 15_000);
		},
		message(peer, message) {
			if (message.text() === "ping") {
				peer.send("pong");
				return;
			}
			send(peer, {
				type: "error",
				code: "course_realtime_read_only",
				message: "Send course changes through the authenticated operations endpoint.",
			});
		},
		close(peer) {
			if (recheck) clearInterval(recheck);
			if (authorized) disconnectCoursePeer(authorized.courseId, peer);
		},
	};
});

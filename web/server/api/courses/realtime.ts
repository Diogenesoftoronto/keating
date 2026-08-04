import { createError, defineWebSocketHandler, getQuery } from "h3";
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

function send(peer: { send(data: unknown): unknown }, message: CourseRealtimeMessage): void {
	peer.send(JSON.stringify(message));
}

export default defineWebSocketHandler(async (event) => {
	let session;
	try {
		session = await requireCourseProductSession(event);
	} catch (error) {
		if (error instanceof NotOrganicOperationalError) {
			throw createError({ statusCode: error.statusCode, statusMessage: error.message });
		}
		throw error;
	}
	const courseId = getQuery(event).courseId;
	if (typeof courseId !== "string" || !courseId) {
		throw createError({ statusCode: 400, statusMessage: "courseId is required." });
	}
	const snapshot = await getCourseForAccount(courseId, session.accountId);
	if (!snapshot) throw createError({ statusCode: 404, statusMessage: "Course not found." });
	snapshot.network = await mirrorCourseOnPear(snapshot.course);

	return {
		open(peer) {
			connectCoursePeer(courseId, session.accountId, peer);
			send(peer, { type: "snapshot", snapshot });
			send(peer, { type: "gateway.status", status: snapshot.network?.status ?? "offline" });
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
			disconnectCoursePeer(courseId, peer);
		},
	};
});

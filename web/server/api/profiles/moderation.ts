import { createError, defineEventHandler, setHeader } from "h3";
import { isProfileDid } from "../../../src/keating/public-profile-contract";
import { readBoundedJsonBody } from "../../utils/bounded-body";
import { consumePublicRateLimit } from "../../utils/public-abuse";
import { clearPublicProfileCache } from "../../utils/public-profile";
import { isModerator, listReportedProfiles, setProfileHidden } from "../../utils/public-profile-moderation";

/**
 * Operator-only. GET lists reported profiles; POST { did, hidden, note? }
 * hides a profile from keating.help or shows it again.
 */
export default defineEventHandler(async (event) => {
	setHeader(event, "Cache-Control", "no-store");
	await consumePublicRateLimit(event, { bucket: "profile-moderation-client", limit: 60, windowSeconds: 600 });
	// One answer for "no token configured" and "wrong token", so the route reveals nothing.
	if (!isModerator(event.req.headers.get("authorization"))) {
		throw createError({ statusCode: 404, statusMessage: "Not found" });
	}

	if (event.method === "GET") return { profiles: await listReportedProfiles() };
	if (event.method !== "POST") throw createError({ statusCode: 405, statusMessage: "Method not allowed" });

	const body = await readBoundedJsonBody(event.req, 2_048) as { did?: unknown; hidden?: unknown; note?: unknown } | null;
	if (!body || !isProfileDid(body.did) || typeof body.hidden !== "boolean") {
		throw createError({ statusCode: 400, statusMessage: "Send { did, hidden } with a valid learner identity." });
	}
	await setProfileHidden(body.did, body.hidden, typeof body.note === "string" ? body.note : undefined);
	clearPublicProfileCache();
	return { did: body.did, hidden: body.hidden };
});

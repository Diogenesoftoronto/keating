import { defineEventHandler, getRequestURL, setHeader } from "h3";
import { consumePublicRateLimit } from "../../utils/public-abuse";
import { loadPublicProfile, PublicProfileError } from "../../utils/public-profile";
import { isProfileHidden } from "../../utils/public-profile-moderation";

const STATUS: Record<PublicProfileError["code"], number> = {
	invalid_did: 400,
	unresolvable: 404,
	upstream_unavailable: 502,
	invalid_data: 502,
};

/** Public read of one learner's published profile, fetched from their own PDS. */
export default defineEventHandler(async (event) => {
	// Each lookup makes this server contact a host named by the caller; keep that cheap to refuse.
	await consumePublicRateLimit(event, { bucket: "profile-read-client", limit: 120, windowSeconds: 600 });
	await consumePublicRateLimit(event, { bucket: "profile-read-global", key: "global", limit: 6_000, windowSeconds: 600 });

	// Never cached downstream: a withdrawn or hidden profile must disappear as soon as this server knows.
	const noStore = { "Cache-Control": "no-store" };
	const refuse = (status: number, message: string, code: string) => Response.json({ statusCode: status, message, code }, { status, headers: noStore });

	let did: string;
	try {
		did = decodeURIComponent(getRequestURL(event).pathname.split("/").filter(Boolean).pop() ?? "");
	} catch {
		return refuse(400, "That is not a valid learner identity.", "invalid_did");
	}

	try {
		const result = await loadPublicProfile(did, { isHidden: isProfileHidden });
		setHeader(event, "Cache-Control", "no-store");
		return result;
	} catch (error) {
		if (error instanceof PublicProfileError) return refuse(STATUS[error.code], error.message, error.code);
		throw error;
	}
});

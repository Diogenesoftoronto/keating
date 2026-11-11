import { createError, defineEventHandler, setHeader } from "h3";
import { readBoundedJsonBody } from "../../utils/bounded-body";
import { consumePublicRateLimit, publicClientIdentity } from "../../utils/public-abuse";
import { parseProfileReport, recordProfileReport } from "../../utils/public-profile-moderation";

/** Anyone can report a public profile. No account is needed, so the limits do the gatekeeping. */
export default defineEventHandler(async (event) => {
	setHeader(event, "Cache-Control", "no-store");
	await consumePublicRateLimit(event, { bucket: "profile-report-client", limit: 6, windowSeconds: 3600 });
	await consumePublicRateLimit(event, { bucket: "profile-report-global", key: "global", limit: 600, windowSeconds: 3600 });

	let input: ReturnType<typeof parseProfileReport>;
	try {
		input = parseProfileReport(await readBoundedJsonBody(event.req, 4_096));
	} catch (error) {
		if (error && typeof error === "object" && "statusCode" in error) throw error;
		throw createError({ statusCode: 400, statusMessage: error instanceof Error ? error.message : "The report could not be read." });
	}

	try {
		const report = await recordProfileReport(input, publicClientIdentity(event));
		return { received: true, id: report.id };
	} catch {
		throw createError({ statusCode: 503, statusMessage: "The report could not be saved. Please try again." });
	}
});

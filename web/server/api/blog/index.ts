import { createError, defineEventHandler } from "h3";
import { AtprotoBlogError, loadAtprotoBlogFeed } from "../../utils/atproto-blog";

export default defineEventHandler(async (event) => {
	if (event.method !== "GET") {
		throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
	}
	try {
		return await loadAtprotoBlogFeed();
	} catch (error) {
		if (error instanceof AtprotoBlogError) {
			throw createError({
				statusCode: error.code === "not_found" ? 404 : 503,
				statusMessage: error.message,
			});
		}
		throw createError({ statusCode: 503, statusMessage: "The AT Protocol blog is unavailable" });
	}
});

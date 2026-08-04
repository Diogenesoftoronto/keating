import { createError, defineEventHandler, setResponseHeader } from "h3";
import { AtprotoBlogError, loadAtprotoBlogFeed } from "../../utils/atproto-blog";

export default defineEventHandler(async (event) => {
	if (event.method !== "GET") {
		throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
	}
	try {
		const feed = await loadAtprotoBlogFeed();
		setResponseHeader(event, "Content-Type", "text/plain; charset=utf-8");
		setResponseHeader(event, "Cache-Control", "public, max-age=60");
		return feed.publication.uri;
	} catch (error) {
		if (error instanceof AtprotoBlogError) {
			throw createError({ statusCode: error.code === "not_found" ? 404 : 503, statusMessage: error.message });
		}
		throw createError({ statusCode: 503, statusMessage: "The Standard.site publication is unavailable" });
	}
});

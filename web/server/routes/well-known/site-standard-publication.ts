import { createError, defineEventHandler, sendRedirect, setResponseHeader } from "h3";
import { BLOG_PUBLICATION_URL } from "../../../src/lib/blog-links";

export default defineEventHandler((event) => {
	if (event.method !== "GET" && event.method !== "HEAD") {
		throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
	}
	setResponseHeader(event, "Cache-Control", "no-store");
	return sendRedirect(event, BLOG_PUBLICATION_URL, 308);
});

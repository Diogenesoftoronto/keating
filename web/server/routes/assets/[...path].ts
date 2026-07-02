import { createError, defineEventHandler, setResponseHeaders } from "h3";

export default defineEventHandler((event) => {
	setResponseHeaders(event, {
		"Cache-Control": "no-store",
		"Content-Type": "text/plain; charset=utf-8",
	});

	throw createError({
		statusCode: 404,
		statusMessage: "Asset not found",
		message: "This build asset is no longer available. Reload the app to fetch the latest build.",
	});
});

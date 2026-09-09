import { defineEventHandler, setResponseHeader, setResponseStatus } from "h3";

// Specific API routes take precedence over this fallback. Without it Nitro's
// renderer returns index.html for a missing API and clients try to parse HTML.
export default defineEventHandler((event) => {
	setResponseHeader(event, "Cache-Control", "no-store");
	setResponseStatus(event, 404);
	return { error: "This Keating API endpoint is unavailable. Restart or update the full Keating server." };
});

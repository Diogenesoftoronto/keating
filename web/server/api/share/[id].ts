import { createError, defineEventHandler, getRequestURL } from "h3";
import { useStorage } from "nitro/storage";

const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{8,32}$/;

function shareIdFromPath(pathname: string) {
	const id = pathname.split("/").filter(Boolean).pop() ?? "";
	return decodeURIComponent(id);
}

export default defineEventHandler(async (event) => {
	if (event.method !== "GET") {
		throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
	}

	const id = shareIdFromPath(getRequestURL(event).pathname);
	if (!SHARE_ID_PATTERN.test(id)) {
		throw createError({ statusCode: 400, statusMessage: "Invalid shared session id" });
	}

	const shared = await useStorage("keating:share").getItem(id);
	if (!shared) {
		throw createError({ statusCode: 404, statusMessage: "Shared session not found" });
	}

	return shared;
});

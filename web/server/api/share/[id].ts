import { createError, defineEventHandler, getRequestURL } from "h3";
import { useStorage } from "nitro/storage";
import {
	isValidShareId,
	projectSharedSessionPayload,
} from "../../../src/keating/share-contract";

function shareIdFromPath(pathname: string) {
	const id = pathname.split("/").filter(Boolean).pop() ?? "";
	return decodeURIComponent(id);
}

export default defineEventHandler(async (event) => {
	if (event.method !== "GET") {
		throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
	}

	const id = shareIdFromPath(getRequestURL(event).pathname);
	if (!isValidShareId(id)) {
		throw createError({ statusCode: 400, statusMessage: "Invalid shared session id" });
	}

	const shared = await useStorage("keating:share").getItem(id);
	if (!shared) {
		throw createError({ statusCode: 404, statusMessage: "Shared session not found" });
	}

	const projected = projectSharedSessionPayload(shared);
	if (!projected) {
		throw createError({ statusCode: 404, statusMessage: "Shared session is no longer readable" });
	}
	return { ...projected, id };
});

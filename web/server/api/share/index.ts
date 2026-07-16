import { createError, defineEventHandler, readBody } from "h3";
import { useStorage } from "nitro/storage";
import {
	compactShareIdFromBytes,
	SHARE_ID_BYTES,
	SHARE_MAX_BYTES,
	validateSharedSessionPayload,
} from "../../../src/keating/share-contract";

function compactShareId() {
	const bytes = new Uint8Array(SHARE_ID_BYTES);
	globalThis.crypto.getRandomValues(bytes);
	return compactShareIdFromBytes(bytes);
}

export default defineEventHandler(async (event) => {
	if (event.method !== "POST") {
		throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
	}

	const body = await readBody(event);
	const validationError = validateSharedSessionPayload(body);
	if (validationError) throw createError({ statusCode: 400, statusMessage: validationError });

	const size = new TextEncoder().encode(JSON.stringify(body)).length;
	if (size > SHARE_MAX_BYTES) {
		throw createError({ statusCode: 413, statusMessage: "Shared session is too large" });
	}

	const storage = useStorage("keating:share");
	let id = compactShareId();
	for (let attempt = 0; attempt < 4 && await storage.hasItem(id); attempt++) {
		id = compactShareId();
	}

	const shared = {
		...body,
		id,
		schemaVersion: 2,
		messageCount: body.messages.length,
	};
	await storage.setItem(id, shared);
	return { id };
});

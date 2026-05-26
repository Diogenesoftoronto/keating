import { createError, defineEventHandler, readBody } from "h3";
import { useStorage } from "nitro/storage";

const MAX_SHARE_BYTES = 512 * 1024;
const SHARE_ID_BYTES = 9;
const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{8,32}$/;

function compactShareId() {
	const bytes = new Uint8Array(SHARE_ID_BYTES);
	globalThis.crypto.getRandomValues(bytes);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function validateSharedSession(value: any) {
	if (!value || typeof value !== "object") {
		throw createError({ statusCode: 400, statusMessage: "Expected shared session object" });
	}
	if (typeof value.title !== "string" || !value.title.trim()) {
		throw createError({ statusCode: 400, statusMessage: "Missing shared session title" });
	}
	if (!Array.isArray(value.messages) || value.messages.length === 0) {
		throw createError({ statusCode: 400, statusMessage: "Missing shared session messages" });
	}
	if (value.id !== undefined && (typeof value.id !== "string" || !SHARE_ID_PATTERN.test(value.id))) {
		throw createError({ statusCode: 400, statusMessage: "Invalid shared session id" });
	}
	for (const message of value.messages) {
		const role = message?.role;
		if (role !== "user" && role !== "user-with-attachments" && role !== "assistant") {
			throw createError({ statusCode: 400, statusMessage: "Invalid shared session message role" });
		}
		if (!Array.isArray(message?.content)) {
			throw createError({ statusCode: 400, statusMessage: "Invalid shared session message content" });
		}
	}
}

export default defineEventHandler(async (event) => {
	if (event.method !== "POST") {
		throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
	}

	const body = await readBody(event);
	validateSharedSession(body);

	const size = new TextEncoder().encode(JSON.stringify(body)).length;
	if (size > MAX_SHARE_BYTES) {
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

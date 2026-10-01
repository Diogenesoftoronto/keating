import { createError, defineEventHandler } from "h3";
import { useStorage } from "nitro/storage";
import { readBoundedBody } from "../../utils/bounded-body";
import { consumePublicRateLimit, publicClientIdentity, reservePublicQuota } from "../../utils/public-abuse";
import {
	compactShareIdFromBytes,
	projectSharedSessionPayload,
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

	if (event.req.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
		throw createError({ statusCode: 415, statusMessage: "Use application/json for shared sessions" });
	}
	await consumePublicRateLimit(event, { bucket: "share-create-global", key: "global", limit: 300, windowSeconds: 3600 });
	await consumePublicRateLimit(event, { bucket: "share-create-client", limit: 10, windowSeconds: 3600 });
	const input = await readBoundedBody(event.req, SHARE_MAX_BYTES);
	let body: unknown;
	try {
		body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input));
	} catch {
		throw createError({ statusCode: 400, statusMessage: "Invalid JSON shared session" });
	}
	const encoder = new TextEncoder();
	const validationError = validateSharedSessionPayload(body);
	if (validationError) throw createError({ statusCode: 400, statusMessage: validationError });
	const projected = projectSharedSessionPayload(body);
	if (!projected) throw createError({ statusCode: 400, statusMessage: "Shared session could not be projected safely" });

	const projectedSize = encoder.encode(JSON.stringify(projected)).length;
	if (projectedSize > SHARE_MAX_BYTES) {
		throw createError({ statusCode: 413, statusMessage: "Shared session is too large" });
	}

	const storage = useStorage("keating:share");
	let id = compactShareId();
	for (let attempt = 0; attempt < 4 && await storage.hasItem(id); attempt++) {
		id = compactShareId();
	}

	const shared = {
		...projected,
		id,
	};
	// Count the actual stored snapshot, including its generated ID. Keep existing
	// links indefinitely: these quotas bound new writes without deleting data.
	const storedSize = encoder.encode(JSON.stringify(shared)).length;
	if (storedSize > SHARE_MAX_BYTES) {
		throw createError({ statusCode: 413, statusMessage: "Shared session is too large" });
	}
	const reservations: Array<{ release: () => Promise<void> }> = [];
	try {
		reservations.push(await reservePublicQuota({ bucket: "share-bytes-client", key: publicClientIdentity(event), amount: storedSize, limit: 8 * 1024 * 1024, windowSeconds: 86400 }));
		reservations.push(await reservePublicQuota({ bucket: "share-bytes-global", key: "global", amount: storedSize, limit: 64 * 1024 * 1024, windowSeconds: 86400 }));
		await storage.setItem(id, shared);
	} catch (error) {
		await Promise.allSettled(reservations.map((reservation) => reservation.release()));
		throw error;
	}
	return { id };
});

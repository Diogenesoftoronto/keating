import { createError, defineEventHandler, readBody, setResponseHeader } from "h3";
import {
	getNotOrganicServerConfig,
	NotOrganicOperationalError,
	requireNotOrganicProductSession,
} from "../../../../src/notorganic-provider/server";
import { NotOrganicFetchAdapter } from "../../../../src/notorganic-provider/fetch-adapter";

function validPublicJwk(value: unknown): value is JsonWebKey {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const key = value as JsonWebKey;
	return key.kty === "EC"
		&& key.crv === "P-256"
		&& typeof key.x === "string"
		&& typeof key.y === "string"
		&& key.d === undefined
		&& key.x.length <= 128
		&& key.y.length <= 128;
}

export default defineEventHandler(async (event) => {
	try {
		const body = await readBody<{ client_public_jwk?: unknown }>(event);
		if (!body || !validPublicJwk(body.client_public_jwk)) {
			throw createError({ statusCode: 400, statusMessage: "A P-256 client wrapping key is required." });
		}
		const config = getNotOrganicServerConfig();
		if (!config.enabled) throw new NotOrganicOperationalError("Not Organic account sync is disabled.");
		const session = await requireNotOrganicProductSession(event, "keating:sync-key");
		const client = new NotOrganicFetchAdapter({ baseUrl: config.gatewayBaseUrl, session });
		const response = await client.request("/v1/sync/account-key", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ client_public_jwk: body.client_public_jwk }),
		});
		setResponseHeader(event, "cache-control", "no-store");
		setResponseHeader(event, "pragma", "no-cache");
		response.headers.set("cache-control", "no-store");
		response.headers.set("pragma", "no-cache");
		return response;
	} catch (error) {
		if (error instanceof NotOrganicOperationalError) {
			throw createError({ statusCode: error.statusCode, statusMessage: error.message, data: { code: error.code } });
		}
		throw error;
	}
});

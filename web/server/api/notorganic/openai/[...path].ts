import { createError, defineEventHandler, getHeader, getRequestURL } from "h3";
import { NOTORGANIC_FEATURE } from "../../../../src/notorganic-provider";
import {
	createNotOrganicServerClient,
	getNotOrganicServerConfig,
	NotOrganicOperationalError,
} from "../../../../src/notorganic-provider/server";

const ALLOWED_ROUTES = new Set([
	"v1/chat/completions",
	"v1/responses",
	"v1/embeddings",
	"v1/images/generations",
	"v1/audio/speech",
	"v1/audio/transcriptions",
	"v1/audio/translations",
	"v1/models",
]);

export default defineEventHandler(async (event) => {
	const reqUrl = getRequestURL(event);
	const route = reqUrl.pathname
		.replace(/^\/api\/notorganic\/openai\/?/, "")
		.replace(/\/+$/, "");
	const allowedMethod =
		(event.method === "POST" && ALLOWED_ROUTES.has(route)) ||
		(event.method === "GET" && route === "v1/models");
	if (!allowedMethod) {
		throw createError({ statusCode: 404, statusMessage: "Not found" });
	}

	try {
		const config = getNotOrganicServerConfig();
		if (!config.enabled) {
			throw createError({ statusCode: 404, statusMessage: "Not found" });
		}
		const client = await createNotOrganicServerClient(event, NOTORGANIC_FEATURE, config);
		return await client.request(`/${route}${reqUrl.search}`, {
			method: event.method,
			body: event.method === "GET" ? undefined : event.req.body,
			headers: {
				...(getHeader(event, "content-type") ? { "content-type": getHeader(event, "content-type")! } : {}),
				...(getHeader(event, "accept") ? { accept: getHeader(event, "accept")! } : {}),
			},
			idempotencyKey: getHeader(event, "idempotency-key") ?? undefined,
			maxCostMicrousd: event.method === "POST" ? config.maxCostMicrousd : undefined,
		});
	} catch (error) {
		if (error instanceof NotOrganicOperationalError) {
			throw createError({
				statusCode: error.statusCode,
				statusMessage: error.message,
				data: { code: error.code },
			});
		}
		throw error;
	}
});

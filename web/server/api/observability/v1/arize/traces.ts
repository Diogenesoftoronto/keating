import { createError, defineEventHandler, getHeader, getRequestIP, getRequestURL, readRawBody, setResponseStatus } from "h3";
import { exportAgentTrace, IpRateLimiter, readServerArizeConfig, requestWithinLimit, validateTracePayload } from "../../../../utils/arize-observability";

const rateLimiter = new IpRateLimiter();

export default defineEventHandler(async (event) => {
	if (event.method !== "POST") throw createError({ statusCode: 405, statusMessage: "Use POST for Arize traces." });
	const config = readServerArizeConfig();
	if (!config.enabled) { setResponseStatus(event, 204); return null; }
	const contentType = getHeader(event, "content-type") ?? "";
	if (!contentType.toLowerCase().startsWith("application/json")) throw createError({ statusCode: 415, statusMessage: "JSON required." });
	if (!requestWithinLimit(getHeader(event, "content-length"))) throw createError({ statusCode: 413, statusMessage: "Trace is too large." });
	const origin = getHeader(event, "origin");
	const url = getRequestURL(event);
	if (!origin || origin !== url.origin) throw createError({ statusCode: 403, statusMessage: "Same-origin request required." });
	if (!rateLimiter.allow(getRequestIP(event, { xForwardedFor: config.trustProxyIp }) ?? "unknown", config.rateLimitPerMinute)) throw createError({ statusCode: 429, statusMessage: "Try again later." });
	let payload: unknown;
	try {
		const rawBody = await readRawBody(event);
		if (rawBody === undefined || Buffer.byteLength(rawBody, "utf8") > 64 * 1024) {
			throw createError({ statusCode: 413, statusMessage: "Trace is too large." });
		}
		payload = JSON.parse(rawBody);
	} catch (error) {
		if (error && typeof error === "object" && "statusCode" in error) throw error;
		throw createError({ statusCode: 400, statusMessage: "Invalid JSON." });
	}
	let envelope;
	try { envelope = validateTracePayload(payload, config); } catch { throw createError({ statusCode: 400, statusMessage: "Invalid trace envelope." }); }
	try {
		await exportAgentTrace(envelope, config);
	} catch {
		throw createError({ statusCode: 503, statusMessage: "Arize trace export unavailable." });
	}
	setResponseStatus(event, 202);
	return { accepted: true };
});

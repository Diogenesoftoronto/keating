import { assertMethod, createError, defineEventHandler, readBody, setResponseHeader, setResponseStatus } from "h3";
import { CodexDeviceAuthError, pollCodexDeviceAuth } from "./openai-codex-device-flow";

export default defineEventHandler(async (event) => {
	setResponseHeader(event, "Cache-Control", "no-store");
	assertMethod(event, "POST");
	const body: unknown = await readBody(event);
	try {
		const result = await pollCodexDeviceAuth(body);
		if (result.status === "pending") setResponseStatus(event, 202);
		if (result.status === "slow_down") setResponseStatus(event, 429);
		if (result.status === "denied") setResponseStatus(event, 403);
		if (result.status === "expired") setResponseStatus(event, 410);
		return result;
	} catch (error) {
		throw createError({
			statusCode: error instanceof CodexDeviceAuthError ? error.statusCode : 502,
			statusMessage: error instanceof CodexDeviceAuthError ? error.message : "OpenAI sign-in failed.",
		});
	}
});

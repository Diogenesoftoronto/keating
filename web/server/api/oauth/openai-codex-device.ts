import { assertMethod, createError, defineEventHandler, setResponseHeader } from "h3";
import { CodexDeviceAuthError, startCodexDeviceAuth } from "./openai-codex-device-flow";

export default defineEventHandler(async (event) => {
	setResponseHeader(event, "Cache-Control", "no-store");
	assertMethod(event, "POST");
	try {
		return await startCodexDeviceAuth();
	} catch (error) {
		throw createError({
			statusCode: error instanceof CodexDeviceAuthError ? error.statusCode : 502,
			statusMessage: error instanceof CodexDeviceAuthError ? error.message : "OpenAI sign-in failed.",
		});
	}
});

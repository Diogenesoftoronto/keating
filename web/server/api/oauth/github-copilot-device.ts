import { createError, defineEventHandler } from "h3";
import { startGitHubCopilotDeviceFlow } from "./github-copilot";

export default defineEventHandler(async () => {
	try {
		return await startGitHubCopilotDeviceFlow();
	} catch (error) {
		console.error(
			"[oauth/github-copilot/device] Device authorization failed:",
			error instanceof Error ? error.message : "Unknown error",
		);
		throw createError({
			statusCode: 502,
			statusMessage: "GitHub device authorization failed",
		});
	}
});

import { createError, defineEventHandler, readBody, setResponseStatus } from "h3";
import { pollGitHubCopilotDeviceFlow } from "./github-copilot";

interface PollRequestBody {
	device_code?: string;
}

export default defineEventHandler(async (event) => {
	const body = await readBody<PollRequestBody>(event);
	if (!body?.device_code) {
		throw createError({ statusCode: 400, statusMessage: "Missing device_code" });
	}

	try {
		const result = await pollGitHubCopilotDeviceFlow(body.device_code);
		if (result.status === "pending") {
			setResponseStatus(event, 202);
			return result;
		}
		if (result.status === "slow_down") {
			setResponseStatus(event, 429);
			return result;
		}
		if (result.status === "failed") {
			throw createError({ statusCode: 400, statusMessage: result.error });
		}
		return result;
	} catch (error) {
		if ((error as { statusCode?: number }).statusCode) throw error;
		console.error(
			"[oauth/github-copilot/poll] Device token exchange failed:",
			error instanceof Error ? error.message : "Unknown error",
		);
		throw createError({
			statusCode: 502,
			statusMessage: "GitHub Copilot token exchange failed",
		});
	}
});

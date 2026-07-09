const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com";

type LoadCodeAssistResponse = {
	cloudaicompanionProject?: string | { id?: string };
};

export async function discoverGoogleCloudProject(accessToken: string): Promise<string> {
	const response = await fetch(`${CODE_ASSIST_ENDPOINT}/v1internal:loadCodeAssist`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
			"User-Agent": "google-api-nodejs-client/9.15.1",
			"X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
			"Client-Metadata": JSON.stringify({
				ideType: "IDE_UNSPECIFIED",
				platform: "PLATFORM_UNSPECIFIED",
				pluginType: "GEMINI",
			}),
		},
		body: JSON.stringify({
			metadata: {
				ideType: "IDE_UNSPECIFIED",
				platform: "PLATFORM_UNSPECIFIED",
				pluginType: "GEMINI",
			},
		}),
	});

	if (!response.ok) {
		const detail = (await response.text()).slice(0, 240);
		throw new Error(`Google Cloud project discovery failed (${response.status}): ${detail}`);
	}

	const payload = (await response.json()) as LoadCodeAssistResponse;
	const project = payload.cloudaicompanionProject;
	const projectId = typeof project === "string" ? project : project?.id;
	if (!projectId) {
		throw new Error("Google Cloud Code Assist did not return a project. Enable Gemini Code Assist and try again.");
	}
	return projectId;
}

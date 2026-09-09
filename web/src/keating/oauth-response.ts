/** Never expose an HTML error page (or token response body) in sign-in errors. */
export async function readOAuthJson(response: Response): Promise<Record<string, any>> {
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Keating’s sign-in API returned an empty response. Please try again.");
	let text = "";
	let bytes = 0;
	const decoder = new TextDecoder();
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			bytes += chunk.value.byteLength;
			if (bytes > 128 * 1024) throw new Error("Keating’s sign-in API returned an unexpected response. Restart or update Keating and try again.");
			text += decoder.decode(chunk.value, { stream: true });
		}
		text += decoder.decode();
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
	if (response.headers.get("content-type")?.includes("text/html") || text.trimStart().startsWith("<")) {
		throw new Error("Keating’s sign-in API returned a web page. Restart or update the desktop app. For local web development, start the full app with devenv tasks run keating:web.");
	}
	let value: unknown;
	try { value = JSON.parse(text); } catch {
		throw new Error("Keating’s sign-in API returned an invalid response. Please try again.");
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Keating’s sign-in API returned an invalid response. Please try again.");
	return value as Record<string, any>;
}

import { defineEventHandler, getRequestURL, sendRedirect, setResponseHeader } from "h3";
import { useStorage } from "nitro/storage";
import { renderShareOgPng } from "../../utils/og-render";

const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{8,32}$/;

function firstMessageText(shared: any): string {
	const messages = Array.isArray(shared?.messages) ? shared.messages : [];
	for (const message of messages) {
		const content = message?.content;
		const text =
			typeof content === "string"
				? content
				: Array.isArray(content)
					? content
							.filter((part: any) => part?.type === "text" && typeof part.text === "string")
							.map((part: any) => part.text)
							.join(" ")
					: "";
		const trimmed = String(text).trim();
		if (trimmed) return trimmed;
	}
	return "A Socratic tutoring session on Keating.";
}

export default defineEventHandler(async (event) => {
	const id = getRequestURL(event).pathname.split("/").pop() ?? "";

	// Any problem (bad id, missing share, render failure) falls back to the
	// branded static card so embeds always resolve to a real image.
	const fallback = () => sendRedirect(event, "/og-image.png", 302);

	if (!SHARE_ID_PATTERN.test(id)) return fallback();

	let shared: any;
	try {
		shared = await useStorage("keating:share").getItem(id);
	} catch {
		return fallback();
	}
	if (!shared) return fallback();

	const title = String(shared.title ?? "Shared Keating session").slice(0, 120);
	const subtitle = firstMessageText(shared).slice(0, 160);

	try {
		const png = await renderShareOgPng(title, subtitle);
		setResponseHeader(event, "Content-Type", "image/png");
		setResponseHeader(event, "Cache-Control", "public, max-age=86400");
		return png;
	} catch (error) {
		console.warn("[keating:og] render failed, using static fallback:", error);
		return fallback();
	}
});

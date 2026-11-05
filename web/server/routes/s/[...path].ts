// Serves the SPA shell for share links (/s/:id), but with per-share OpenGraph
// and Twitter meta injected so Discord/X/Slack/etc. render a rich embed for the
// specific shared session instead of the generic homepage card. Humans still
// get the full SPA (the shell boots normally); only the <head> meta differs.
import { createError, defineEventHandler, getRequestURL, setResponseHeader } from "h3";
import { useStorage } from "nitro/storage";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{8,32}$/;

let cachedShell: string | null = null;

const SHELL_CANDIDATES = [
	"./dist/index.html",
	"dist/index.html",
	"./.output/public/index.html",
	"./public/index.html",
];

function decodeShell(raw: unknown): string | null {
	if (typeof raw === "string") return raw || null;
	if (raw instanceof Uint8Array) return new TextDecoder().decode(raw) || null;
	return null;
}

async function loadShell(): Promise<string | null> {
	if (cachedShell) return cachedShell;
	try {
		cachedShell = decodeShell(await useStorage("assets:keating-shell").getItemRaw("index.html"));
		if (cachedShell) return cachedShell;
	} catch {
		// fall back to the filesystem (dev server, older builds)
	}
	const entry = process.argv[1];
	const candidates = entry ? [join(dirname(entry), "../public/index.html"), ...SHELL_CANDIDATES] : SHELL_CANDIDATES;
	for (const path of candidates) {
		try {
			cachedShell = await readFile(path, "utf8");
			return cachedShell;
		} catch {
			// try next candidate
		}
	}
	return null;
}

function escapeAttr(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

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
		const trimmed = String(text).replace(/\s+/g, " ").trim();
		if (trimmed) return trimmed;
	}
	return "A Socratic tutoring session on Keating.";
}

/** Replace the content of a <meta property|name="key"> tag, or append it. */
function setMeta(html: string, attr: "property" | "name", key: string, value: string): string {
	const escaped = escapeAttr(value);
	const pattern = new RegExp(
		`(<meta\\s+${attr}=["']${key}["']\\s+content=["'])[^"']*(["']\\s*/?>)`,
		"i",
	);
	if (pattern.test(html)) return html.replace(pattern, `$1${escaped}$2`);
	return html.replace(
		/<\/head>/i,
		`  <meta ${attr}="${key}" content="${escaped}">\n</head>`,
	);
}

export default defineEventHandler(async (event) => {
	const shell = await loadShell();
	// Returning nothing here sends an empty 200, which browsers show as a blank
	// page. Fail loudly instead so a missing shell is visible in logs and probes.
	if (!shell) throw createError({ statusCode: 503, statusMessage: "Share page shell unavailable" });

	const url = getRequestURL(event);
	const id = url.pathname.replace(/^\/s\//, "").split("/")[0] ?? "";

	let html = shell;
	if (SHARE_ID_PATTERN.test(id)) {
		let shared: any = null;
		try {
			shared = await useStorage("keating:share").getItem(id);
		} catch {
			shared = null;
		}
		if (shared) {
			const title = `${String(shared.title ?? "Shared session").slice(0, 110)} · Keating`;
			const description = firstMessageText(shared).slice(0, 200);
			const shareUrl = `${url.origin}/s/${id}`;
			const image = `${url.origin}/api/og/${id}`;

			html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeAttr(title)}</title>`);
			html = setMeta(html, "property", "og:title", title);
			html = setMeta(html, "property", "og:description", description);
			html = setMeta(html, "property", "og:url", shareUrl);
			html = setMeta(html, "property", "og:image", image);
			html = setMeta(html, "name", "twitter:title", title);
			html = setMeta(html, "name", "twitter:description", description);
			html = setMeta(html, "name", "twitter:image", image);
		}
	}

	setResponseHeader(event, "Content-Type", "text/html; charset=utf-8");
	return html;
});

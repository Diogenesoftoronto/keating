// Serve the SPA shell for blog URLs with the canonical Standard.site record in
// the initial HTML. Indexers can verify the document without executing React;
// the browser still boots the same client-side reader.
import { readFile } from "node:fs/promises";
import { defineEventHandler, getRequestURL, setResponseHeader } from "h3";
import type { AtprotoBlogPost } from "../../../src/keating/standard-site";
import { loadAtprotoBlogFeed } from "../../utils/atproto-blog";

let cachedShell: string | null = null;

const SHELL_CANDIDATES = [
	"./dist/index.html",
	"dist/index.html",
	"./.output/public/index.html",
	"./public/index.html",
];

async function loadShell(): Promise<string | null> {
	if (cachedShell) return cachedShell;
	for (const path of SHELL_CANDIDATES) {
		try {
			cachedShell = await readFile(path, "utf8");
			return cachedShell;
		} catch {
			// Try the next production/dev shell location.
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

function setMeta(html: string, attr: "property" | "name", key: string, value: string): string {
	const escaped = escapeAttr(value);
	const pattern = new RegExp(
		`(<meta\\s+${attr}=["']${key}["']\\s+content=["'])[^"']*(["']\\s*/?>)`,
		"i",
	);
	if (pattern.test(html)) return html.replace(pattern, `$1${escaped}$2`);
	return html.replace(/<\/head>/i, `  <meta ${attr}="${key}" content="${escaped}">\n</head>`);
}

function setLink(html: string, rel: string, href: string): string {
	const escaped = escapeAttr(href);
	const pattern = new RegExp(`(<link\\s+rel=["']${rel}["']\\s+href=["'])[^"']*(["'][^>]*>)`, "i");
	if (pattern.test(html)) return html.replace(pattern, `$1${escaped}$2`);
	return html.replace(/<\/head>/i, `  <link rel="${rel}" href="${escaped}">\n</head>`);
}

export function injectBlogDocumentMeta(html: string, origin: string, post: AtprotoBlogPost): string {
	const canonical = `${origin}${post.path}`;
	const title = `${post.title} · Keating`;
	let next = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeAttr(title)}</title>`);
	next = setLink(next, "canonical", canonical);
	next = setLink(next, "site.standard.document", post.uri);
	next = setMeta(next, "name", "description", post.description);
	next = setMeta(next, "property", "og:type", "article");
	next = setMeta(next, "property", "og:title", title);
	next = setMeta(next, "property", "og:description", post.description);
	next = setMeta(next, "property", "og:url", canonical);
	next = setMeta(next, "property", "article:published_time", post.publishedAt);
	next = setMeta(next, "name", "twitter:title", title);
	next = setMeta(next, "name", "twitter:description", post.description);
	if (post.coverImageUrl) {
		next = setMeta(next, "property", "og:image", post.coverImageUrl);
		next = setMeta(next, "name", "twitter:image", post.coverImageUrl);
	}
	return next;
}

export default defineEventHandler(async (event) => {
	const shell = await loadShell();
	if (!shell) return;

	const url = getRequestURL(event);
	const slug = decodeURIComponent(url.pathname.replace(/^\/blog\/?/, "").split("/")[0] ?? "");
	let html = shell;
	try {
		const feed = await loadAtprotoBlogFeed();
		if (slug) {
			const post = feed.posts.find((entry) => entry.slug === slug);
			if (post) html = injectBlogDocumentMeta(html, url.origin, post);
		} else {
			const title = `${feed.publication.name} · Keating`;
			html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeAttr(title)}</title>`);
			html = setLink(html, "canonical", `${url.origin}/blog`);
			html = setMeta(html, "name", "description", feed.publication.description ?? "Writing from Keating.");
		}
	} catch {
		// The SPA renders a truthful retry/error state. Serving the shell keeps the
		// blog reachable while its PDS is unconfigured or temporarily unavailable.
	}

	setResponseHeader(event, "Content-Type", "text/html; charset=utf-8");
	return html;
});

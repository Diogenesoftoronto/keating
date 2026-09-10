// Legacy pages redirect to the standalone blog. Retain the metadata helper for
// existing reader consumers while Standard.site document paths stay unchanged.
import { defineEventHandler, getRequestURL, sendRedirect, setResponseHeader } from "h3";
import type { AtprotoBlogPost } from "../../../src/keating/standard-site";
import { BLOG_URL, legacyBlogHref } from "../../../src/lib/blog-links";

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

export default defineEventHandler((event) => {
	const url = getRequestURL(event);
	setResponseHeader(event, "Cache-Control", "no-store");
	return sendRedirect(event, legacyBlogHref(`${url.pathname}${url.search}`) ?? BLOG_URL, 308);
});

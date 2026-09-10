export const BLOG_URL = "https://blog.keating.help/";
export const BLOG_PUBLICATION_URL = `${BLOG_URL}.well-known/site.standard.publication`;

/** Keep Standard.site document paths and bookmark queries/fragments intact. */
export function legacyBlogHref(href: string): string | null {
	if (!href.startsWith("/") || href.startsWith("//") || /[\\\r\n]/.test(href)) return null;
	const url = new URL(href, BLOG_URL);
	if (url.pathname !== "/blog" && !url.pathname.startsWith("/blog/")) return null;
	if (url.pathname === "/blog" || url.pathname === "/blog/") url.pathname = "/";
	return url.href;
}

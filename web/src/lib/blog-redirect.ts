import { redirect } from "@tanstack/react-router";
import { BLOG_URL, legacyBlogHref } from "./blog-links";

export function blogRedirectBeforeLoad({ location, preload }: { location: { href: string }; preload: boolean }): void {
	if (preload) return;
	throw redirect({
		href: legacyBlogHref(location.href) ?? BLOG_URL,
		reloadDocument: true,
		replace: true,
	});
}

import { desktopMarketingUrl as nativeMarketingUrl } from "../../../desktop/src/navigation";
import { legacyTutorialHref } from "./tutorial-links";
import { BLOG_URL, legacyBlogHref } from "./blog-links";

/** Documentation and the blog open in the system browser with website pages. */
export function desktopMarketingUrl(path: string): string | null {
	const tutorial = legacyTutorialHref(path);
	if (tutorial) return tutorial;
	const blog = legacyBlogHref(path);
	if (blog) return blog;
	try {
		const url = new URL(path);
		if (!url.username && !url.password && ["https://docs.keating.help", "https://dev.keating.help", new URL(BLOG_URL).origin].includes(url.origin)) {
			return url.href;
		}
	} catch {
		// Relative workspace and website paths use the shared native policy.
	}
	return nativeMarketingUrl(path);
}

export function isDesktopShell(): boolean {
	return typeof window !== "undefined" && "keatingDesktop" in window;
}

import { afterEach, describe, expect, it } from "bun:test";
import { AppLink } from "../components/AppLink";
import { desktopMarketingUrl } from "../lib/desktop-navigation";
import { DOCUMENTATION_URL, tutorialApiKeyHref } from "../lib/tutorial-links";
import { BLOG_URL } from "../lib/blog-links";

const originalWindow = globalThis.window;
afterEach(() => { globalThis.window = originalWindow; });

describe("desktop documentation navigation", () => {
	it.each([DOCUMENTATION_URL, tutorialApiKeyHref("google"), "https://dev.keating.help/data-and-privacy/#training-archives-preserve-provenance"])("opens AppLink %s outside the desktop workspace", (href) => {
		globalThis.window = { keatingDesktop: {} } as Window & typeof globalThis;
		const link = AppLink({ to: href });
		expect(link.props.to).toBe(href);
		expect(link.props.target).toBe("_blank");
		expect(link.props.rel).toBe("noopener noreferrer");
	});
	it("maps legacy desktop links before AppLink opens the browser", () => {
		globalThis.window = { keatingDesktop: {} } as Window & typeof globalThis;
		const link = AppLink({ to: "/tutorial?tab=cloud#google-api-key" });
		expect(link.props.to).toBe(tutorialApiKeyHref("google"));
		expect(link.props.target).toBe("_blank");
	});
	it("preserves the web link's requested target", () => {
		globalThis.window = {} as Window & typeof globalThis;
		const link = AppLink({ to: DOCUMENTATION_URL, target: "_self" });
		expect(link.props.to).toBe(DOCUMENTATION_URL);
		expect(link.props.target).toBe("_self");
	});
	it.each(["/chat", "/courses", "/review", "/live", "/tutorial/review-workspace.avif"])("keeps local workspace or asset path %s local", (path) => {
		expect(desktopMarketingUrl(path)).toBeNull();
	});
	it("retains the native marketing-page policy", () => {
		expect(desktopMarketingUrl("/download")).toBe("https://keating.help/download");
	});
	it.each(["//evil.test/tutorial", "https://docs.keating.help.evil.test/", "https://user@docs.keating.help/", "javascript:alert(1)"])("does not classify %s as documentation", (href) => {
		expect(desktopMarketingUrl(href)).toBeNull();
	});
});

describe("desktop blog navigation", () => {
	it.each([
		[BLOG_URL, BLOG_URL],
		[`${BLOG_URL}blog/first-post#practice`, `${BLOG_URL}blog/first-post#practice`],
		["/blog", BLOG_URL],
		["/blog/first-post?utm_source=app#practice", `${BLOG_URL}blog/first-post?utm_source=app#practice`],
	])("opens %s in the system browser", (href, destination) => {
		globalThis.window = { keatingDesktop: {} } as Window & typeof globalThis;
		const link = AppLink({ to: href });
		expect(link.props.to).toBe(destination);
		expect(link.props.target).toBe("_blank");
		expect(link.props.rel).toBe("noopener noreferrer");
	});
	it.each(["https://blog.keating.help.evil.test/", "https://user@blog.keating.help/", "http://blog.keating.help/"])("does not classify %s as the standalone blog", (href) => {
		expect(desktopMarketingUrl(href)).toBeNull();
	});
});

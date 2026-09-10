import { describe, expect, it } from "bun:test";
import { H3 } from "h3";
import { createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import config from "../../nitro.config";
import blog from "../../server/routes/blog/[...path]";
import publication from "../../server/routes/well-known/site-standard-publication";
import { BLOG_PUBLICATION_URL, BLOG_URL, legacyBlogHref } from "../lib/blog-links";
import { blogRedirectBeforeLoad } from "../lib/blog-redirect";

const app = new H3();
for (const route of config.handlers ?? []) {
	if (!route.route) continue;
	if (route.handler === "server/routes/blog/[...path].ts") app.all(route.route, blog);
	if (route.handler === "server/routes/well-known/site-standard-publication.ts") app.all(route.route, publication);
}
app.all("/**", () => new Response("<!DOCTYPE html><title>Keating</title>"));

describe("standalone blog destinations", () => {
	it.each([
		["/blog", BLOG_URL],
		["/blog/", BLOG_URL],
		["/blog?tag=learning#posts", `${BLOG_URL}?tag=learning#posts`],
		["/blog/first-post", `${BLOG_URL}blog/first-post`],
		["/blog/first-post/?utm_source=share#practice", `${BLOG_URL}blog/first-post/?utm_source=share#practice`],
		["/blog/%66irst-post", `${BLOG_URL}blog/%66irst-post`],
	])("preserves the destination of %s", (href, destination) => {
		expect(legacyBlogHref(href)).toBe(destination);
	});
	it.each(["/chat", "/blogger", "//evil.test/blog", "/\\evil.test/blog", "https://evil.test/blog", "/blog/../../chat"])("does not rewrite unrelated or unsafe paths: %s", (href) => {
		expect(legacyBlogHref(href)).toBeNull();
	});
});

describe("legacy blog HTTP redirects", () => {
	it.each([
		["/blog", BLOG_URL],
		["/blog/", BLOG_URL],
		["/blog?tag=learning", `${BLOG_URL}?tag=learning`],
		["/blog/first-post", `${BLOG_URL}blog/first-post`],
		["/blog/first-post/?utm_source=share", `${BLOG_URL}blog/first-post/?utm_source=share`],
		["/.well-known/site.standard.publication", BLOG_PUBLICATION_URL],
	])("returns HTTP 308 for %s without loading a feed or SPA shell", async (path, destination) => {
		const response = await app.request(`https://keating.test${path}`);
		expect(response.status).toBe(308);
		expect(response.headers.get("location")).toBe(destination);
		expect(response.headers.get("cache-control")).toBe("no-store");
	});
	it.each(["/blog", "/blog/first-post", "/.well-known/site.standard.publication"])("supports HEAD for %s", async (path) => {
		const response = await app.request(`https://keating.test${path}`, { method: "HEAD" });
		expect(response.status).toBe(308);
		expect(response.headers.get("location")).toStartWith(BLOG_URL);
	});
	it("retains read-only publication discovery", async () => {
		const response = await app.request("https://keating.test/.well-known/site.standard.publication", { method: "POST" });
		expect(response.status).toBe(405);
	});
	it("does not redirect the rest of the app", async () => {
		const response = await app.request("https://keating.test/chat");
		expect(response.status).toBe(200);
		expect(response.headers.get("location")).toBeNull();
	});
});

describe("legacy blog SPA redirects", () => {
	it.each([
		["/blog", BLOG_URL],
		["/blog/", BLOG_URL],
		["/blog?tag=learning#posts", `${BLOG_URL}?tag=learning#posts`],
		["/blog/first-post?utm_source=share#practice", `${BLOG_URL}blog/first-post?utm_source=share#practice`],
	])("replaces the document for %s and preserves bookmark details", async (href, destination) => {
		const root = createRootRoute();
		const index = createRoute({ getParentRoute: () => root, path: "/blog", beforeLoad: blogRedirectBeforeLoad });
		const post = createRoute({ getParentRoute: () => root, path: "/blog/$slug", beforeLoad: blogRedirectBeforeLoad });
		const router = createRouter({ routeTree: root.addChildren([index, post]), history: createMemoryHistory({ initialEntries: [href] }), isServer: true });
		await router.load();
		// Follow TanStack's initial trailing-slash canonicalization in server mode.
		if (router.state.redirect?.options.href === "/blog") {
			router.history.replace("/blog");
			await router.load();
		}
		expect(router.state.redirect?.options).toMatchObject({ href: destination, reloadDocument: true, replace: true });
	});
	it("does not leave the app on preload", () => {
		expect(() => blogRedirectBeforeLoad({ location: { href: "/blog/first-post" }, preload: true })).not.toThrow();
	});
});

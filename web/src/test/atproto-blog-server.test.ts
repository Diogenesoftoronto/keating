import { describe, expect, it } from "bun:test";
import {
	loadAtprotoBlogFeed,
	readAtprotoBlogConfig,
	resolveAtprotoBlogSource,
} from "../../server/utils/atproto-blog";
import { injectBlogDocumentMeta } from "../../server/routes/blog/[...path]";

function json(value: unknown): Response {
	return Response.json(value);
}

describe("AT Protocol blog source", () => {
	it("requires an explicit blog account", () => {
		expect(() => readAtprotoBlogConfig({})).toThrow("not configured");
	});

	it("resolves a handle through its DID document to the current PDS", async () => {
		const requests: string[] = [];
		const fetcher = (async (input: string | URL | Request) => {
			const url = String(input);
			requests.push(url);
			if (url.startsWith("https://resolver.test/xrpc/")) return json({ did: "did:plc:keating" });
			if (url === "https://plc.test/did%3Aplc%3Akeating") {
				return json({
					id: "did:plc:keating",
					service: [{
						id: "did:plc:keating#atproto_pds",
						type: "AtprotoPersonalDataServer",
						serviceEndpoint: "https://tranquil.test",
					}],
				});
			}
			return new Response("missing", { status: 404 });
		}) as typeof fetch;
		const config = readAtprotoBlogConfig({
			KEATING_BLOG_ATPROTO_REPO: "blog.keating.help",
			KEATING_BLOG_HANDLE_RESOLVER: "https://resolver.test",
			KEATING_BLOG_PLC_DIRECTORY: "https://plc.test",
		});

		expect(await resolveAtprotoBlogSource(config, fetcher)).toEqual({
			did: "did:plc:keating",
			pds: "https://tranquil.test",
		});
		expect(requests).toHaveLength(2);
	});

	it("loads only documents belonging to the Keating publication", async () => {
		const fetcher = (async (input: string | URL | Request) => {
			const url = new URL(String(input));
			const collection = url.searchParams.get("collection");
			if (collection === "site.standard.publication") {
				return json({ records: [{
					uri: "at://did:plc:keating/site.standard.publication/self",
					cid: "bafy-publication",
					value: {
						$type: "site.standard.publication",
						url: "https://keating.help",
						name: "Keating Updates",
					},
				}] });
			}
			if (collection === "site.standard.document") {
				return json({ records: [
					{
						uri: "at://did:plc:keating/site.standard.document/first-post",
						cid: "bafy-post",
						value: {
							$type: "site.standard.document",
							site: "at://did:plc:keating/site.standard.publication/self",
							path: "/blog/first-post",
							title: "First post",
							publishedAt: "2026-08-03T12:00:00.000Z",
							tags: ["release"],
							textContent: "Body",
						},
					},
					{
						uri: "at://did:plc:keating/site.standard.document/private-note",
						cid: "bafy-note",
						value: {
							$type: "site.standard.document",
							site: "https://notes.example",
							path: "/blog/private-note",
							title: "Unrelated",
							publishedAt: "2026-08-03T12:00:00.000Z",
						},
					},
				] });
			}
			return new Response("missing", { status: 404 });
		}) as typeof fetch;
		const config = readAtprotoBlogConfig({
			KEATING_BLOG_ATPROTO_REPO: "did:plc:keating",
			KEATING_BLOG_PDS_URL: "https://tranquil.test",
		});

		const feed = await loadAtprotoBlogFeed(config, fetcher, 0);
		expect(feed.publication.uri).toBe("at://did:plc:keating/site.standard.publication/self");
		expect(feed.posts.map((post) => post.slug)).toEqual(["first-post"]);
		expect(feed.source.pds).toBe("https://tranquil.test");
	});

	it("places the document AT-URI in the server-rendered article head", () => {
		const html = '<html><head><title>Keating</title><link rel="canonical" href="https://keating.help/"><meta name="description" content="old"></head><body></body></html>';
		const rendered = injectBlogDocumentMeta(html, "https://keating.help", {
			uri: "at://did:plc:keating/site.standard.document/first-post",
			cid: "bafy-post",
			rkey: "first-post",
			slug: "first-post",
			path: "/blog/first-post",
			title: "First post",
			description: "The first post.",
			publishedAt: "2026-08-03T12:00:00.000Z",
			tags: [],
			body: "Body",
			bodyFormat: "plaintext",
		});

		expect(rendered).toContain('<link rel="site.standard.document" href="at://did:plc:keating/site.standard.document/first-post">');
		expect(rendered).toContain('<link rel="canonical" href="https://keating.help/blog/first-post">');
		expect(rendered).toContain('<meta property="og:type" content="article">');
	});
});

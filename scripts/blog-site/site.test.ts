import { describe, expect, it } from "bun:test";
import { createBlogHandler } from "./server";
import { contentUrl } from "./render";
import { AtprotoBlogError, loadAtprotoBlogFeed, readAtprotoBlogConfig } from "../../web/server/utils/atproto-blog";
import type { AtprotoBlogFeed } from "../../web/src/keating/standard-site";

// Protocol fixtures belong only in tests. Production always reads the PDS.
const publicationUri = "at://did:plc:test/site.standard.publication/self";
const feed: AtprotoBlogFeed = {
  publication: { uri: publicationUri, name: "Keating Blog", url: "https://blog.keating.help", description: "Field notes." },
  source: { did: "did:plc:test", repo: "blog.test", pds: "https://pds.test" },
  posts: [{ uri: "at://did:plc:test/site.standard.document/first-post", cid: "test-cid", rkey: "first-post", slug: "first-post", path: "/blog/first-post", title: "First post", description: "A field note.", publishedAt: "2026-09-10T12:00:00.000Z", tags: ["engineering"], bodyFormat: "markdown", body: "## A heading\n\n**Real Markdown**\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n$x^2$\n\n[App](/chat)\n\n![Capture](/capture.png)\n\n[Bad](javascript:alert(1))\n\n<script>alert(1)</script>" }],
};
const handler = createBlogHandler({ loadFeed: async () => feed });
const request = (path: string, init?: RequestInit) => new Request(`https://blog.keating.help${path}`, init);

describe("standalone blog HTTP contract", () => {
  it("renders actual publication and article links without browser JavaScript", async () => {
    const response = await handler(request("/"));
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('href="/blog/first-post"');
    expect(html).toContain('rel="site.standard.publication" href="' + publicationUri);
    expect(html).toContain('rel="canonical" href="https://blog.keating.help/"');
    expect(html).toContain("Field notes.");
    expect(html).not.toContain("Loading posts");
  });

  it("emits document proof, canonical, GFM, math, and safe content HTML", async () => {
    const response = await handler(request("/blog/first-post"));
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('rel="site.standard.document" href="' + feed.posts[0].uri);
    expect(html).toContain('rel="canonical" href="https://blog.keating.help/blog/first-post"');
    expect(html).toContain("<strong>Real Markdown</strong>");
    expect(html).toContain("<table>");
    expect(html).toContain('class="katex"');
    expect(html).toContain('href="https://keating.help/chat"');
    expect(html).toContain('src="https://keating.help/capture.png"');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("keeps old record canonicals until the PDS publication URL changes", async () => {
    const old = { ...feed, publication: { ...feed.publication, url: "https://keating.help" } };
    const legacy = createBlogHandler({ loadFeed: async () => old });
    expect(await (await legacy(request("/blog/first-post"))).text()).toContain('rel="canonical" href="https://keating.help/blog/first-post"');
    expect(await (await legacy(request("/sitemap.xml"))).text()).not.toContain("<loc>");
    expect(await (await legacy(request("/.well-known/site.standard.publication"))).text()).toBe(publicationUri);
  });

  it("answers publication discovery with its exact durable AT-URI", async () => {
    const response = await handler(request("/.well-known/site.standard.publication"));
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toBe(publicationUri);
  });

  it("serves the same real feed and lists every published canonical in the sitemap", async () => {
    expect(await (await handler(request("/api/blog"))).json()).toEqual(feed);
    const sitemap = await (await handler(request("/sitemap.xml"))).text();
    expect(sitemap).toContain("<loc>https://blog.keating.help/blog/first-post</loc>");
  });

  it("searches and filters without a client bundle", async () => {
    expect(await (await handler(request("/?q=field&tag=engineering"))).text()).toContain('href="/blog/first-post"');
    expect(await (await handler(request("/?q=unmatched"))).text()).toContain("No matching posts");
    expect(await (await handler(request("/?tag=learning"))).text()).not.toContain('href="/blog/first-post"');
  });

  it("preserves query strings on legacy index and trailing slash redirects", async () => {
    for (const [from, to] of [["/blog?q=field", "/?q=field"], ["/blog/first-post/?x=1", "/blog/first-post?x=1"]]) {
      const response = await handler(request(from));
      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe(to);
    }
  });

  it("returns actual 404s for missing documents, arbitrary paths, and extra path segments", async () => {
    for (const path of ["/blog/missing", "/other", "/blog/first-post/extra", "/blog/%broken"]) {
      const response = await handler(request(path));
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("separates process health from unavailable upstream records without invented content", async () => {
    let calls = 0;
    const unavailable = createBlogHandler({ loadFeed: async () => { calls++; throw new AtprotoBlogError("Not configured", "not_configured"); } });
    expect((await unavailable(request("/healthz"))).status).toBe(200);
    expect(calls).toBe(0);
    for (const path of ["/", "/api/blog", "/.well-known/site.standard.publication"]) {
      const response = await unavailable(request(path));
      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("60");
      expect(await response.text()).not.toContain(publicationUri);
    }
  });

  it("supports HEAD and rejects writes", async () => {
    const head = await handler(request("/blog/first-post", { method: "HEAD" }));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const post = await handler(request("/api/blog", { method: "POST" }));
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
  });

  it("serves local assets while rejecting escaped asset paths", async () => {
    expect((await handler(request("/assets/site.css"))).status).toBe(200);
    for (const path of ["/assets/..%2Fserver.ts", "/assets/%2Fetc/passwd", "/assets/missing.css"]) expect((await handler(request(path))).status).toBe(404);
  });

  it("renders plaintext as plaintext and escapes record metadata", async () => {
    const altered: AtprotoBlogFeed = { ...feed, posts: [{ ...feed.posts[0], title: '<script>bad</script>', bodyFormat: "plaintext", body: "**literal**\n<script>bad</script>" }] };
    const plain = createBlogHandler({ loadFeed: async () => altered });
    const html = await (await plain(request("/blog/first-post"))).text();
    expect(html).toContain("**literal**");
    expect(html).not.toContain("<strong>literal</strong>");
    expect(html).not.toContain("<script>bad</script>");
  });

  it("keeps content article links local and rejects malformed content URLs", () => {
    expect(contentUrl("https://keating.help/blog/next#part", "href", feed.posts[0])).toBe("/blog/next#part");
    expect(contentUrl("#part", "href", feed.posts[0])).toBe("#part");
    expect(contentUrl("http://", "href", feed.posts[0])).toBe("");
  });

  it("uses the shared PDS reader for belonging, Markdown, and chronological ordering", async () => {
    const fetcher = (async (input: string | URL | Request) => {
      const collection = new URL(String(input)).searchParams.get("collection");
      if (collection === "site.standard.publication") return Response.json({ records: [{ uri: publicationUri, cid: "publication", value: { $type: collection, ...feed.publication } }] });
      return Response.json({ records: [{ uri: feed.posts[0].uri, cid: "document", value: { $type: "site.standard.document", site: publicationUri, path: "/blog/first-post", title: "From PDS", publishedAt: feed.posts[0].publishedAt, content: { $type: "at.markpub.markdown", text: { markdown: "**From PDS**" } } } }, { uri: "at://did:plc:test/site.standard.document/foreign", cid: "foreign", value: { $type: "site.standard.document", site: "at://did:plc:else/site.standard.publication/self", title: "Not this blog", publishedAt: feed.posts[0].publishedAt } }] });
    }) as typeof fetch;
    const config = readAtprotoBlogConfig({ KEATING_BLOG_ATPROTO_REPO: "did:plc:test", KEATING_BLOG_PDS_URL: "https://pds.test", KEATING_BLOG_PUBLICATION_URI: publicationUri });
    const fromPds = createBlogHandler({ loadFeed: () => loadAtprotoBlogFeed(config, fetcher) });
    const html = await (await fromPds(request("/blog/first-post"))).text();
    expect(html).toContain("<strong>From PDS</strong>");
    expect(html).not.toContain("Not this blog");
  });
});

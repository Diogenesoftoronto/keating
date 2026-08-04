import { describe, expect, it } from "bun:test";
import {
	MARKPUB_MARKDOWN_TYPE,
	atprotoRkey,
	blueskyPostUrl,
	documentBody,
	parseStandardSiteDocument,
	parseStandardSitePublication,
	plainTextFromMarkdown,
	stableBlogSlug,
	standardSiteSlug,
} from "../keating/standard-site";

describe("Standard.site records", () => {
	it("parses a publication and normalizes its base URL", () => {
		expect(parseStandardSitePublication({
			$type: "site.standard.publication",
			url: "https://keating.help/",
			name: "Keating Updates",
		})).toMatchObject({ url: "https://keating.help", name: "Keating Updates" });
	});

	it("extracts Markpub markdown before the plaintext fallback", () => {
		const record = parseStandardSiteDocument({
			$type: "site.standard.document",
			site: "at://did:plc:keating/site.standard.publication/self",
			path: "/blog/hello-atmosphere",
			title: "Hello, Atmosphere",
			publishedAt: "2026-08-03T12:00:00.000Z",
			textContent: "Plain fallback",
			content: {
				$type: MARKPUB_MARKDOWN_TYPE,
				text: { $type: "at.markpub.text", markdown: "# Rich body\n\nHello." },
			},
		});

		expect(record).not.toBeNull();
		expect(documentBody(record!)).toEqual({
			body: "# Rich body\n\nHello.",
			format: "markdown",
		});
	});

	it("rejects malformed records and paths outside Keating's blog", () => {
		expect(parseStandardSiteDocument({ title: "missing fields" })).toBeNull();
		expect(standardSiteSlug("/notes/not-a-blog-post", "record-key")).toBeNull();
		expect(standardSiteSlug("/blog/a/nested-path", "record-key")).toBeNull();
	});

	it("derives stable record keys and public Bluesky links", () => {
		expect(atprotoRkey("at://did:plc:abc/site.standard.document/hello-world")).toBe("hello-world");
		expect(stableBlogSlug("v2.10.0: AT Protocol & Keating")).toBe("v2-10-0-at-protocol-keating");
		expect(blueskyPostUrl("at://did:plc:abc/app.bsky.feed.post/3abc")).toBe(
			"https://bsky.app/profile/did%3Aplc%3Aabc/post/3abc",
		);
	});

	it("builds a useful plaintext representation from markdown", () => {
		expect(plainTextFromMarkdown("## Heading\n\nA **bold** [link](https://example.com)."))
			.toBe("Heading A bold link.");
	});
});

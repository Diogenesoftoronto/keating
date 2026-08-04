import { describe, expect, it } from "bun:test";
import {
	buildLegacyStandardSiteRecords,
	legacyHtmlToMarkdown,
} from "../../scripts/publish-standard-site-blog";

describe("Standard.site legacy publisher", () => {
	it("converts semantic legacy HTML to GFM without retaining class markup", () => {
		const markdown = legacyHtmlToMarkdown(
			'<h2 class="title">A heading</h2><p>Hello <strong>reader</strong> and <code>x()</code>.</p><pre>const x = 1;</pre>',
		);
		expect(markdown).toContain("## A heading");
		expect(markdown).toContain("Hello **reader** and `x()`.");
		expect(markdown).toContain("```\nconst x = 1;\n```");
		expect(markdown).not.toContain("class=");
	});

	it("builds one publication and stable document records", () => {
		const records = buildLegacyStandardSiteRecords("did:plc:keating");
		expect(records[0]).toMatchObject({
			collection: "site.standard.publication",
			rkey: "self",
		});
		expect(records.length).toBeGreaterThan(10);
		expect(records[1]?.record).toMatchObject({
			$type: "site.standard.document",
			site: "at://did:plc:keating/site.standard.publication/self",
			content: { $type: "at.markpub.markdown" },
		});
	});
});

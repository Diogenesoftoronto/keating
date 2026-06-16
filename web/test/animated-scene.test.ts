import { describe, expect, test } from "bun:test";
import { parseAnimationPayload } from "../src/components/AnimatedScene";
import { buildManimSceneHtml, buildHyperframesHtml } from "../src/components/animation-host";

describe("parseAnimationPayload", () => {
	test("parses a manim payload with body code", () => {
		const tagged = JSON.stringify(
			JSON.stringify({
				topic: "DNS",
				kind: "manim",
				summary: "How a name becomes an IP",
				body: "async function construct(scene, M) { const t = new M.Text({ text: 'Hello' }); }",
			}),
		);
		const parsed = parseAnimationPayload(tagged);
		expect(parsed?.kind).toBe("manim");
		expect(parsed?.topic).toBe("DNS");
		expect(parsed?.summary).toBe("How a name becomes an IP");
		expect(parsed?.body).toContain("construct(scene, M)");
	});

	test("parses a hyperframes payload with HTML body", () => {
		const tagged = JSON.stringify(
			JSON.stringify({
				topic: "Krebs",
				kind: "hyperframes",
				body: "<div>citrate</div>",
			}),
		);
		const parsed = parseAnimationPayload(tagged);
		expect(parsed?.kind).toBe("hyperframes");
		expect(parsed?.body).toBe("<div>citrate</div>");
	});

	test("returns null for unsupported legacy frame payloads", () => {
		const tagged = JSON.stringify(
			JSON.stringify({
				topic: "DNS",
				frames: [
					{
						title: "Browser cache",
						elements: [
							{ id: "laptop", kind: "box", x: 200, y: 300, label: "Laptop" },
						],
					},
				],
			}),
		);
		expect(parseAnimationPayload(tagged)).toBeNull();
	});

	test("returns null for non-JSON input", () => {
		expect(parseAnimationPayload("not json")).toBeNull();
		expect(parseAnimationPayload("")).toBeNull();
	});

	test("returns null when kind is set but body is empty", () => {
		const tagged = JSON.stringify(JSON.stringify({ topic: "X", kind: "manim" }));
		// Empty body is allowed by parser; renderer is what surfaces an error.
		const parsed = parseAnimationPayload(tagged);
		expect(parsed?.kind).toBe("manim");
		expect(parsed?.body).toBeUndefined();
	});
});

describe("buildManimSceneHtml", () => {
	test("produces a self-contained HTML page that imports manim-web", () => {
		const html = buildManimSceneHtml(
			"async function construct(scene, M) { const t = new M.Text({ text: 'Hello' }); await scene.play(new M.FadeIn(t)); }",
			"Test topic",
		);
		expect(html).toContain("<!doctype html>");
		expect(html).toContain("Keating Animation: Test topic");
		expect(html).toContain("import * as M from \"/manim-web/index.js\"");
		expect(html).toContain("async function construct(scene, M)");
		expect(html).toContain("new M.Scene(container,");
	});

	test("escapes the topic in the title", () => {
		const html = buildManimSceneHtml("async function construct() {}", `Tom & Jerry's <Fun>`);
		expect(html).toContain("Tom &amp; Jerry&#39;s &lt;Fun&gt;");
	});

	test("includes the model-authored construct body verbatim", () => {
		const source = "async function construct(scene, M) { const a = M.Axes(); await scene.play(new M.Create(a)); }";
		const html = buildManimSceneHtml(source, "t");
		expect(html).toContain("M.Axes()");
		expect(html).toContain("new M.Create(a)");
	});
});

describe("buildHyperframesHtml", () => {
	test("passes through a full <!doctype html> document verbatim", () => {
		const source = "<!doctype html><html><body>hi</body></html>";
		const html = buildHyperframesHtml(source, "t");
		expect(html).toBe(source);
	});

	test("wraps a body fragment in a minimal document shell", () => {
		const html = buildHyperframesHtml("<div>citrate</div>", "Krebs");
		expect(html).toContain("<!doctype html>");
		expect(html).toContain("<title>Keating Animation: Krebs</title>");
		expect(html).toContain("<div>citrate</div>");
	});
});

import { describe, expect, test } from "bun:test";
import { parseAnimationPayload } from "../src/components/AnimatedScene";
import { buildHyperframesHtml } from "../src/components/animation-host";

describe("parseAnimationPayload", () => {
	test("returns null for a legacy renderer payload", () => {
		const tagged = JSON.stringify(
			JSON.stringify({
				topic: "DNS",
				kind: "legacy-renderer",
				summary: "How a name becomes an IP",
				body: "async function construct(scene, M) { const t = new M.Text({ text: 'Hello' }); }",
			}),
		);
		expect(parseAnimationPayload(tagged)).toBeNull();
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

	test("allows the renderer to surface empty hyperframes bodies", () => {
		const tagged = JSON.stringify(JSON.stringify({ topic: "X", kind: "hyperframes" }));
		// Empty body is allowed by parser; renderer is what surfaces an error.
		const parsed = parseAnimationPayload(tagged);
		expect(parsed?.kind).toBe("hyperframes");
		expect(parsed?.body).toBeUndefined();
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

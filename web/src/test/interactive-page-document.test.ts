import { describe, expect, test } from "bun:test";
import { GRADIENT_DESCENT_EXPLORER, LEARNING_RATE_EXERCISE } from "../components/interactive/interactive-page-samples";
import { buildInteractivePageDocument, interactivePageCsp, type BuildInteractivePageInput } from "../keating/interactive-page/document";
import { INTERACTIVE_PAGE_AUTHORING_GUIDE } from "../keating/interactive-page/guide";
import { INTERACTIVE_PAGE_LIMITS } from "../keating/interactive-page/protocol";
import { fallbackThemeVariables } from "../keating/interactive-page/theme";

const context = { appearance: "light" as const, variables: fallbackThemeVariables("light"), reducedMotion: false };
const build = (overrides: Partial<BuildInteractivePageInput> = {}) => buildInteractivePageDocument({ html: "<p>Hello</p>", title: "Demo", channel: "abc123", context, ...overrides });
const documentOf = (overrides: Partial<BuildInteractivePageInput> = {}) => {
	const result = build(overrides);
	if (!result.ok) throw new Error(`expected a document, got ${result.reason}`);
	return result.document;
};
const count = (text: string, needle: string) => text.split(needle).length - 1;

describe("buildInteractivePageDocument", () => {
	test("the CSP meta tag is the first element, before any authored byte", () => {
		const doc = documentOf({ html: "<!doctype html><html><head><script>evil()</script></head><body>x</body></html>" });
		expect(doc.startsWith("<!doctype html><meta http-equiv=\"Content-Security-Policy\"")).toBe(true);
		expect(doc.indexOf("Content-Security-Policy")).toBeLessThan(doc.indexOf("evil()"));
	});

	test("the default CSP blocks all network and eval", () => {
		const csp = interactivePageCsp([]);
		expect(csp).toContain("default-src 'none'");
		expect(csp).toContain("connect-src 'none'");
		expect(csp).toContain("form-action 'none'");
		expect(csp).toContain("frame-src 'none'");
		expect(csp).not.toContain("unsafe-eval");
		expect(csp).not.toContain("https:");
	});

	test("order is CSP, base stylesheet, theme variables, bridge", () => {
		const doc = documentOf();
		const at = ["Content-Security-Policy", "id=\"keating-page-base\"", "id=\"keating-page-theme\"", "id=\"keating-page-bridge\""].map((marker) => doc.indexOf(marker));
		expect(at.every((index) => index > 0)).toBe(true);
		expect([...at].sort((a, b) => a - b)).toEqual(at);
	});

	test("the bridge is injected exactly once, even when the page names it", () => {
		const doc = documentOf({ html: "<p>keating-page-bridge window.keating</p>" });
		expect(count(doc, "<script id=\"keating-page-bridge\">")).toBe(1);
		expect(count(doc, "Object.defineProperty(window, \"keating\"")).toBe(1);
	});

	test("theme variables and reduced motion are written into the document", () => {
		const doc = documentOf({ context: { appearance: "dark", variables: { "--primary": "#4be388", "--bad name": "x" }, reducedMotion: true } });
		expect(doc).toContain(":root{color-scheme:dark;--primary:#4be388;}");
		expect(doc).not.toContain("--bad name");
		expect(doc).toContain("\"data-reduced-motion\",\"true\"");
	});

	test("theme values cannot break out of the style element", () => {
		const doc = documentOf({ context: { appearance: "light", variables: { "--primary": "red;}</style><script>alert(1)</script>" }, reducedMotion: false } });
		expect(doc).not.toContain("</style><script>alert(1)");
	});

	test("restored state is inlined without allowing a script breakout", () => {
		const doc = documentOf({ state: { note: "</script><script>alert(1)</script>" } });
		expect(doc).not.toContain("</script><script>alert(1)");
		expect(doc).toContain("\\u003c/script>");
	});

	test("the title is escaped", () => {
		expect(documentOf({ title: "<img src=x onerror=alert(1)>" })).toContain("<title>&#60;img src=x onerror=alert(1)&#62;</title>");
	});

	test("oversize input returns a typed rejection with sizes", () => {
		const result = build({ html: `<p>${"é".repeat(INTERACTIVE_PAGE_LIMITS.maxHtmlBytes / 2)}</p>` });
		expect(result).toMatchObject({ ok: false, reason: "oversize", limit: INTERACTIVE_PAGE_LIMITS.maxHtmlBytes });
		expect(!result.ok && result.bytes! > INTERACTIVE_PAGE_LIMITS.maxHtmlBytes).toBe(true);
	});

	test("a page exactly at the cap is accepted", () => {
		const shell = "<p></p>";
		expect(build({ html: shell + "a".repeat(INTERACTIVE_PAGE_LIMITS.maxHtmlBytes - shell.length) }).ok).toBe(true);
	});

	test("unusable input is rejected, not thrown", () => {
		expect(build({ html: 42 })).toMatchObject({ ok: false, reason: "invalid" });
		expect(build({ html: "a\u0000b" })).toMatchObject({ ok: false, reason: "invalid" });
		expect(build({ html: "   " })).toMatchObject({ ok: false, reason: "empty" });
		expect(build({ html: "<!doctype html><html><head></head><body> <!-- nothing --> </body></html>" })).toMatchObject({ ok: false, reason: "empty" });
		expect(build({ libraries: ["jquery"] })).toMatchObject({ ok: false, reason: "unknown-library" });
	});

	test("markup that would navigate the frame is rejected", () => {
		expect(build({ html: "<meta http-equiv='refresh' content='0;url=https://x.test/?s=1'>" })).toMatchObject({ ok: false, reason: "forbidden-markup" });
		expect(build({ html: "<base href='https://x.test/'><a href='p'>p</a>" })).toMatchObject({ ok: false, reason: "forbidden-markup" });
	});

	test("libraries add only their pinned URLs, with integrity on tags", () => {
		const doc = documentOf({ libraries: ["d3", "three", "d3"] });
		const csp = interactivePageCsp(["d3", "three"]);
		expect(csp).toContain("https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js");
		expect(csp).toContain("https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/");
		expect(csp).not.toMatch(/script-src[^;]*https:\/\/cdn\.jsdelivr\.net\/npm\/(;|\s)/);
		expect(count(doc, "d3.min.js\" integrity=\"sha384-")).toBe(1);
		expect(doc).toContain("<script type=\"importmap\">");
	});

	test("the sample pages pass the builder and stay well under the cap", () => {
		for (const sample of [GRADIENT_DESCENT_EXPLORER, LEARNING_RATE_EXERCISE]) {
			const result = build({ html: sample.html, title: sample.title });
			expect(result.ok).toBe(true);
			expect(result.ok && result.bytes < 32 * 1024).toBe(true);
			expect(sample.html).not.toMatch(/\d+vh\b/);
		}
	});

	test("the authoring guide covers theme, layout, bridge, accessibility, cap and libraries", () => {
		for (const needle of ["--primary", "--muted-foreground", "vh", "360px", "keating.share", "keating.setState", "keating.openLink", "aria-live", "reduced motion", "512 KB", "three", "katex", "d3"]) {
			expect(INTERACTIVE_PAGE_AUTHORING_GUIDE).toContain(needle);
		}
	});
});

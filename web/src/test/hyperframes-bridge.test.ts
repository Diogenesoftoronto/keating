import { describe, expect, test } from "bun:test";
import { withHyperframesBridge } from "../components/hyperframes-bridge";

const GSAP_SCRIPT = '<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>';

describe("withHyperframesBridge", () => {
	test("loads GSAP before inline scene scripts when the document omitted it", () => {
		const html = `<!doctype html><html><head></head><body><script>gsap.timeline();</script></body></html>`;
		const result = withHyperframesBridge(html);

		expect(result.match(/<script[^>]+gsap[^>]*><\/script>/gi)).toHaveLength(1);
		expect(result.indexOf(GSAP_SCRIPT)).toBeLessThan(result.indexOf("gsap.timeline"));
	});

	test("normalizes an authored GSAP tag instead of duplicating it", () => {
		const html = `<!doctype html><html><body><script>gsap.timeline();</script><script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script></body></html>`;
		const result = withHyperframesBridge(html);

		expect(result.match(/<script[^>]+gsap[^>]*><\/script>/gi)).toHaveLength(1);
		expect(result.indexOf(GSAP_SCRIPT)).toBeLessThan(result.indexOf("gsap.timeline"));
	});
});

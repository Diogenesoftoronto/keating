import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownBlock, normalizeLatexDelimiters } from "../components/MarkdownBlock";

describe("chat LaTeX rendering", () => {
	test("normalizes common model delimiters without changing source offsets or code", () => {
		const withCode = [
			String.raw`At step \(r\), keep \(g \approx 1\).`,
			"",
			String.raw`\[`,
			String.raw`h^{(r)} = g^{(r)} \odot h^{(r-1)}`,
			String.raw`\]`,
			"",
			"Keep code literal: `" + String.raw`\(not-math\)` + "`",
			"",
			"```text",
			String.raw`\[not-math\]`,
			"```",
		].join("\n");
		const normalized = normalizeLatexDelimiters(withCode);

		expect(normalized.length).toBe(withCode.length);
		expect(normalized).toContain("At step $$r$$, keep $$g \\approx 1$$.");
		expect(normalized).toContain("$$\nh^{(r)} = g^{(r)} \\odot h^{(r-1)}\n$$");
		expect(normalized).toContain("`" + String.raw`\(not-math\)` + "`");
		expect(normalized).toContain(String.raw`\[not-math\]`);
	});

	test("renders the delimiter style from the reported GPT response through KaTeX", () => {
		const content = String.raw`At recurrence step \(r\), use:

\[
h^{(r)} = g^{(r)} \odot h^{(r-1)} + (1-g^{(r)}) \odot o^{(r)}
\]`;
		const html = renderToStaticMarkup(<MarkdownBlock content={content} />);

		expect(html).toContain('class="katex"');
		expect(html).toContain('class="katex-display"');
		expect(html).not.toContain("At recurrence step (r)");
	});
});

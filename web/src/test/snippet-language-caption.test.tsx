import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SiCplusplus, SiPython } from "react-icons/si";
import { MarkdownBlock } from "../components/MarkdownBlock";

function fence(info: string, complete = true) {
	const lines = ["```" + info, "42"];
	if (complete) lines.push("```");
	return renderToStaticMarkup(<MarkdownBlock content={lines.join("\n")} streaming={!complete} />);
}

describe("Markdown snippet captions", () => {
	test("uses recognizable decorative marks for aliases and preserves punctuation in fence names", () => {
		const python = renderToStaticMarkup(<SiPython size={16} aria-hidden="true" focusable="false" />);
		const cpp = renderToStaticMarkup(<SiCplusplus size={16} aria-hidden="true" focusable="false" />);
		expect(fence("py")).toContain(python);
		expect(fence("Python")).toContain(python);
		expect(fence("c++ title=sample")).toContain(cpp + "<span>c++</span>");
	});

	test("unknown or missing fence names use the terminal glyph", () => {
		for (const label of ["unknown-assembly", "constructor", ""]) {
			const html = fence(label);
			expect(html).toContain('data-glyph="terminal"');
			expect(html).toContain(`<span>${label || "text"}</span>`);
		}
	});

	test("offers inline tools for completed systems fences", () => {
		for (const [label, environment] of [["sh", "Alpine Linux"], ["k8s", "Kubernetes"], ["nix", "Tvix"], ["wat", "WebAssembly"]] as const) {
			const html = fence(label);
			expect(html).toContain(environment);
			expect(html).toContain(">Run</");
			expect(html).not.toContain("Not runnable");
			expect(html).not.toContain("/labs/systems");
		}
		expect(fence("bash")).toContain("Trace commands");
		expect(fence("wat")).toContain("Call an exported function");
		expect(fence("yaml")).toContain("Not runnable");
		expect(fence("wasm", false)).not.toContain(">Run</");
		expect(fence("wasm", false)).not.toContain("Call an exported function");
	});
});

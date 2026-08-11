import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { KeatingOpenUIRenderer } from "../keating/openui/renderer";

const metadata = {
	id: "session-message-source",
	lifecycle: "resumable" as const,
	revision: 0,
};
const source = [
	'root = LearningSurface([question], "Bayes check", "", "resumable")',
	'question = Question([{ question: "What changes the posterior?", type: "choice", choices: ["Evidence", "Typography"], allowText: true }], "resumable", "Bayes", "Explain your choice.")',
].join("\n");

describe("completed browser OpenUI source cutover", () => {
	test("keeps unclosed source inert instead of mounting the legacy renderer", () => {
		const html = renderToStaticMarkup(
			<KeatingOpenUIRenderer program={source} source={source} metadata={metadata} sourceComplete={false} />,
		);
		expect(html).not.toContain("data-shared-openui-document");
		expect(html).toContain('data-openui-source-recovery="incomplete"');
		expect(html).toContain("What changes the posterior?");
		expect(html).not.toContain("Submit answers");
	});

	test("switches a closed valid fence to one canonical grouped interaction", () => {
		const html = renderToStaticMarkup(
			<KeatingOpenUIRenderer program={source} metadata={metadata} sourceComplete />,
		);
		expect(html).toContain('data-shared-openui-document="session-message-source"');
		expect(html).toContain("Explain your choice.");
		expect(html).toContain("What changes the posterior?");
		expect(html.match(/Submit answers/g)?.length).toBe(1);
		expect(html).not.toContain("canonical migration failed");
	});

	test("fails closed to inert recovery without mounting the legacy interaction", () => {
		const invalid = [
			'root = LearningSurface([question, missing], "Still readable")',
			'question = Question([{ question: "Keep my answer", type: "text" }])',
		].join("\n");
		const html = renderToStaticMarkup(
			<KeatingOpenUIRenderer program={invalid} metadata={metadata} sourceComplete />,
		);
		expect(html).not.toContain("data-shared-openui-document");
		expect(html).toContain('data-openui-source-recovery="rejected"');
		expect(html).toContain("could not be compiled safely");
		expect(html.match(/Keep my answer/g)?.length).toBe(1);
		expect(html).not.toContain("Submit answers");
	});

	test("never mounts authored animation HTML when a sibling is unsupported", () => {
		const unsafe = [
			'root = LearningSurface([animation, future], "Unsafe fallback")',
			'animation = LearningAnimation("Topic", "<script>globalThis.__executed = true</script>")',
			'future = FutureWidget({ value: "unknown" })',
		].join("\n");
		const html = renderToStaticMarkup(
			<KeatingOpenUIRenderer program={unsafe} source={unsafe} metadata={metadata} sourceComplete />,
		);
		expect(html).toContain('data-openui-source-recovery="rejected"');
		expect(html).not.toContain("<iframe");
		expect(html).not.toContain("<script>");
		expect(html).toContain("&lt;script&gt;");
	});
});

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup as render } from "react-dom/server";
import { MermaidRenderer } from "../MermaidRenderer";
import { LessonConceptMap, LessonExplanation, LessonImage } from "./LessonProse";

describe("lesson prose and figure frames", () => {
	test("a titled explanation is a prose frame; an untitled one is plain reply prose", () => {
		const titled = render(<LessonExplanation title="Why caching helps" markdown="A warm lookup **skips** the authority." />);
		expect(titled).toContain('data-lesson="prose"');
		expect(titled).toContain("lesson-frame");
		expect(titled).toContain("Why caching helps");
		expect(titled).toContain("Explanation");
		const plain = render(<LessonExplanation markdown="A warm lookup skips the authority." />);
		expect(plain).not.toContain("lesson-frame");
		expect(plain).toContain("A warm lookup skips the authority.");
	});

	test("a concept map frames an embedded Mermaid stage on the grid", () => {
		const html = render(<LessonConceptMap title="Resolution" source={"flowchart LR\nA-->B"} />);
		expect(html).toContain("Concept map");
		expect(html).toContain('data-mermaid-chrome="none"');
		expect(html).toContain("k-grid");
		expect(html).toContain("Rendering diagram");
		expect(html).not.toContain("specialist-frame");
	});

	test("Mermaid keeps its own frame unless a host asks for none", () => {
		expect(render(<MermaidRenderer content={"flowchart LR\nA-->B"} />)).toContain("specialist-frame");
		expect(render(<MermaidRenderer content={"flowchart LR\nA-->B"} chrome="none" />)).not.toContain("specialist-frame");
	});

	test("an image keeps its alt text while loading and after a failure, with a retry", () => {
		const loading = render(<LessonImage src="/a.png" alt="Three boxes joined by arrows" title="Lookup path" caption="Only a miss reaches the authority." />);
		expect(loading).toContain('alt="Three boxes joined by arrows"');
		expect(loading).toContain("Loading the image");
		expect(loading).toContain("Only a miss reaches the authority.");
		const failed = render(<LessonImage status="failed" src="/a.png" alt="Three boxes joined by arrows" title="Lookup path" />);
		expect(failed).toContain("Three boxes joined by arrows");
		expect(failed).toContain("Load failed");
		expect(failed).toContain('data-tone="bad"');
		expect(failed).toContain("Retry");
		expect(failed).not.toContain("<img");
	});
});

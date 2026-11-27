import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { KeatingOpenUIRenderer } from "../keating/openui/renderer";

const metadata = { id: "concept-proposal-path", lifecycle: "workspace" as const, revision: 0 };
const plan = (surfaceTitle: string, overview: string) => [
	`root = LearningSurface([proposalPlan], ${JSON.stringify(surfaceTitle)}, "A short path from the early sketch to a clear proposal.", "workspace")`,
	`proposalPlan = StudyPlan("concept-proposal-path", "Developing the concept proposal", [`,
	`{ id: "audience", title: "Define the reader and the ask", estimatedMinutes: 15 },`,
	`{ id: "thesis", title: "State the concept in a few sentences", dependsOn: ["audience"], estimatedMinutes: 20 }`,
	`], "workspace", ${JSON.stringify(overview)})`,
].join("\n");
const count = (html: string, text: string) => html.split(text).length - 1;

describe("a surface that only holds a study plan", () => {
	test("shows the plan's title once, in the plan frame", () => {
		const html = renderToStaticMarkup(<KeatingOpenUIRenderer program={plan("Developing the concept proposal", "Times are estimates.")} metadata={metadata} sourceComplete />);
		expect(count(html, "Developing the concept proposal")).toBe(1);
		expect(html).not.toContain("lesson-document__title");
		expect(html).toContain("lesson-frame");
		expect(html).toContain("Times are estimates.");
		expect(html).not.toContain("A short path from the early sketch");
	});

	test("keeps the surface description when the plan has no overview of its own", () => {
		const html = renderToStaticMarkup(<KeatingOpenUIRenderer program={plan("Developing the concept proposal", "")} metadata={metadata} sourceComplete />);
		expect(count(html, "Developing the concept proposal")).toBe(1);
		expect(html).toContain("A short path from the early sketch");
	});

	test("keeps a surface title that says something the plan does not", () => {
		const html = renderToStaticMarkup(<KeatingOpenUIRenderer program={plan("Your next two weeks", "Times are estimates.")} metadata={metadata} sourceComplete />);
		expect(html).toContain("Your next two weeks");
		expect(html).toContain("Developing the concept proposal");
		expect(html).toContain("A short path from the early sketch");
	});
});

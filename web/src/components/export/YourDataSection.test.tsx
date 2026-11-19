import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { YourDataSection } from "./YourDataSection";

test("lists seven data transfers with their actions and accepted import format", () => {
	const html = renderToStaticMarkup(<YourDataSection/>);
	expect(html.match(/<li\b/g)).toHaveLength(7);
	for (const href of ["/review", "/training-data", "/chat?materials=1", "/coming-up", "/rooms"]) expect(html).toContain(`href="${href}"`);
	for (const text of ["Export", "Import", "Materials from your sessions", "Room transcripts", "People panel", "Markdown", "Matching sessions and records are replaced", "APKG · TSV", "MD · SVG · JSON", "accept=\".json,application/json\""]) expect(html).toContain(text);
});

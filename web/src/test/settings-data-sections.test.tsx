import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveDestination } from "../components/settings/groups";
import { dataEntries } from "../components/settings/search/data";
import { renderAsServer } from "./server-render-env";

renderAsServer();

for (const section of ["privacy", "your-data", "health", "developer"]) {
	test(section + " mounts its own data rows and exposes the search focus targets", () => {
		const destination = resolveDestination("data." + section);
		expect(destination.section.id).toBe(section);
		const Pane = destination.section.component;
		const html = renderToStaticMarkup(<Pane/>);
		for (const entry of dataEntries.filter(row => row.section === section)) {
			expect(html).toContain('id="' + entry.id + '"');
		}
		if (section === "privacy") {
			expect(html).toContain('aria-label="Data destinations"');
			expect(html).toContain("Every public share requires a fresh checkbox");
			expect(html).not.toContain("Unpublish");
		}
		if (section === "developer") {
			expect(html).not.toContain('<details class="sd-fold" open');
		}
		expect(html.includes('aria-labelledby="health-heading"')).toBe(section === "health");
		expect(html.includes('id="export-data-title"')).toBe(section === "your-data");
	});
}

test("sharing and failed-extraction deep links reach privacy, and plain diagnostics reaches health", () => {
	for (const alias of ["app.ui-share", "app.ui-privacy", "models.extraction-privacy"]) {
		expect(resolveDestination(alias).section.id).toBe("privacy");
	}
	expect(resolveDestination("diagnostics").section.id).toBe("health");
});

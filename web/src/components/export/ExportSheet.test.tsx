import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ExportSheet } from "./ExportSheet";

const props = { open: true, title: "Export this review", included: "Two notes", format: "ZIP", destination: "Downloads", confirmLabel: "Download ZIP", onClose() {}, onConfirm() {} };

test("describes the file before confirmation and omits unused fields", () => {
	const html = renderToStaticMarkup(<ExportSheet {...props}/>);
	for (const text of ["Included", "Two notes", "Format", "Goes to", "Downloads", "Download ZIP", "Cancel"]) expect(html).toContain(text);
	expect(html).not.toContain("Not included");
});

test("shows exclusions, notes, errors and the disabled busy action", () => {
	const html = renderToStaticMarkup(<ExportSheet {...props} excluded="Keys" note="Save first" busy busyLabel="Packaging…" error="Packaging failed"/>);
	for (const text of ["Not included", "Keys", "Save first", 'role="alert"', "Packaging failed", "Packaging…", "disabled"]) expect(html).toContain(text);
	expect(html).not.toContain("Download ZIP");
	expect(html).toContain("rv-export-actions");
	expect(html).toMatch(/<button[^>]*disabled[^>]*><span>Cancel<\/span><\/button>/);
});

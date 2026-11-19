import { expect, test } from "bun:test";
import { renderToStaticMarkup as render } from "react-dom/server";
import { ConfirmDialog, SelectField, Switch } from "./settings-controls";
test("switch exposes its visible label and checked state", () => {
	const html = render(<Switch checked label="Contrast" onChange={() => {}} />);
	expect(html).toContain('role="switch"');
	expect(html).toContain('aria-checked="true"');
	expect(html).toContain("Contrast</label>");
	expect(html.match(/for="([^"]+)"/)?.[1]).toBe(
		html.match(/button id="([^"]+)"/)?.[1],
	);
});
test("select associates its visible label with the shared trigger", () => {
	const html = render(
		<SelectField
			id="theme"
			label="Theme"
			value="light"
			onValueChange={() => {}}
		>
			<option value="light">Paper</option>
		</SelectField>,
	);
	expect(html).toContain('for="theme"');
	expect(html).toContain('id="theme"');
	expect(html).toContain('role="combobox"');
});
test("confirmation names the loss and places the destructive choice last", () => {
	const html = render(
		<ConfirmDialog
			open
			title="Discard edits?"
			description="Your unsaved profile edits will be lost."
			cancelLabel="Keep editing"
			confirmLabel="Discard"
			onConfirm={() => {}}
			onCancel={() => {}}
		/>,
	);
	expect(html).toContain('role="alertdialog"');
	expect(html).toContain("Your unsaved profile edits will be lost.");
	expect(html.indexOf("Keep editing")).toBeLessThan(
		html.lastIndexOf("Discard"),
	);
});

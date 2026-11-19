import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { EvidenceCounts, activityGlyph } from "./progress";

test("answer counts include independent recall and transfer and keep reading separate", () => {
	const markup = renderToStaticMarkup(<EvidenceCounts evidence={{ exposure: 9, assisted: 3, independent: 2, recall: 4, transfer: 1 }} />);
	expect(markup).toContain("Without help <b>7</b>");
	expect(markup).toContain("With help <b>3</b>");
	expect(markup).toContain("<dt>Read</dt><dd>9</dd>");
	expect(markup).toContain("<dt>Recalled later</dt><dd>4</dd>");
});

test("the plan distinguishes completion, an open step, skips, dependencies and delayed recall", () => {
	expect((["done", "available", "skipped", "locked", "waiting"] as const).map(activityGlyph))
		.toEqual(["check", "chevr", "minus", "lock", "clock"]);
});

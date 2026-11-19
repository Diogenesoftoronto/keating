import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TrainingData } from "../../pages/TrainingData";
import { renderWithRouter } from "../../test/course-render";
import { DatasetFigures } from "./DatasetFigures";
import { TrainingDatasetShare } from "./TrainingDatasetShare";

test("starts on Shape with all four choices, preparation, overview and import available", async () => {
	const html = await renderWithRouter(<TrainingData/>);
	expect(html).toContain('aria-label="Dataset steps"');
	expect(html).toContain('aria-current="step"');
	expect(html).toContain("done ");
	expect(html).toContain("Dataset steps completed");
	for (const text of ["Choose your data", "Shape the dataset", "Score it", "Download or share", "Keep everything", "Refresh source data", "Dataset overview", "Choose JSONL files"]) expect(html).toContain(text);
	expect(html).toContain('href="/usage"');
	expect(html).toContain('aria-label="Retention preset"');
	expect(html).not.toContain('aria-label="Dataset settings"');
});

test("counts missing sources as zero and exposes each archive statistic as text", () => {
	const html = renderToStaticMarkup(<DatasetFigures records={7} examples={4} validation={2} counts={{ session: 5, artifact: 2 }}/>);
	for (const [label, value] of [["Conversation responses", 5], ["Teaching artifacts", 2], ["Sandbox records", 0]]) {
		expect(html).toContain(`${label} ${value}`);
	}
	for (const label of ["Records 7", "SFT examples 4", "Validation 2"]) expect(html).toContain(`aria-label="${label}"`);
});

test("expanding sharing exposes consent and the unredacted warning", () => {
	const props = { archive: null, redacted: false, recordCount: 7, onExpandedChange() {} };
	const closed = renderToStaticMarkup(<TrainingDatasetShare {...props} expanded={false}/>);
	const open = renderToStaticMarkup(<TrainingDatasetShare {...props} expanded/>);
	expect(closed).not.toContain("I have permission");
	expect(open).toContain("I have permission to share this data");
	expect(open).toContain("This dataset is unredacted.");
	expect(open).toContain("It includes 7 records");
});

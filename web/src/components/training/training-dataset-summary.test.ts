import { expect, test } from "bun:test";
import { parseTrainingDatasetSummary, trainingDatasetSummaryMetadata } from "./training-dataset-summary";

function record(index: number) {
	return { schemaVersion: 2, id: `record-${index}`, split: index % 2 ? "validation" : "train", task: "supervised-finetuning", source: { type: "session", kind: "conversation", topic: `Topic ${index}` }, messages: [{ role: "user", content: "PRIVATE PROMPT" }, { role: "assistant", content: "PRIVATE RESPONSE" }], prompt: [{ role: "user", content: "PRIVATE PROMPT" }], completion: "PRIVATE RESPONSE", quality: { status: "unscored", recommendedForSft: false, scored: false }, metrics: { promptCharacters: 14, completionCharacters: 16, messageCount: 2 } };
}

test("dataset summary aggregates all records without transmitting individual content", () => {
	const metadata = trainingDatasetSummaryMetadata({ canonicalJsonl: Array.from({ length: 35 }, (_, index) => JSON.stringify(record(index))).join("\n"), manifestJson: JSON.stringify({ format: "both", source: "all", redactionEnabled: true, minimumAssistantCharacters: 200, judgeScoringEnabled: false, warnings: ["PRIVATE WARNING"], counts: { canonicalRecords: 999 } }) });
	expect(metadata.recordCount).toBe(35);
	expect(metadata.splits.train).toBe(18);
	expect(metadata.splits.validation).toBe(17);
	expect(metadata.topics).toHaveLength(30);
	expect(metadata.omittedTopicCount).toBe(5);
	expect(metadata.unscored).toBe(35);
	expect(metadata.lengths.responseTotal).toBe(35 * 16);
	expect(JSON.stringify(metadata)).not.toContain("PRIVATE");
	expect(JSON.stringify(metadata)).not.toContain("record-0");
});

test("empty dataset has finite zero lengths", () => {
	const metadata = trainingDatasetSummaryMetadata({ canonicalJsonl: "", manifestJson: "{}" });
	expect(metadata.recordCount).toBe(0);
	expect(metadata.lengths.responseMinimum).toBe(0);
	expect(metadata.lengths.responseMean).toBe(0);
});

test("dataset summary rejects empty and oversized model responses", () => {
	expect(parseTrainingDatasetSummary("  Dataset description  ")).toBe("Dataset description");
	expect(() => parseTrainingDatasetSummary(" ")).toThrow();
	expect(() => parseTrainingDatasetSummary("x".repeat(12001))).toThrow();
});

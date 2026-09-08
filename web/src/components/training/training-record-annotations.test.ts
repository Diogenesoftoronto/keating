import { describe, expect, test } from "bun:test";
import { parseTrainingAnnotations, parseTrainingSummary, trainingContentFingerprint } from "./training-record-annotations";

describe("training record annotations", () => {
	test("accepts bounded summary text and rejects empty or oversized results", () => {
		expect(parseTrainingSummary("  The learner asks about fractions.  ")).toBe("The learner asks about fractions.");
		expect(() => parseTrainingSummary(" \n ")).toThrow();
		expect(() => parseTrainingSummary("x".repeat(6001))).toThrow();
	});
	test("accepts anchored notes and retains alternatives as drafts", () => {
		expect(parseTrainingAnnotations('```json\n[{"quote":"Try recalling","note":"Good retrieval cue","suggestedAlternative":"Recall the rule first"}]\n```', "Try recalling the rule.")).toEqual([{ quote: "Try recalling", note: "Good retrieval cue", suggestedAlternative: "Recall the rule first" }]);
	});
	test("rejects the entire result when any quote is fabricated", () => {
		expect(() => parseTrainingAnnotations('[{"quote":"Real","note":"ok"},{"quote":"invented","note":"bad"}]', "Real response")).toThrow("absent");
	});
	test("rejects empty anchors and invalid alternatives", () => {
		expect(() => parseTrainingAnnotations('[{"quote":"","note":"ok"}]', "response")).toThrow();
		expect(() => parseTrainingAnnotations('[{"quote":"response","note":"ok","suggestedAlternative":42}]', "response")).toThrow();
	});
	test("supports a completed review with no issues", () => {
		expect(parseTrainingAnnotations("[]", "response")).toEqual([]);
	});
	test("fingerprint changes with prompt or completion", async () => {
		const initial = await trainingContentFingerprint([{ role: "user", content: "Question" }], "Answer");
		expect(initial).toBe(await trainingContentFingerprint([{ role: "user", content: "Question" }], "Answer"));
		expect(initial).not.toBe(await trainingContentFingerprint([{ role: "user", content: "Other" }], "Answer"));
		expect(initial).not.toBe(await trainingContentFingerprint([{ role: "user", content: "Question" }], "Changed"));
	});
});

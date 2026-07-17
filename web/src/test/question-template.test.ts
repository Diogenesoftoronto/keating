import { describe, expect, it } from "bun:test";
import { parseQuestionTemplate } from "../components/question-template";

describe("parseQuestionTemplate", () => {
	it("numbers underscore and named blanks in reading order", () => {
		expect(parseQuestionTemplate("A ___ then {{blank}} end")).toEqual([
			{ text: "A ", isBlank: false, index: -1 },
			{ text: "___", isBlank: true, index: 0 },
			{ text: " then ", isBlank: false, index: -1 },
			{ text: "{{blank}}", isBlank: true, index: 1 },
			{ text: " end", isBlank: false, index: -1 },
		]);
	});

	it("preserves a template without blanks as one text part", () => {
		expect(parseQuestionTemplate("Explain the idea")).toEqual([
			{ text: "Explain the idea", isBlank: false, index: -1 },
		]);
	});
});

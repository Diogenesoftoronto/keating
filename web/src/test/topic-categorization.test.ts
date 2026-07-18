import { describe, expect, it } from "bun:test";
import {
	parseTopicAssignments,
	stripCodeFences,
} from "../keating/topic-categorization";
import { parseTailoredOpening } from "../keating/tailored-opening";
import { categorizeUsageTopic } from "../components/usage-topic-groups";
import { latestUserText } from "../keating/topic-shift-hook";

describe("topic categorization", () => {
	it("strips code fences from model responses", () => {
		expect(stripCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
		expect(stripCodeFences('{"a":1}')).toBe('{"a":1}');
	});

	it("keeps only requested topics with valid category keys", () => {
		const response = JSON.stringify({
			"linear algebra": "math",
			"jazz history": "music",
			"unrequested topic": "math",
			"bad key topic": "not-a-category",
		});
		const assignments = parseTopicAssignments(response, ["Linear Algebra", "jazz history", "bad key topic"]);
		expect(assignments).toEqual({ "linear algebra": "math", "jazz history": "music" });
	});

	it("returns empty assignments for malformed responses", () => {
		expect(parseTopicAssignments("not json", ["a"])).toEqual({});
	});

	it("prefers model-authored assignments over keyword matching", () => {
		// Keyword scan would place "wave functions" in physics; the model said music.
		expect(categorizeUsageTopic("wave functions", { "wave functions": "music" }).key).toBe("music");
		expect(categorizeUsageTopic("wave functions").key).toBe("physics");
		// Invalid assigned keys fall back to the keyword scan.
		expect(categorizeUsageTopic("wave functions", { "wave functions": "nope" }).key).toBe("physics");
	});
});

describe("tailored opening parsing", () => {
	it("parses a valid opening and clamps labels", () => {
		const opening = parseTailoredOpening(JSON.stringify({
			greeting: "Welcome back — ready for more calculus?",
			suggestions: [
				{ label: "Assess", text: "Quiz me on derivatives" },
				{ label: "Bogus", text: "Review the chain rule" },
			],
		}));
		expect(opening?.greeting).toBe("Welcome back — ready for more calculus?");
		expect(opening?.prompts.map((p) => p.label)).toEqual(["Assess", "Learn"]);
	});

	it("returns null when the response is unusable", () => {
		expect(parseTailoredOpening("nope")).toBeNull();
		expect(parseTailoredOpening("{}")).toBeNull();
	});
});

describe("topic shift helpers", () => {
	it("extracts the latest user message text", () => {
		const messages = [
			{ role: "user", content: "first question" },
			{ role: "assistant", content: "answer" },
			{ role: "user", content: [{ type: "text", text: "second question" }] },
			{ role: "assistant", content: "answer" },
		];
		expect(latestUserText(messages)).toBe("second question");
	});
});

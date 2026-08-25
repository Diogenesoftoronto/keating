import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
	ReviewPassParseError,
	anchorQuote,
	buildCritiqueSweepPrompt,
	buildPatternDigestPrompt,
	extractPassJson,
	parseAnnotationExpansion,
	parseCritiqueSweep,
	parsePatternDigest,
	parseRubricSweep,
} from "../keating/trajectory-passes";
import { createReviewRecord } from "../keating/trajectory-review";

const TUTOR_LINE = "The answer is 9.8 m/s squared.\nJust memorize that constant and move on.";

function turn(id: string, role: "assistant" | "user", text: string): AgentMessage {
	return { id, role, timestamp: 1, content: [{ type: "text", text }] } as unknown as AgentMessage;
}

const TRAJECTORY: AgentMessage[] = [
	turn("m1", "user", "Why do things fall at the same rate?"),
	turn("m2", "assistant", TUTOR_LINE),
];

describe("extractPassJson", () => {
	it("reads a bare JSON document", () => {
		expect(extractPassJson('{"a":1}')).toEqual({ a: 1 });
	});

	it("reads JSON out of a code fence with surrounding prose", () => {
		const raw = 'Here is the review:\n```json\n{"findings":[]}\n```\nHope that helps.';
		expect(extractPassJson(raw)).toEqual({ findings: [] });
	});

	it("reads JSON that is merely prefixed with prose", () => {
		expect(extractPassJson('Sure thing! {"verdict":"review"}')).toEqual({ verdict: "review" });
	});

	it("throws a typed error when there is no JSON at all", () => {
		expect(() => extractPassJson("I cannot help with that.")).toThrow(ReviewPassParseError);
	});
});

describe("anchorQuote", () => {
	it("anchors an exact quote", () => {
		const anchor = anchorQuote(TUTOR_LINE, "Just memorize that constant");
		expect(anchor?.quote).toBe("Just memorize that constant");
		expect(TUTOR_LINE.slice(anchor!.start, anchor!.end)).toBe("Just memorize that constant");
	});

	it("anchors a quote the model reflowed across whitespace", () => {
		const anchor = anchorQuote(TUTOR_LINE, "squared. Just memorize");
		expect(anchor).toBeDefined();
		expect(TUTOR_LINE.slice(anchor!.start, anchor!.end)).toBe("squared.\nJust memorize");
	});

	it("returns nothing rather than guessing when the quote is absent", () => {
		expect(anchorQuote(TUTOR_LINE, "a sentence never spoken")).toBeUndefined();
	});
});

describe("parseCritiqueSweep", () => {
	it("maps findings onto anchored proposals", () => {
		const raw = JSON.stringify({
			findings: [{
				kind: "problem",
				category: "Answer Giving",
				severity: 3,
				messageId: "m2",
				quote: "Just memorize that constant",
				note: "Handed over the constant with no derivation.",
				pedagogicalImpact: "The learner never builds the model.",
				suggestedAlternative: "What do you predict happens to a heavier ball?",
			}],
		});
		const [proposal] = parseCritiqueSweep(raw, TRAJECTORY, (index) => `p${index}`);
		expect(proposal.id).toBe("p0");
		expect(proposal.kind).toBe("problem");
		expect(proposal.category).toBe("answer-giving");
		expect(proposal.severity).toBe(3);
		expect(proposal.messageId).toBe("m2");
		expect(proposal.anchored).toBe(true);
		expect(proposal.anchor?.quote).toBe("Just memorize that constant");
	});

	it("keeps a finding whose quote cannot be located, marked unanchored", () => {
		const raw = JSON.stringify({
			findings: [{ kind: "strength", messageId: "m2", quote: "never said this", note: "Named the units." }],
		});
		const [proposal] = parseCritiqueSweep(raw, TRAJECTORY);
		expect(proposal.anchored).toBe(false);
		expect(proposal.anchor).toBeUndefined();
		expect(proposal.severity).toBeUndefined();
	});

	it("drops findings that cite a turn which does not exist", () => {
		const raw = JSON.stringify({
			findings: [{ kind: "problem", messageId: "ghost", quote: "x", note: "Something." }],
		});
		const [proposal] = parseCritiqueSweep(raw, TRAJECTORY);
		expect(proposal.messageId).toBeUndefined();
		expect(proposal.anchored).toBe(false);
	});

	it("skips entries with no note", () => {
		const raw = JSON.stringify({ findings: [{ kind: "problem", quote: "x" }, { kind: "strength", note: "Good." }] });
		expect(parseCritiqueSweep(raw, TRAJECTORY)).toHaveLength(1);
	});
});

describe("parseRubricSweep", () => {
	it("orders scores by the canonical rubric and clamps ratings", () => {
		const raw = JSON.stringify({
			ratings: [
				{ key: "verification", rating: 4, justification: "Checked the prediction." },
				{ key: "diagnosis", rating: 9, justification: "Out of range." },
				{ key: "learner_agency", rating: 2, justification: "Gave the answer.", messageId: "m2", quote: "Just memorize that constant" },
			],
			overallRating: 3,
			summary: "Rushed the derivation.",
			verdict: "review",
		});
		const parsed = parseRubricSweep(raw, TRAJECTORY);
		expect(parsed.ratings.map((entry) => entry.key)).toEqual(["learner-agency", "verification"]);
		expect(parsed.ratings[0].anchored).toBe(true);
		expect(parsed.overallRating).toBe(3);
		expect(parsed.verdict).toBe("review");
		expect(parsed.summary).toBe("Rushed the derivation.");
	});

	it("survives a reply with no usable ratings", () => {
		const parsed = parseRubricSweep(JSON.stringify({ ratings: [] }), TRAJECTORY);
		expect(parsed.ratings).toEqual([]);
		expect(parsed.verdict).toBeUndefined();
	});
});

describe("parseAnnotationExpansion", () => {
	it("returns both halves of the expansion", () => {
		const raw = JSON.stringify({ pedagogicalImpact: "Removes the struggle.", suggestedAlternative: "What would you expect?" });
		expect(parseAnnotationExpansion(raw)).toEqual({
			pedagogicalImpact: "Removes the struggle.",
			suggestedAlternative: "What would you expect?",
		});
	});

	it("throws when the model returned neither half", () => {
		expect(() => parseAnnotationExpansion(JSON.stringify({}))).toThrow(ReviewPassParseError);
	});
});

describe("parsePatternDigest", () => {
	it("ranks patterns by how many sessions they span", () => {
		const raw = JSON.stringify({
			patterns: [
				{ pattern: "Rushes to the formula", detail: "d", rubricKey: "learner-agency", sessionIds: ["a", "b"] },
				{ pattern: "Skips verification", detail: "d", rubricKey: "verification", sessionIds: ["a", "b", "c"] },
				{ pattern: "No name", detail: "d", sessionIds: ["a"] },
			],
			throughLine: "Let the learner predict first.",
		});
		const digest = parsePatternDigest(raw, (index) => `d${index}`);
		expect(digest.entries.map((entry) => entry.pattern)).toEqual([
			"Skips verification",
			"Rushes to the formula",
			"No name",
		]);
		expect(digest.entries[0].occurrences).toBe(3);
		expect(digest.entries[0].rubricKey).toBe("verification");
		expect(digest.throughLine).toBe("Let the learner predict first.");
	});
});

describe("pass prompts", () => {
	it("quotes the session as review data and asks for strengths too", () => {
		const prompt = buildCritiqueSweepPrompt({ trajectory: TRAJECTORY, maxProposals: 5 });
		expect(prompt).toContain("at most 5");
		expect(prompt).toContain("Mark strengths as well as problems");
		expect(prompt).toContain("<session_trajectory>");
		expect(prompt).toContain("Just memorize that constant");
	});

	it("carries verdicts and notes from every supplied review into the digest", () => {
		const review = { ...createReviewRecord("session-a"), verdict: "review" as const, summary: "Rushed." };
		const prompt = buildPatternDigestPrompt([{ review, annotations: [], title: "Free fall" }]);
		expect(prompt).toContain("session-a");
		expect(prompt).toContain("Free fall");
		expect(prompt).toContain("A pattern needs at least two sessions");
	});
});

import { describe, expect, it } from "bun:test";
import type { JudgementCaller, JudgementRequest } from "@keating/learner-contracts";
import {
	INTAKE_PROMPTS,
	extractIntakeProposals,
	verbatimIntakeFields,
	type IntakeAnswer,
} from "../keating/profile-intake";

const answer = (promptId: string, text: string, source: IntakeAnswer["source"] = "conversation"): IntakeAnswer =>
	({ promptId, text, source });

/** A backend that answers every asked field with one fixed choice. */
function answering(choice: string, confidence: number): JudgementCaller {
	return async (request: JudgementRequest) => {
		const answers: Record<string, unknown> = {};
		for (const field of Object.keys(request.questions)) {
			const spec = (request.questions as Record<string, { criteria: Record<string, string> }>)[field];
			const value = Object.keys(spec.criteria).includes(choice) ? choice : Object.keys(spec.criteria)[0];
			answers[field] = { type: "choice", choice: value, confidence };
		}
		return { ok: true, response: { answers } } as Awaited<ReturnType<JudgementCaller>>;
	};
}

const unavailable: JudgementCaller = async () => ({ ok: false, error: { code: "backend-unavailable", retryable: false } });

describe("conversational intake", () => {
	it("lifts free text exactly as written, and records nothing for a blank answer", () => {
		expect(verbatimIntakeFields([answer("name", "  Sam  "), answer("goal", "why enzymes speed reactions up")]))
			.toEqual({ preferredName: "Sam", goalText: "why enzymes speed reactions up" });
		// Silence is not a decline: an unanswered question must leave no key at
		// all, so nothing downstream can read it as "prefer not to say".
		const blank = verbatimIntakeFields([answer("name", "   "), answer("goal", "")]);
		expect(blank).toEqual({});
		expect("preferredName" in blank).toBe(false);
	});

	it("abstains coherently rather than throwing when no backend answers", async () => {
		const result = await extractIntakeProposals([answer("tone", "Just tell me straight.")], { call: unavailable });
		expect(result.proposals).toEqual([]);
		expect(result.abstainedEntirely).toBe(true);
	});

	it("proposes nothing from a confident answer below the floor", async () => {
		const result = await extractIntakeProposals([answer("tone", "Just tell me straight.")], { call: answering("direct", 0.4) });
		expect(result.proposals).toEqual([]);
	});

	it("proposes fields with the learner's own sentence as the evidence", async () => {
		const said = "Just tell me straight when I have it wrong.";
		const result = await extractIntakeProposals([answer("tone", said)], { call: answering("direct", 0.9) });
		expect(result.proposals.length).toBeGreaterThan(0);
		expect(result.abstainedEntirely).toBe(false);
		for (const proposal of result.proposals) {
			expect(proposal.evidence).toBe(said);
			expect(proposal.source).toBe("conversation");
		}
		expect(result.proposals.some(entry => entry.field === "tone" && entry.value === "direct")).toBe(true);
	});

	it("keeps the source of a spoken answer distinct from a typed one", async () => {
		const result = await extractIntakeProposals([answer("tone", "Straight, please.", "speech")], { call: answering("direct", 0.9) });
		expect(result.proposals.every(entry => entry.source === "speech")).toBe(true);
	});

	it("only mines each answer for the fields that question asks about", async () => {
		const asked: string[][] = [];
		const spy: JudgementCaller = async request => { asked.push(Object.keys(request.questions)); return { ok: false, error: { code: "backend-unavailable", retryable: false } }; };
		await extractIntakeProposals([answer("tone", "Straight."), answer("teaching", "Being asked about it.")], { call: spy });
		expect(asked[0]).toEqual([...(INTAKE_PROMPTS.find(entry => entry.id === "tone")?.fields ?? [])]);
		expect(asked[1]).toEqual([...(INTAKE_PROMPTS.find(entry => entry.id === "teaching")?.fields ?? [])]);
	});

	it("skips blank answers and the name question without calling the backend", async () => {
		let calls = 0;
		const spy: JudgementCaller = async () => { calls += 1; return { ok: false, error: { code: "backend-unavailable", retryable: false } }; };
		const result = await extractIntakeProposals([answer("name", "Sam"), answer("goal", "   ")], { call: spy });
		expect(calls).toBe(0);
		// Nothing was asked, so there is nothing to report as an abstention.
		expect(result.abstainedEntirely).toBe(false);
	});
});

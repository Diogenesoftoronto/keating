import { describe, expect, it } from "bun:test";
import {
	diffTeacherPolicies,
	parseEvolutionTrace,
	parseTeacherPolicySnapshot,
	resolveEvolutionPolicyDiff,
} from "../keating/evolution-diff";

const policy = {
	name: "baseline",
	analogyDensity: 0.5,
	socraticRatio: 0.6,
	formalism: 0.4,
	retrievalPractice: 0.7,
	exerciseCount: 2,
	diagramBias: 0.4,
	reflectionBias: 0.5,
	interdisciplinaryBias: 0.3,
	challengeRate: 0.5,
};

describe("evolution diff data", () => {
	it("validates policies and reports exact changed fields", () => {
		const before = parseTeacherPolicySnapshot(JSON.stringify(policy));
		const after = parseTeacherPolicySnapshot(JSON.stringify({
			...policy,
			name: "retrieval-heavy",
			retrievalPractice: 0.85,
			exerciseCount: 3,
		}));
		expect(before).not.toBeNull();
		expect(after).not.toBeNull();
		expect(diffTeacherPolicies(before, after!)).toEqual([
			{ field: "name", before: "baseline", after: "retrieval-heavy", delta: null },
			{ field: "retrievalPractice", before: 0.7, after: 0.85, delta: 0.15000000000000002 },
			{ field: "exerciseCount", before: 2, after: 3, delta: 1 },
		]);
	});

	it("retains accepted decisions and parameter-level trace diffs", () => {
		const trace = parseEvolutionTrace(JSON.stringify([{
			iteration: 2,
			accepted: true,
			novelty: 0.2,
			parentName: "baseline",
			policy: { ...policy, retrievalPractice: 0.8 },
			decision: {
				improves: true,
				safe: true,
				novelEnough: true,
				scoreDelta: 1.25,
				weakestTopicDelta: 0.5,
				reasons: ["overall score improved"],
			},
			parameterDelta: [{ field: "retrievalPractice", before: 0.7, after: 0.8, delta: 0.1 }],
		}]));
		expect(trace).toHaveLength(1);
		expect(trace[0].accepted).toBe(true);
		expect(trace[0].parameterDelta[0]).toEqual({
			field: "retrievalPractice",
			before: 0.7,
			after: 0.8,
			delta: 0.1,
		});
	});

	it("fails closed for malformed stored JSON", () => {
		expect(parseTeacherPolicySnapshot("not json")).toBeNull();
		expect(parseEvolutionTrace("{}" )).toEqual([]);
	});

	it("fails closed when an exact diff cannot be established", () => {
		expect(resolveEvolutionPolicyDiff("not json", null)).toEqual({
			ok: false,
			reason: "invalid-policy",
		});
		expect(resolveEvolutionPolicyDiff(JSON.stringify(policy), "not json")).toEqual({
			ok: false,
			reason: "invalid-baseline",
		});
		expect(resolveEvolutionPolicyDiff(JSON.stringify(policy), JSON.stringify(policy))).toEqual({
			ok: false,
			reason: "no-changes",
		});
	});
});

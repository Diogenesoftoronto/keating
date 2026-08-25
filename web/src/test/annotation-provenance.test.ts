import { describe, expect, test } from "bun:test";
import {
	markPassDrafted,
	overallAuthorship,
	reconcileFieldAuthorship,
} from "../keating/annotation-provenance";
import {
	reviewWorkspaceUiReducer,
	initialReviewWorkspaceUiState,
	type ReviewWorkspaceUiState,
} from "../keating/trajectory-review-ui-state";
import type { TrajectoryAnnotationDraft } from "../components/trajectory/types";

function draft(patch: Partial<TrajectoryAnnotationDraft> = {}): TrajectoryAnnotationDraft {
	return {
		target: { kind: "session" },
		targetKey: "session",
		kind: "problem",
		category: "Diagnosis",
		note: "",
		status: "draft",
		...patch,
	};
}

function stateWith(current: TrajectoryAnnotationDraft): ReviewWorkspaceUiState {
	return { ...initialReviewWorkspaceUiState, annotationDraft: current };
}

describe("markPassDrafted", () => {
	test("marks only the fields the pass filled", () => {
		expect(markPassDrafted(undefined, ["pedagogicalImpact"])).toEqual({ pedagogicalImpact: "pass-drafted" });
	});

	test("leaves untouched fields alone", () => {
		const existing = { note: "human" } as const;
		expect(markPassDrafted(existing, ["suggestedAlternative"])).toEqual({
			note: "human",
			suggestedAlternative: "pass-drafted",
		});
	});
});

describe("reconcileFieldAuthorship", () => {
	test("teacher prose in an untouched field records as human", () => {
		const result = reconcileFieldAuthorship({ note: "" }, { note: "Handed the answer." }, undefined);
		expect(result.note).toBe("human");
	});

	test("teacher rewriting model prose promotes to pass-edited", () => {
		const result = reconcileFieldAuthorship(
			{ suggestedAlternative: "Ask a question instead." },
			{ suggestedAlternative: "Ask what the graph does near zero." },
			{ suggestedAlternative: "pass-drafted" },
		);
		expect(result.suggestedAlternative).toBe("pass-edited");
	});

	test("model prose left untouched stays pass-drafted", () => {
		const unchanged = { suggestedAlternative: "Ask a question instead." };
		const result = reconcileFieldAuthorship(unchanged, unchanged, { suggestedAlternative: "pass-drafted" });
		expect(result.suggestedAlternative).toBe("pass-drafted");
	});

	test("clearing a field drops its provenance", () => {
		const result = reconcileFieldAuthorship({ note: "something" }, { note: "" }, { note: "human" });
		expect(result.note).toBeUndefined();
	});
});

describe("overallAuthorship", () => {
	test("any surviving model draft dominates", () => {
		expect(overallAuthorship({ note: "human", suggestedAlternative: "pass-drafted" })).toBe("pass-drafted");
	});

	test("edited model prose ranks above accepted model prose", () => {
		expect(overallAuthorship({ note: "human", suggestedAlternative: "pass-edited" })).toBe("pass-edited");
	});

	test("wholly human notes are human", () => {
		expect(overallAuthorship({ note: "human" })).toBe("human");
	});
});

describe("review workspace reducer", () => {
	test("a pass filling the draft does not read as a teacher edit", () => {
		const before = draft({ note: "Circular reasoning." });
		const next = reviewWorkspaceUiReducer(stateWith(before), {
			type: "expand-annotation",
			draft: {
				...before,
				suggestedAlternative: "Ask for a numerical probe.",
				fieldAuthorship: { suggestedAlternative: "pass-drafted" },
			},
		});
		expect(next.annotationDraft?.fieldAuthorship?.suggestedAlternative).toBe("pass-drafted");
	});

	test("the teacher then rewriting that field promotes it", () => {
		const expanded = draft({
			note: "Circular reasoning.",
			suggestedAlternative: "Ask for a numerical probe.",
			fieldAuthorship: { suggestedAlternative: "pass-drafted" },
		});
		const next = reviewWorkspaceUiReducer(stateWith(expanded), {
			type: "change-annotation",
			draft: { ...expanded, suggestedAlternative: "Ask what sin(x)/x does at x = 0.01." },
		});
		expect(next.annotationDraft?.fieldAuthorship?.suggestedAlternative).toBe("pass-edited");
		expect(next.annotationDraft?.authorship).toBe("pass-edited");
	});
});

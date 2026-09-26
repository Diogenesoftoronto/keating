import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { acceptedProfilePatch, type ProfileProposal } from "@keating/learner-contracts";
import {
	ProfileProposalReview,
	acceptedProposals,
	toggleVerdict,
	type ProposalVerdict,
} from "../components/ProfileProposalReview";

const proposals: readonly ProfileProposal[] = [
	{ field: "tone", value: "direct", confidence: 0.82, evidence: "Just tell me when I have it wrong.", source: "conversation" },
	{ field: "interests", value: "Organic Chemistry", confidence: 0.74, evidence: "Organic Chemistry::Reactions", source: "anki-import" },
	{ field: "depth", value: "rigorous", confidence: 0.79, evidence: "I want the derivation, not the summary.", source: "speech" },
];

const pending: readonly ProposalVerdict[] = ["pending", "pending", "pending"];

describe("profile proposal review", () => {
	it("keeps every row undecided until the learner decides", () => {
		// The card's whole reason to exist: an unopened, undecided, or dismissed
		// card must apply nothing, so silence can never be read as consent.
		expect(acceptedProposals(proposals, pending)).toEqual([]);
		expect(acceptedProfilePatch(acceptedProposals(proposals, pending))).toEqual({});
	});

	it("applies only what was kept, never what was dropped or left alone", () => {
		const verdicts = toggleVerdict(toggleVerdict(pending, 0, "accepted"), 2, "discarded");
		const kept = acceptedProposals(proposals, verdicts);
		expect(kept).toEqual([proposals[0]]);
		const patch = acceptedProfilePatch(kept);
		expect(patch.tone).toBe("direct");
		expect(patch.depth).toBeUndefined();
		expect(patch.interests).toBeUndefined();
	});

	it("returns a row to undecided when the same verdict is chosen twice", () => {
		const accepted = toggleVerdict(pending, 1, "accepted");
		expect(accepted[1]).toBe("accepted");
		const undone = toggleVerdict(accepted, 1, "accepted");
		expect(undone[1]).toBe("pending");
		expect(acceptedProposals(proposals, undone)).toEqual([]);
	});

	it("switches verdict without disturbing its neighbours", () => {
		const verdicts = toggleVerdict(toggleVerdict(toggleVerdict(pending, 0, "accepted"), 1, "accepted"), 1, "discarded");
		expect(verdicts).toEqual(["accepted", "discarded", "pending"]);
	});

	it("shows each claim beside the learner's own words, and nothing pre-selected", () => {
		const html = renderToStaticMarkup(<ProfileProposalReview proposals={proposals} onApply={() => {}} />);
		for (const proposal of proposals) expect(html).toContain(proposal.evidence);
		expect(html).toContain("Organic Chemistry");
		expect(html).toContain("rigorous");
		expect(html).toContain('data-verdict="pending"');
		expect(html).not.toContain('data-verdict="accepted"');
		expect(html).not.toContain('aria-pressed="true"');
		expect(html).toContain("Save nothing");
		// The known global-CSS gotcha: dialog buttons stretch without this class.
		expect(html.match(/dialog-compact-button/gu)?.length).toBe(proposals.length * 2 + 1);
	});

	it("carries an accepted Anki interest through to the patch", () => {
		// The imported-deck path ends on this same card, so an interest only
		// becomes an interest once the learner has kept it.
		const verdicts = toggleVerdict(pending, 1, "accepted");
		expect(acceptedProfilePatch(acceptedProposals(proposals, verdicts))).toEqual({ interests: ["Organic Chemistry"] });
	});

	it("renders nothing at all when there is nothing to propose", () => {
		expect(renderToStaticMarkup(<ProfileProposalReview proposals={[]} onApply={() => {}} />)).toBe("");
	});
});

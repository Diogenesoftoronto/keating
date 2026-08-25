import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CritiqueProposals, RubricProposal } from "../components/trajectory/MarginProposals";
import { SocraticPass } from "../components/trajectory/SocraticPass";
import { KeatingIcon } from "../components/KeatingIcon";
import { reviewIcon } from "../components/trajectory/review-icons";
import { TutorialShot } from "../components/TutorialShot";
import type { CritiqueProposal, RubricSweepProposal } from "../keating/trajectory-passes";
import type { ReviewModelPool } from "../keating/trajectory-review";

const noOp = () => {};

const pool: ReviewModelPool = {
	schemaVersion: 1,
	id: "pool-1",
	name: "Tutor responses",
	tasks: ["response"],
	models: [{ provider: "browser", id: "local", name: "Local" }],
	candidateCount: 2,
	temperature: 0.7,
	maxTokens: 800,
	createdAt: 1,
	updatedAt: 1,
} as unknown as ReviewModelPool;

const anchoredProposal: CritiqueProposal = {
	id: "p1",
	kind: "problem",
	category: "answer-giving",
	severity: 3,
	note: "Handed over the constant with no derivation.",
	pedagogicalImpact: "The learner never builds the model.",
	suggestedAlternative: "What do you predict happens to a heavier ball?",
	messageId: "m2",
	anchor: {
		start: 0,
		end: 10,
		quote: "Just memorize that constant",
		prefix: "",
		suffix: "",
		contentFingerprint: "abc",
	},
	anchored: true,
};

describe("KeatingIcon", () => {
	it("renders both weights so the swap can happen in CSS alone", () => {
		const html = renderToStaticMarkup(<KeatingIcon icon={reviewIcon.pass} size={16} />);
		expect(html).toContain('data-weight="Outline"');
		expect(html).toContain('data-weight="Filled"');
		expect(html).toContain("currentColor");
	});

	it("hides itself from assistive tech unless given a label", () => {
		expect(renderToStaticMarkup(<KeatingIcon icon={reviewIcon.pass} />)).toContain('aria-hidden="true"');
		const labelled = renderToStaticMarkup(<KeatingIcon icon={reviewIcon.pass} label="Socratic pass" />);
		expect(labelled).toContain('role="img"');
		expect(labelled).toContain('aria-label="Socratic pass"');
	});
});

describe("SocraticPass", () => {
	it("stays collapsed at rest so the margin shows one control", () => {
		const html = renderToStaticMarkup(
			<SocraticPass
				options={[{ kind: "critique-sweep", label: "Read the session", blurb: "Marks the moments.", icon: "sweep" }]}
				pools={[pool]}
				poolId="pool-1"
				onPoolChange={noOp}
				running={null}
				onRun={noOp}
				onCancel={noOp}
			/>,
		);
		expect(html).toContain("Socratic pass");
		expect(html).toContain('aria-expanded="false"');
		// The pass menu is closed, so its options are not in the document.
		expect(html).not.toContain("Read the session");
	});

	it("offers to stop while a pass is running", () => {
		const html = renderToStaticMarkup(
			<SocraticPass
				options={[{ kind: "critique-sweep", label: "Read the session", blurb: "Marks the moments.", icon: "sweep" }]}
				pools={[pool]}
				poolId="pool-1"
				onPoolChange={noOp}
				running="critique-sweep"
				onRun={noOp}
				onCancel={noOp}
			/>,
		);
		expect(html).toContain("Read the session…");
		expect(html).toContain("STOP");
	});
});

describe("CritiqueProposals", () => {
	it("renders an anchored proposal with its citation and both accept and dismiss", () => {
		const html = renderToStaticMarkup(
			<CritiqueProposals proposals={[anchoredProposal]} onAccept={noOp} onDismiss={noOp} onDismissAll={noOp} />,
		);
		expect(html).toContain("Handed over the constant with no derivation.");
		expect(html).toContain("Just memorize that constant");
		expect(html).toContain("The learner never builds the model.");
		expect(html).toContain("Accept this note");
		expect(html).toContain("Dismiss this note");
		expect(html).toContain("Proposed · 1");
	});

	it("says so plainly when a proposal could not be anchored", () => {
		const html = renderToStaticMarkup(
			<CritiqueProposals
				proposals={[{ ...anchoredProposal, anchor: undefined, anchored: false }]}
				onAccept={noOp}
				onDismiss={noOp}
				onDismissAll={noOp}
			/>,
		);
		expect(html).toContain("Unanchored");
	});

	it("renders nothing at all when there are no proposals", () => {
		expect(renderToStaticMarkup(
			<CritiqueProposals proposals={[]} onAccept={noOp} onDismiss={noOp} onDismissAll={noOp} />,
		)).toBe("");
	});
});

describe("RubricProposal", () => {
	it("shows each proposed score with its reason", () => {
		const proposal: RubricSweepProposal = {
			ratings: [
				{ key: "learner-agency", rating: 2, justification: "Gave the answer.", anchored: false },
				{ key: "verification", rating: 4, justification: "Checked the prediction.", anchored: false },
			],
			overallRating: 3,
			summary: "Rushed the derivation.",
			verdict: "review",
		};
		const html = renderToStaticMarkup(<RubricProposal proposal={proposal} onApply={noOp} onDismiss={noOp} />);
		expect(html).toContain("Learner agency");
		expect(html).toContain("2/5");
		expect(html).toContain("Gave the answer.");
		expect(html).toContain("Overall 3/5");
		expect(html).toContain("Needs work");
	});
});

describe("TutorialShot", () => {
	it("renders a captioned placeholder that keeps the frame before the screenshot exists", () => {
		const html = renderToStaticMarkup(
			<TutorialShot slate="STEP 01" alt="The review workspace." caption="Open a session from /review." />,
		);
		expect(html).toContain("Screenshot coming");
		expect(html).toContain("Open a session from /review.");
		expect(html).toContain("STEP 01");
		expect(html).not.toContain("<img");
	});

	it("renders the real image once a src is supplied", () => {
		const html = renderToStaticMarkup(
			<TutorialShot src="/tutorial/review-margin.png" alt="The margin." caption="The margin." />,
		);
		expect(html).toContain('src="/tutorial/review-margin.png"');
		expect(html).toContain('loading="lazy"');
		expect(html).not.toContain("Screenshot coming");
	});
});

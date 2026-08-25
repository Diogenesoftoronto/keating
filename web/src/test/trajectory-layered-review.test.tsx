import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AnnotationEditor } from "../components/trajectory/AnnotationEditor";
import { AnnotationHoverCard } from "../components/trajectory/AnnotationHoverCard";
import { TrajectoryCanvas } from "../components/trajectory/TrajectoryCanvas";
import {
	TRAJECTORY_REVIEW_SCHEMA_VERSION,
	createTextAnchor,
	type TrajectoryAnnotation,
} from "../keating/trajectory-review";
import type { TrajectoryAnnotationDraft } from "../components/trajectory/types";

const TURN_TEXT = "It looks like 0/0, so we reach for L'Hopital's rule and differentiate both parts.";
const QUOTE = "we reach for L'Hopital's rule";

function annotation(patch: Partial<TrajectoryAnnotation> = {}): TrajectoryAnnotation {
	const start = TURN_TEXT.indexOf(QUOTE);
	return {
		schemaVersion: TRAJECTORY_REVIEW_SCHEMA_VERSION,
		id: "annotation-1",
		reviewId: "review:session-1",
		sessionId: "session-1",
		target: {
			kind: "message-span",
			messageId: "assistant-1",
			role: "assistant",
			anchor: createTextAnchor(TURN_TEXT, start, start + QUOTE.length),
		},
		targetKey: "message:assistant-1:span",
		kind: "problem",
		category: "Factual accuracy",
		severity: 3,
		note: "L'Hopital is circular here; its proof needs the very limit under discussion.",
		status: "draft",
		createdAt: 1,
		updatedAt: 1,
		...patch,
	};
}

function canvas(annotations: TrajectoryAnnotation[], readOnly = false) {
	return renderToStaticMarkup(
		<TrajectoryCanvas
			messages={[{
				id: "assistant-1",
				role: "assistant",
				ordinal: 1,
				text: TURN_TEXT,
				contentFingerprint: "fp-1",
			}]}
			artifacts={[]}
			annotations={annotations}
			activeMessageId="assistant-1"
			mode="transcript"
			onModeChange={() => {}}
			onSelectMessage={() => {}}
			onSelectArtifact={() => {}}
			readOnly={readOnly}
		/>,
	);
}

describe("marked spans", () => {
	it("carries no native title tooltip", () => {
		// The tooltip was the old reading layer: unstructured, unactionable, and it
		// could not show provenance. Its removal is the point of the hovercard.
		const html = canvas([annotation()]);
		expect(html).toContain("<mark");
		expect(html).not.toContain("title=\"L'Hopital is circular");
	});

	it("is reachable without a pointer", () => {
		const html = canvas([annotation()]);
		expect(html).toContain('tabindex="0"');
		expect(html).toContain("aria-label=\"1 note on");
	});

	it("distinguishes a revision from an ordinary note", () => {
		const plain = canvas([annotation()]);
		const revised = canvas([annotation({
			kind: "suggestion",
			revision: { original: QUOTE },
			suggestedAlternative: "what happens if you try x = 0.1, then x = 0.01?",
		})]);
		// PandaCSS emits atomic class names rather than inline style.
		expect(plain).toContain("border-bottom-style_solid");
		expect(revised).toContain("border-bottom-style_dashed");
	});

	it("still marks the text for a read-only viewer", () => {
		// Shared reviews are read, not authored: the marks are the whole reason to open one.
		expect(canvas([annotation()], true)).toContain("<mark");
	});
});

describe("annotation hovercard", () => {
	it("shows the note, its category, and its severity", () => {
		const html = renderToStaticMarkup(<AnnotationHoverCard annotations={[annotation()]} />);
		expect(html).toContain("L&#x27;Hopital is circular here");
		expect(html).toContain("Factual accuracy");
		expect(html).toContain("sev 3");
	});

	it("reports provenance so accepted model prose is not mistaken for judgement", () => {
		const drafted = renderToStaticMarkup(
			<AnnotationHoverCard annotations={[annotation({ authorship: "pass-drafted" })]} />,
		);
		const written = renderToStaticMarkup(
			<AnnotationHoverCard annotations={[annotation({ authorship: "human" })]} />,
		);
		expect(drafted).toContain("pass · accepted");
		expect(written).toContain("human");
	});

	it("shows a revision as a contrast, not as a replacement", () => {
		const html = renderToStaticMarkup(
			<AnnotationHoverCard
				annotations={[annotation({
					revision: { original: QUOTE },
					suggestedAlternative: "what does the ratio do near zero?",
				})]}
			/>,
		);
		expect(html).toContain(QUOTE.replace(/'/g, "&#x27;"));
		expect(html).toContain("what does the ratio do near zero?");
		expect(html).toContain("line-through");
	});

	it("offers no authoring actions to a read-only viewer", () => {
		const html = renderToStaticMarkup(<AnnotationHoverCard annotations={[annotation()]} readOnly />);
		expect(html).not.toContain(">Edit");
		expect(html).not.toContain(">Delete");
	});
});

function draft(patch: Partial<TrajectoryAnnotationDraft> = {}): TrajectoryAnnotationDraft {
	return {
		target: { kind: "session" },
		targetKey: "session",
		kind: "problem",
		category: "",
		note: "",
		status: "draft",
		...patch,
	};
}

function editor(value: TrajectoryAnnotationDraft) {
	return renderToStaticMarkup(
		<AnnotationEditor draft={value} onChange={() => {}} onSave={() => {}} onCancel={() => {}} />,
	);
}

describe("progressive annotation editor", () => {
	it("asks only why it matters before it will save", () => {
		// Category used to be required alongside the note. It is inferable from the
		// note and defaulted on save, so demanding it taxed every note for nothing.
		// `disabled:` also appears in Panda class names, so match the attribute itself.
		expect(editor(draft({ note: "Handed over the result." }))).not.toContain('disabled=""');
	});

	it("will not save a note with no reason in it", () => {
		expect(editor(draft())).toContain('disabled=""');
	});

	it("keeps the optional fields behind chips until they are asked for", () => {
		const html = editor(draft({ note: "Circular." }));
		expect(html).toContain("category</button>");
		expect(html).toContain("alternative</button>");
		expect(html).not.toContain("Pedagogical impact");
		expect(html).not.toContain("How did this affect the learner?");
	});

	it("opens a field that already carries text", () => {
		const html = editor(draft({ note: "Circular.", pedagogicalImpact: "The learner cannot verify it." }));
		expect(html).toContain("Pedagogical impact");
		expect(html).toContain("The learner cannot verify it.");
	});

	it("frames a rewrite as a revision of the original", () => {
		const html = editor(draft({
			kind: "suggestion",
			note: "Ask instead.",
			revision: { original: QUOTE },
			suggestedAlternative: "what does the ratio do near zero?",
		}));
		expect(html).toContain("Revise this text");
		expect(html).toContain("Replacement text");
		expect(html).toContain("line-through");
	});
});

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	TRAJECTORY_REVIEW_SCHEMA_VERSION,
	createTextAnchor,
	type ArtifactVersionReference,
	type TrajectoryAnnotation,
} from "../../keating/trajectory-review";
import {
	SharedTrajectoryWorkspace,
	initialSharedTrajectoryNavigation,
	sharedTrajectoryNavigationReducer,
} from "./SharedTrajectoryWorkspace";
import { TrajectoryCanvas } from "./TrajectoryCanvas";

const imageReference: ArtifactVersionReference = {
	source: { source: "session", sessionId: "shared-session", id: "image-1" },
	artifactType: "image",
	format: "image/png",
	versionId: "image-v1",
	contentHash: "sha256:image",
	frozen: true,
};

const planReference: ArtifactVersionReference = {
	source: { source: "session", sessionId: "shared-session", id: "plan-1" },
	artifactType: "plan",
	format: "markdown",
	versionId: "plan-v1",
	contentHash: "sha256:plan",
	frozen: true,
};

function annotation(
	id: string,
	patch: Pick<TrajectoryAnnotation, "target" | "targetKey" | "note" | "status">,
): TrajectoryAnnotation {
	return {
		schemaVersion: TRAJECTORY_REVIEW_SCHEMA_VERSION,
		id,
		reviewId: "review:shared-session",
		sessionId: "shared-session",
		kind: "problem",
		category: "Scaffolding",
		pedagogicalImpact: "The learner cannot connect the rule to prior knowledge.",
		suggestedAlternative: "Ask which operation multiplication reverses first.",
		createdAt: 1,
		updatedAt: 1,
		...patch,
	};
}

describe("shared trajectory workspace", () => {
	test("renders the complete session with inline final notes and no assessment chrome", () => {
		const messageText = "Invert the divisor, then multiply.";
		const finalNote = annotation("final-note", {
			target: {
				kind: "message-span",
				messageId: "assistant-1",
				role: "assistant",
				anchor: createTextAnchor(messageText, 0, 18),
			},
			targetKey: "message:assistant-1",
			note: "The rule arrives before the learner has a reason for it.",
			status: "final",
		});
		const draftNote = annotation("draft-note", {
			target: { kind: "artifact", artifact: planReference },
			targetKey: "artifact:plan-1",
			note: "Unpublished draft feedback",
			status: "draft",
		});
		const html = renderToStaticMarkup(
			<SharedTrajectoryWorkspace
				data={{
					session: { id: "shared-session", title: "Fractions session", subtitle: "Published teaching review" },
					messages: [
						{
							id: "learner-1",
							role: "user",
							ordinal: 0,
							text: "Why do we invert the divisor?",
							contentFingerprint: "sha256:learner-message",
							label: "Learner message",
						},
						{
							id: "assistant-1",
							role: "assistant",
							ordinal: 1,
							text: messageText,
							contentFingerprint: "sha256:message",
							label: "Tutor response",
						},
					],
					artifacts: [
						{
							id: "image-1",
							title: "Reciprocal diagram",
							reference: imageReference,
							media: {
								kind: "image",
								src: "data:image/png;base64,iVBORw0KGgo=",
								alt: "Reciprocal diagram",
								assetHash: "sha256:raster",
								naturalWidth: 320,
								naturalHeight: 180,
							},
						},
						{ id: "plan-1", title: "Fraction lesson plan", reference: planReference, plainText: "Use a visual model first." },
					],
					annotations: [finalNote, draftNote],
					review: {
						verdict: "review",
						overallRating: 3,
						ratings: { accuracy: 4, scaffolding: 2 },
						summary: "Accurate, but the explanation needs a conceptual bridge.",
					},
				}}
			/>,
		);

		expect(html).toContain("Fractions session");
		expect(html).toContain("Shared session");
		expect(html).toContain("Read only");
		expect(html).toContain("Why do we invert the divisor?");
		expect(html).toContain("Invert the divisor");
		expect(html).toContain(", then multiply.");
		expect(html).toContain("Reciprocal diagram");
		expect(html).toContain("Fraction lesson plan");
		expect(html).toContain("<mark");
		expect(html).not.toContain("Published review");
		expect(html).not.toContain("Needs review");
		expect(html).not.toContain("Accurate, but the explanation needs a conceptual bridge.");
		expect(html).not.toContain("The rule arrives before the learner has a reason for it.");
		expect(html).not.toContain("Final annotations");
		expect(html).not.toContain("Unpublished draft feedback");
		expect(html).not.toContain("Annotate turn");
		expect(html).not.toContain("Annotate artifact");
		expect(html).not.toContain("Enter region coordinates");
		expect(html).not.toContain("Select text to annotate");
		expect(html).not.toContain("Candidate");
	});

	test("keeps native video and time highlights without time authoring controls", () => {
		const videoReference: ArtifactVersionReference = {
			source: { source: "session", sessionId: "shared-session", id: "video-1" },
			artifactType: "video",
			format: "video/mp4",
			versionId: "video-v1",
			contentHash: "sha256:video",
			frozen: true,
		};
		const rangeNote = annotation("range-note", {
			target: {
				kind: "artifact-time-range",
				artifact: videoReference,
				mediaHash: "sha256:media",
				timeBasis: "media-time",
				startMs: 1_000,
				endMs: 2_500,
				durationMs: 5_000,
			},
			targetKey: "artifact:video-1",
			note: "The transition moves too quickly for comparison.",
			status: "final",
		});
		const html = renderToStaticMarkup(
			<TrajectoryCanvas
				messages={[]}
				artifacts={[{
					id: "video-1",
					title: "Comparison animation",
					reference: videoReference,
					media: { kind: "video", src: "/comparison.mp4", title: "Comparison animation", mediaHash: "sha256:media", durationMs: 5_000 },
				}]}
				annotations={[rangeNote]}
				activeArtifactId="video-1"
				mode="artifact"
				readOnly
				onModeChange={() => {}}
				onSelectMessage={() => {}}
				onSelectArtifact={() => {}}
			/>,
		);

		expect(html).toContain("<video");
		expect(html).toContain("1.0s to 2.5s");
		expect(html).not.toContain("Annotation start time");
		expect(html).not.toContain("Use current");
		expect(html).not.toContain("Annotate range");
	});

	test("navigation reducer focuses turns, artifacts, and published annotations", () => {
		const initial = initialSharedTrajectoryNavigation("session-1", ["turn-1", "turn-2"], ["artifact-1", "artifact-2"]);
		const artifact = sharedTrajectoryNavigationReducer(initial, { type: "artifact", artifactId: "artifact-2" });
		expect(artifact).toMatchObject({ mode: "artifact", activeArtifactId: "artifact-2" });

		const messageNote = sharedTrajectoryNavigationReducer(artifact, { type: "annotation", annotationId: "note-1", messageId: "turn-2" });
		expect(messageNote).toMatchObject({ mode: "transcript", activeMessageId: "turn-2", activeAnnotationId: "note-1" });

		const reconciled = sharedTrajectoryNavigationReducer(messageNote, {
			type: "reconcile",
			sessionId: "session-1",
			messageIds: ["turn-1"],
			artifactIds: ["artifact-1"],
			annotationIds: [],
		});
		expect(reconciled).toMatchObject({ mode: "transcript", activeMessageId: "turn-1", activeArtifactId: "artifact-1" });
		expect(reconciled.activeAnnotationId).toBeUndefined();

		const nextSession = sharedTrajectoryNavigationReducer(reconciled, {
			type: "reconcile",
			sessionId: "session-2",
			messageIds: [],
			artifactIds: ["artifact-next"],
			annotationIds: [],
		});
		expect(nextSession).toEqual({ sessionId: "session-2", mode: "artifact", activeMessageId: undefined, activeArtifactId: "artifact-next" });
	});
});

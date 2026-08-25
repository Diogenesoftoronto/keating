import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SharedTrajectoryWorkspace } from "../components/trajectory";
import type { SharedSession } from "../keating/shared-sessions";
import { contentFingerprint } from "../keating/trajectory-review";
import {
	sharedSessionOmissionNotice,
	sharedSessionWorkspaceData,
} from "../pages/shared-session-view-model";

function richSharedSession(): SharedSession {
	const turnText = "Start with a visual model before introducing the rule.";
	return {
		id: "public-share",
		schemaVersion: 3,
		title: "Fraction division",
		createdAt: "2026-08-23T12:00:00.000Z",
		sharedAt: "2026-08-23T12:10:00.000Z",
		messageCount: 1,
		messages: [{ role: "assistant", content: [{ type: "text", text: turnText }] }] as SharedSession["messages"],
		trajectory: {
			schemaVersion: 1,
			turnCount: 1,
			turns: [{
				id: "turn-1",
				ordinal: 0,
				role: "assistant",
				text: turnText,
				contentFingerprint: contentFingerprint(turnText),
			}],
			artifactCount: 2,
			artifacts: [
				{
					id: "artifact-1",
					artifactType: "plan",
					format: "markdown",
					label: "Fraction lesson plan",
					topic: "fraction division",
					content: "Use a visual model first, then connect it to the reciprocal rule.",
					createdAt: 1,
					capturedAt: 2,
				},
				{
					id: "artifact-2",
					artifactType: "image",
					format: "image/png",
					label: "Fraction bars",
					preview: {
						kind: "image",
						dataUrl: "data:image/png;base64,iVBORw0KGgo=",
						alt: "Fraction bars split into equal groups",
						mimeType: "image/png",
						naturalWidth: 320,
						naturalHeight: 180,
					},
					createdAt: 3,
					capturedAt: 4,
				},
			],
			review: {
				status: "final",
				verdict: "review",
				ratings: { scaffolding: 2, accuracy: 4 },
				overallRating: 3,
				summary: "Accurate, but the visual explanation should come first.",
				createdAt: 5,
				updatedAt: 6,
			},
			annotationCount: 2,
			annotations: [
				{
					id: "annotation-1",
					target: {
						kind: "message-span",
						turnId: "turn-1",
						quote: "introducing the rule",
						prefix: "visual model before ",
						suffix: ".",
					},
					targetKey: "turn-1:span",
					kind: "strength",
					category: "Scaffolding",
					note: "This sequence protects conceptual understanding.",
					status: "final",
					createdAt: 7,
					updatedAt: 8,
				},
				{
					id: "annotation-2",
					target: {
						kind: "artifact-region",
						artifactId: "artifact-2",
						coordinateSpace: "normalized-intrinsic",
						x: 0.1,
						y: 0.2,
						width: 0.3,
						height: 0.4,
						naturalWidth: 320,
						naturalHeight: 180,
					},
					targetKey: "artifact-2:region",
					kind: "suggestion",
					category: "Visual clarity",
					note: "Label the size of each group here.",
					status: "final",
					createdAt: 9,
					updatedAt: 10,
				},
			],
			omitted: {
				turns: 0,
				artifacts: 1,
				invalidArtifacts: 0,
				internalArtifacts: 1,
				privateArtifacts: 0,
				uninspectedArtifacts: 0,
				annotations: 0,
				artifactContents: 1,
				artifactPreviews: 0,
			},
		},
	};
}

describe("shared session view model", () => {
	test("maps the strict public share into the read-only session workspace", () => {
		const data = sharedSessionWorkspaceData(richSharedSession());
		expect(data).not.toBeNull();
		expect(data?.session.id).toBe("shared:public-share");
		expect(data?.messages[0]).toMatchObject({ id: "turn-1", label: "Keating", status: "complete" });
		expect(data?.artifacts).toHaveLength(2);
		expect(data?.artifacts[0].reference.source).toEqual({ source: "session", sessionId: "shared:public-share", id: "artifact-1" });
		expect(data?.artifacts[1].media).toMatchObject({
			kind: "image",
			assetHash: `public-asset:${contentFingerprint("data:image/png;base64,iVBORw0KGgo=")}`,
		});
		expect(data?.annotations[0].target).toMatchObject({
			kind: "message-span",
			messageId: "turn-1",
			anchor: { start: 33, end: 53, quote: "introducing the rule" },
		});
		expect(data?.annotations[1].target).toMatchObject({
			kind: "artifact-region",
			assetHash: `public-asset:${contentFingerprint("data:image/png;base64,iVBORw0KGgo=")}`,
		});

		const html = renderToStaticMarkup(<SharedTrajectoryWorkspace data={data!} />);
		expect(html).toContain("Shared session");
		expect(html).toContain("Fraction lesson plan");
		expect(html).toContain("Fraction bars");
		expect(html).toContain("introducing the rule");
		expect(html).toContain("<mark");
		expect(html).not.toContain("Accurate, but the visual explanation should come first.");
		expect(html).not.toContain("This sequence protects conceptual understanding.");
		expect(html).not.toContain("Annotate artifact");
		expect(html).not.toContain("Generate");
	});

	test("recomputes public fingerprints and degrades invalid anchors and regions safely", () => {
		const crafted = richSharedSession();
		crafted.trajectory!.turns[0].contentFingerprint = "forged";
		crafted.trajectory!.annotations[0].target = {
			kind: "message-span",
			turnId: "turn-1",
			quote: "text that is not present",
			prefix: "",
			suffix: "",
		};
		crafted.trajectory!.annotations[1].target = {
			kind: "artifact-region",
			artifactId: "artifact-2",
			coordinateSpace: "normalized-intrinsic",
			x: 0.9,
			y: 0.2,
			width: 0.3,
			height: 0.4,
			naturalWidth: 320,
			naturalHeight: 180,
		};

		const data = sharedSessionWorkspaceData(crafted);
		expect(data?.messages[0].contentFingerprint).toBe(contentFingerprint(data?.messages[0].text ?? ""));
		expect(data?.annotations[0].target).toMatchObject({ kind: "message", messageId: "turn-1" });
		expect(data?.annotations[1].target).toMatchObject({ kind: "artifact" });
	});

	test("keeps legacy text-only shares on the legacy renderer and reports bounded omissions", () => {
		const rich = richSharedSession();
		expect(sharedSessionOmissionNotice(rich)).toEqual({
			hasOmissions: true,
			items: ["1 artifact", "1 artifact text section"],
		});
		expect(sharedSessionWorkspaceData({ ...rich, schemaVersion: 2, trajectory: undefined })).toBeNull();
		expect(sharedSessionWorkspaceData({
			...rich,
			trajectory: { ...rich.trajectory!, turns: [], artifacts: [] },
		})).toBeNull();
	});
});

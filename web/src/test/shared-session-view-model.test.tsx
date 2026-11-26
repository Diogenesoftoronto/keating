import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SharedTrajectoryWorkspace } from "../components/trajectory";
import type { SharedSession } from "../keating/shared-sessions";
import { contentFingerprint } from "../keating/trajectory-review";
import {
	sharedSessionOmissionNotice,
	sharedSessionWorkspaceData,
	sharedTurnMarkdown,
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

describe("readable shared turns", () => {
	// Synthetic turns with the shapes a real share stores: a withheld notice, a reply whose
	// links were removed for the public link, and a learner's submitted form answer.
	const withheld = "<!--keating:review=withheld-->\nKeating couldn't verify a reply after reviewing the drafts. Blocking checks: checkpoint_continued.\n\nFailure: no-approved-draft. Draft attempts: 2; completed drafts: 2.";
	const linked = "<!--keating:review=unverified-->\nFormal checks agree. ([Project statement]([remote URL omitted]); [Coverage]([remote URL omitted])) See also [remote URL omitted].";
	const answer = `<keating-learner-response version="1">\n${JSON.stringify({ version: 1, kind: "openui-action", id: "r1", submittedAt: "2026-11-26T07:18:55.283Z",
		review: { title: "Your response", summary: "1 question answered about zeta zeros.", items: [{ label: "Build the intuition", value: "All the zeros lie on one line" }] },
		payload: { kind: "canonical", type: "submit-question-group", humanFriendlyMessage: "Answered 1 questions about zeta zeros", params: {},
			document: { id: "zeta-check", lifecycle: "ephemeral", revision: 0 },
			action: { schemaVersion: 1, type: "submit-question-group", documentId: "zeta-check", documentRevision: 0, nodeId: "check", idempotencyKey: "r1",
				responses: [{ questionId: "q1", type: "choice", optionIds: ["q1-c2"], text: "" }] },
			sourceDocument: { schemaVersion: 1, id: "zeta-check", revision: 0, lifecycle: "ready", supportedSurfaces: ["web"],
				nodes: [{ type: "question-group", id: "check", topic: "zeta zeros", questions: [{ id: "q1", prompt: "What does the hypothesis claim?", kind: "choice", header: "Build the intuition",
					choices: [{ id: "q1-c1", label: "Primes are regular" }, { id: "q1-c2", label: "All the zeros lie on one line" }] }] }],
				createdAt: "2026-11-26T06:53:10.483Z", updatedAt: "2026-11-26T06:53:10.483Z" } } })}\n</keating-learner-response>`;

	test("hide review internals, show the learner's answer, and keep removed links readable", () => {
		const shown = sharedTurnMarkdown("assistant", withheld);
		expect(shown).toContain("Reply not shown");
		expect(shown).toContain("Keating couldn't verify a reply");
		for (const internal of ["<!--", "Blocking checks", "Failure:", "Draft attempts"]) expect(shown).not.toContain(internal);

		const reply = sharedTurnMarkdown("assistant", linked);
		expect(reply).toBe("Formal checks agree. (Project statement *(link removed)*; Coverage *(link removed)*) See also *(link removed)*.");

		const learner = sharedTurnMarkdown("user", answer);
		expect(learner).toContain("All the zeros lie on one line");
		expect(learner).not.toContain("keating-learner-response");
		expect(learner).not.toContain("\"payload\"");
		// A truncated envelope still renders as an answer instead of breaking the page.
		const broken = `<keating-learner-response version="1">\n${JSON.stringify({ version: 1, kind: "openui-action", id: "x", submittedAt: "2026-11-26T07:18:55.283Z",
			review: { title: "Your response", summary: "", items: [] }, payload: { kind: "canonical", type: "submit-question-group", humanFriendlyMessage: "", params: {} } })}\n</keating-learner-response>`;
		expect(sharedTurnMarkdown("user", broken)).not.toContain("keating-learner-response");
	});

	test("number visible turns in order and keep the saved text as the raw source", () => {
		const rich = richSharedSession();
		const turns = [{ role: "user", text: "Explain it" }, { role: "assistant", text: withheld }, { role: "user", text: answer }, { role: "assistant", text: linked }]
			.map((turn, index) => ({ id: `turn-${index * 3 + 1}`, ordinal: index * 3, role: turn.role, text: turn.text, contentFingerprint: contentFingerprint(turn.text) }));
		const data = sharedSessionWorkspaceData({ ...rich, trajectory: { ...rich.trajectory!, turnCount: turns.length, turns: turns as never, annotations: [], annotationCount: 0 } })!;
		expect(data.messages.map(message => message.turnNumber)).toEqual([1, 2, 3, 4]);
		expect(data.messages[2]!.text).toBe(answer);
		const html = renderToStaticMarkup(<SharedTrajectoryWorkspace data={data} chrome="page" />);
		expect(html).not.toContain("keating-learner-response");
		expect(html).not.toContain("Blocking checks");
		expect(html).not.toContain("[remote URL omitted]");
		expect(html).toContain("All the zeros lie on one line");
	});
});

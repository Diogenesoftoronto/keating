import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LearnerResponseReview } from "../components/LearnerResponseReview";
import type { LearnerResponseEnvelope } from "../keating/learner-response";

describe("learner response review", () => {
	it("shows the submitted question and answer instead of action transport metadata", () => {
		const response = {
			version: 1,
			kind: "openui-action",
			id: "response-1",
			submittedAt: "2026-08-24T04:52:45.106Z",
			review: {
				title: "Your response",
				summary: "Answered 1 questions about Synth sounds in Strudel",
				items: [{ label: "Type", value: "submit-question-group" }, { label: "Node Id", value: "check" }],
			},
			payload: {
				kind: "canonical",
				type: "submit-question-group",
				humanFriendlyMessage: "Answered 1 questions about Synth sounds in Strudel",
				params: {},
				document: { id: "synth-diagnostic", lifecycle: "ephemeral", revision: 0 },
				action: {
					schemaVersion: 1,
					type: "submit-question-group",
					documentId: "synth-diagnostic",
					documentRevision: 0,
					nodeId: "check",
					responses: [{ questionId: "question-1", type: "choice", optionIds: [], text: "I used sawtooth and piano in the tutorial." }],
					idempotencyKey: "response-1",
				},
				sourceDocument: {
					schemaVersion: 1,
					id: "synth-diagnostic",
					revision: 0,
					lifecycle: "ready",
					supportedSurfaces: ["web"],
					nodes: [{
						type: "question-group",
						id: "check",
						topic: "Synth sounds in Strudel",
						questions: [{ id: "question-1", prompt: "Which synth sounds have you tried?" }],
					}],
					createdAt: "2026-08-24T04:52:10.424Z",
					updatedAt: "2026-08-24T04:52:10.424Z",
				},
				receipt: {},
			},
		} as unknown as LearnerResponseEnvelope;

		const html = renderToStaticMarkup(<LearnerResponseReview response={response} />);
		expect(html).toContain("1 question answered about Synth sounds in Strudel.");
		expect(html).toContain("Which synth sounds have you tried?");
		expect(html).toContain("I used sawtooth and piano in the tutorial.");
		expect(html).not.toContain("Node Id");
		expect(html).not.toContain("submit-question-group");
	});
});

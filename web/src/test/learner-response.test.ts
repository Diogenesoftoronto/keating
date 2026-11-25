import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

import {
	createOpenUIActionLearnerResponse,
	createQuestionLearnerResponse,
	learnerResponseReviewMarkdown,
	learnerResponseReviewText,
	parseLearnerResponse,
	serializeLearnerResponse,
} from "../keating/learner-response";
import type { KeatingOpenUIAction } from "../keating/openui/types";
import { sessionPreview, sessionSearchText } from "../hooks/session-metadata";

const fixed = { id: "response-1", submittedAt: "2026-07-15T12:00:00.000Z" };

describe("learner response envelopes", () => {
	it("preserves complete legacy question data while exposing a concise review", () => {
		const envelope = createQuestionLearnerResponse({
			topic: "Fractions",
			answers: [{
				header: "Reasoning",
				question: "Why are the fractions equivalent?",
				answer: "Both numerator and denominator were doubled.",
				grading: "pending",
			}],
		}, fixed);
		const serialized = serializeLearnerResponse(envelope);
		const parsed = parseLearnerResponse(serialized);

		expect(parsed?.kind).toBe("question");
		if (parsed?.kind !== "question") throw new Error("expected question response");
		expect(parsed.payload.answers[0]).toEqual({
			header: "Reasoning",
			question: "Why are the fractions equivalent?",
			answer: "Both numerator and denominator were doubled.",
			grading: "pending",
		});
		expect(parsed.agentInstruction).toContain("grade_question_checks");
		expect(learnerResponseReviewText(serialized)).toBe([
			"Your response",
			"Answer submitted for Fractions.",
			"Reasoning: Both numerator and denominator were doubled.",
		].join("\n"));
		expect(learnerResponseReviewText(serialized)).not.toContain("agentInstruction");
	});

	it("turns OpenUI questions into the same durable question response", () => {
		const envelope = createOpenUIActionLearnerResponse({
			type: "continue_conversation",
			humanFriendlyMessage: "Here are my answers.",
			params: {
				interaction: "question",
				topic: "Gravity",
				answers: [{ question: "What accelerates?", answer: "The object", grading: "pending" }],
			},
			formState: { confidence: 3 },
			document: { id: "gravity-check", lifecycle: "resumable", revision: 0 },
		}, fixed);

		expect(envelope.kind).toBe("question");
		if (envelope.kind !== "question") throw new Error("expected question response");
		expect(envelope.payload.source).toBe("openui");
		expect(envelope.payload.document).toEqual({ id: "gravity-check", lifecycle: "resumable", revision: 0 });
	});

	it("keeps complete OpenUI action data but renders only useful quiz results", () => {
		const envelope = createOpenUIActionLearnerResponse({
			type: "continue_conversation",
			humanFriendlyMessage: "I finished the quiz.",
			params: {
				interaction: "quiz",
				topic: "Cells",
				score: 4,
				total: 5,
				answers: { q1: "mitochondria" },
				flagged: ["q3"],
			},
			formState: { confidence: { q1: 4 } },
			document: { id: "cells-quiz", lifecycle: "resumable", revision: 0 },
		}, fixed);
		const serialized = serializeLearnerResponse(envelope);

		expect(parseLearnerResponse(serialized)).toEqual(envelope);
		expect(learnerResponseReviewText(serialized)).toBe([
			"Quiz completed",
			"Results saved for Cells.",
			"Score: 4 of 5",
			"Marked for review: 1",
		].join("\n"));
		expect(learnerResponseReviewText(serialized)).not.toContain("mitochondria");
	});

	it("keeps exact timing and timeout evidence in the learner response", () => {
		const timing = { totalMs: 64_238, perQuestionMs: { q1: 4_238, q2: 30_000 } };
		const envelope = createOpenUIActionLearnerResponse({
			type: "complete-quiz", humanFriendlyMessage: "Completed the exam.",
			params: { timing, timedOutQuestionIds: ["q2"], examTimedOut: true, answers: [], score: 0 },
			formState: {}, document: { id: "timed-check", lifecycle: "resumable", revision: 0 },
		}, fixed);
		const restored = parseLearnerResponse(serializeLearnerResponse(envelope));
		expect(restored?.kind).toBe("openui-action");
		if (restored?.kind !== "openui-action") throw new Error("expected action response");
		expect(restored.payload.params.timing).toEqual(timing);
		expect(restored.review.items).toContainEqual({ label: "Total time", value: "1:04.238" });
		expect(restored.review.items).toContainEqual({ label: "Timed out", value: "q2" });
		expect(restored.review.items).toContainEqual({ label: "Exam timer", value: "Time limit reached" });
	});

	it("renders canonical question-group submissions as the learner's actual answer", () => {
		const action = {
			kind: "canonical",
			type: "submit-question-group",
			humanFriendlyMessage: "Answered 1 questions about Synth sounds in Strudel",
			params: { type: "submit-question-group", nodeId: "check" },
			document: { id: "synth-diagnostic", lifecycle: "ephemeral", revision: 0 },
			action: {
				schemaVersion: 1,
				type: "submit-question-group",
				documentId: "synth-diagnostic",
				documentRevision: 0,
				nodeId: "check",
				responses: [{ questionId: "check-question-1", type: "choice", optionIds: [], text: "I used sawtooth and piano in the tutorial." }],
				idempotencyKey: "web-ui-1",
			},
			sourceDocument: {
				schemaVersion: 1,
				id: "synth-diagnostic",
				revision: 0,
				lifecycle: "ready",
				retention: "ephemeral",
				supportedSurfaces: ["web"],
				title: "Quick check",
				nodes: [{
					type: "question-group",
					id: "check",
					topic: "Synth sounds in Strudel",
					questions: [{ id: "check-question-1", prompt: "Which synth sounds have you tried?", kind: "choice", choices: [] }],
				}],
				createdAt: fixed.submittedAt,
				updatedAt: fixed.submittedAt,
			},
			receipt: {},
		} as unknown as KeatingOpenUIAction;
		const envelope = createOpenUIActionLearnerResponse(action, fixed);
		// Simulate an older stored envelope whose generic review omitted the nested answers.
		envelope.review = {
			title: "Your response",
			summary: action.humanFriendlyMessage,
			items: [{ label: "Type", value: "submit-question-group" }, { label: "Node Id", value: "check" }],
		};
		const serialized = serializeLearnerResponse(envelope);

		expect(learnerResponseReviewText(serialized)).toBe([
			"Your response",
			"1 question answered about Synth sounds in Strudel.",
			"Which synth sounds have you tried?: I used sawtooth and piano in the tutorial.",
		].join("\n"));
		expect(learnerResponseReviewMarkdown(serialized)).toContain("**Which synth sounds have you tried?**");
		expect(learnerResponseReviewMarkdown(serialized)).not.toContain("Node Id");
	});

	it("parses answers containing the envelope closing tag", () => {
		const envelope = createQuestionLearnerResponse({
			answers: [{
				question: "What did you type?",
				answer: "The literal text </keating-learner-response>.",
				grading: "pending",
			}],
		}, fixed);
		expect(parseLearnerResponse(serializeLearnerResponse(envelope))).toEqual(envelope);
	});

	it("indexes the readable review rather than the structured transport", () => {
		const serialized = serializeLearnerResponse(createQuestionLearnerResponse({
			answers: [{ question: "What changed?", answer: "The slope increased.", grading: "auto", score: 1 }],
		}, fixed));
		const message = {
			role: "user",
			content: [{ type: "text", text: serialized }],
			timestamp: Date.now(),
		} as unknown as AgentMessage;

		expect(sessionPreview([message])).toContain("What changed?: The slope increased.");
		expect(sessionSearchText([message])).not.toContain("keating-learner-response");
		expect(sessionSearchText([message])).not.toContain("agentInstruction");
	});

	it("reviews a shared interactive reply by what the learner did, keeping the analysis advisory", () => {
		const share = {
			learner: "I solved it: x = 4.",
			data: "Moved 2x left (sign flipped), moved 3 right, divided by 2. Ended at x = 4.",
			analysis: "x = 4. Every move was legal; the sign flip was automatic.",
		};
		const action = {
			kind: "canonical",
			type: "share-interactive",
			humanFriendlyMessage: share.learner,
			params: { type: "share-interactive", nodeId: "reply" },
			document: { id: "solve-it", lifecycle: "ephemeral", revision: 0 },
			action: { schemaVersion: 1, type: "share-interactive", documentId: "solve-it", documentRevision: 0, nodeId: "reply", kind: "equation", share, idempotencyKey: "web-ui-2" },
			sourceDocument: {
				schemaVersion: 1, id: "solve-it", revision: 0, lifecycle: "ready", retention: "ephemeral", supportedSurfaces: ["web"], title: "Solve it",
				nodes: [{ type: "interactive", id: "reply", kind: "equation", title: "Solve 4x + 3 = 2x + 11", config: { expression: "4x + 3 = 2x + 11", goal: "isolate" } }],
				createdAt: fixed.submittedAt, updatedAt: fixed.submittedAt,
			},
			receipt: {},
		} as unknown as KeatingOpenUIAction;
		const envelope = createOpenUIActionLearnerResponse(action, fixed);

		expect(envelope.review).toEqual({
			title: "Equation workbench shared",
			summary: share.learner,
			items: [{ label: "Activity", value: "Solve 4x + 3 = 2x + 11" }, { label: "What they did", value: share.data }],
		});
		// The tutor sees the analysis in the payload, but the learner-facing review does not repeat it.
		expect(JSON.stringify(envelope.review)).not.toContain(share.analysis);
		expect(envelope.agentInstruction).toContain("equation workbench");
		expect(envelope.agentInstruction).toContain("share.analysis is the component's own advisory reading");
		expect(envelope.agentInstruction).toContain("do not repeat it verbatim");
		const restored = parseLearnerResponse(serializeLearnerResponse(envelope));
		expect(restored && learnerResponseReviewText(serializeLearnerResponse(restored))).toBe([
			"Equation workbench shared", share.learner, "Activity: Solve 4x + 3 = 2x + 11", `What they did: ${share.data}`,
		].join("\n"));
	});

	it("still reviews a share whose node is missing from the source document", () => {
		const share = { learner: "Sorted them.", data: "3 of 4 rocks in the right bin.", analysis: "Pumice is igneous." };
		const action = {
			kind: "canonical", type: "share-interactive", humanFriendlyMessage: share.learner, params: {},
			document: { id: "rocks", lifecycle: "ephemeral", revision: 0 },
			action: { schemaVersion: 1, type: "share-interactive", documentId: "rocks", documentRevision: 0, nodeId: "gone", kind: "sort-board", share, idempotencyKey: "web-ui-3" },
			sourceDocument: { schemaVersion: 1, id: "rocks", revision: 0, lifecycle: "ready", retention: "ephemeral", supportedSurfaces: ["web"], nodes: [], createdAt: fixed.submittedAt, updatedAt: fixed.submittedAt },
			receipt: {},
		} as unknown as KeatingOpenUIAction;
		const envelope = createOpenUIActionLearnerResponse(action, fixed);
		expect(envelope.review.title).toBe("Sort board shared");
		expect(envelope.review.items).toEqual([{ label: "What they did", value: share.data }]);
	});

	it("leaves ordinary learner messages untouched", () => {
		expect(parseLearnerResponse("I think the slope increased.")).toBeNull();
		expect(learnerResponseReviewText("I think the slope increased.")).toBe("I think the slope increased.");
	});
});

import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

import {
	createOpenUIActionLearnerResponse,
	createQuestionLearnerResponse,
	learnerResponseReviewText,
	parseLearnerResponse,
	serializeLearnerResponse,
} from "../keating/learner-response";
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

	it("leaves ordinary learner messages untouched", () => {
		expect(parseLearnerResponse("I think the slope increased.")).toBeNull();
		expect(learnerResponseReviewText("I think the slope increased.")).toBe("I think the slope increased.");
	});
});

import { describe, expect, it } from "bun:test";
import type { SessionData } from "../types/session";
import { buildInsertedReviewSession } from "../keating/trajectory-session";
import { messageReviewAnchor, type ReviewGenerationCandidate } from "../keating/trajectory-review";

const source = {
	id: "session-1",
	title: "Fractions",
	model: { provider: "old", id: "old-model", name: "Old", api: "openai-completions" },
	thinkingLevel: "off",
	messages: [
		{ role: "user", content: [{ type: "text", text: "Why invert?" }], timestamp: 10 },
		{ role: "assistant", content: [{ type: "text", text: "Just memorize it." }], timestamp: 20 },
		{ role: "user", content: [{ type: "text", text: "I still do not understand." }], timestamp: 30 },
	],
	createdAt: "2026-08-23T00:00:00.000Z",
	lastModified: "2026-08-23T00:00:00.000Z",
} as SessionData;

const candidate = {
	schemaVersion: 1,
	id: "candidate-1",
	reviewId: "review:session-1",
	sessionId: "session-1",
	target: { kind: "response", messageId: "ignored-because-timestamp-is-present", messageTimestamp: 20, originalContent: "Just memorize it." },
	targetKey: "message:1",
	poolId: "pool-1",
	model: {
		provider: "new", id: "teacher", name: "Teacher", api: "openai-completions", baseUrl: "https://models.test/v1",
		reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 10_000, maxTokens: 1_000,
	},
	prompt: "Improve it",
	annotationIds: [],
	state: "completed",
	content: "Picture two halves fitting into one whole. What operation would undo dividing by two?",
	preferred: true,
	usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 },
	createdAt: 1,
	updatedAt: 1,
} satisfies ReviewGenerationCandidate;

describe("review response insertion", () => {
	it("creates a visible fork at the reviewed turn and preserves the source", () => {
		const revision = buildInsertedReviewSession(source, candidate, "2026-08-23T01:00:00.000Z", "revision-1");
		expect(revision.data.parentSessionId).toBe("session-1");
		expect(revision.data.messages).toHaveLength(2);
		expect((revision.data.messages[1] as any).content[0].text).toContain("two halves");
		expect(revision.data.model.provider).toBe("new");
		expect(revision.metadata.hiddenAlternative).toBeUndefined();
		expect((source.messages[1] as any).content[0].text).toBe("Just memorize it.");
	});

	it("rejects artifact and incomplete candidates", () => {
		expect(() => buildInsertedReviewSession(source, { ...candidate, state: "failed" }, "2026-08-23T01:00:00.000Z", "x")).toThrow();
		expect(() => buildInsertedReviewSession(source, {
			...candidate,
			target: {
				kind: "artifact",
				artifact: { source: { source: "indexeddb", store: "lesson-plans", id: "p" }, artifactType: "plan", format: "markdown", versionId: "v1", contentHash: "sha256:x", frozen: true },
				topic: "fractions",
				originalContent: "# Plan",
			},
		} as ReviewGenerationCandidate, "2026-08-23T01:00:00.000Z", "x")).toThrow();
	});

	it("uses the stable message id before a colliding timestamp", () => {
		const collisionSource = {
			...source,
			messages: [
				{ role: "user", content: [{ type: "text", text: "Compare these." }], timestamp: 10 },
				{ role: "assistant", content: [{ type: "text", text: "First explanation." }], timestamp: 20 },
				{ role: "assistant", content: [{ type: "text", text: "Second explanation." }], timestamp: 20 },
			],
		} as SessionData;
		const targetMessage = collisionSource.messages[2];
		const targetId = messageReviewAnchor(collisionSource.id, targetMessage, 2).id;
		const revision = buildInsertedReviewSession(collisionSource, {
			...candidate,
			target: {
				kind: "response",
				messageId: targetId,
				messageTimestamp: 20,
				originalContent: "Second explanation.",
			},
		}, "2026-08-23T01:00:00.000Z", "revision-collision");

		expect(revision.data.messages).toHaveLength(3);
		expect((revision.data.messages[1] as any).content[0].text).toBe("First explanation.");
		expect((revision.data.messages[2] as any).content[0].text).toContain("two halves");
	});

	it("rejects an ambiguous timestamp and content fallback", () => {
		const ambiguousSource = {
			...source,
			messages: [
				{ role: "assistant", content: [{ type: "text", text: "Same" }], timestamp: 20 },
				{ role: "assistant", content: [{ type: "text", text: "Same" }], timestamp: 20 },
			],
		} as SessionData;
		expect(() => buildInsertedReviewSession(ambiguousSource, {
			...candidate,
			target: { kind: "response", messageId: "stale", messageTimestamp: 20, originalContent: "Same" },
		}, "2026-08-23T01:00:00.000Z", "ambiguous")).toThrow("no longer present");
	});
});

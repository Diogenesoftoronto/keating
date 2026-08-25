import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai/compat";
import {
	contentFingerprint,
	createTextAnchor,
	defaultReviewModelPools,
	messageReviewAnchor,
	reanchorText,
	reviewTargetKey,
	sha256ContentHash,
} from "../keating/trajectory-review";

describe("trajectory review anchors", () => {
	it("builds stable message ids and exact text anchors", () => {
		const message = {
			role: "assistant",
			timestamp: 42,
			content: [{ type: "text", text: "Start with the learner's current model." }],
		} as AgentMessage;
		const first = messageReviewAnchor("session-a", message, 2);
		const second = messageReviewAnchor("session-a", message, 2);
		expect(first).toEqual(second);
		expect(first.text).toBe("Start with the learner's current model.");

		const anchor = createTextAnchor(first.text, 15, 22);
		expect(anchor.quote).toBe("learner");
		expect(reanchorText(first.text, anchor)).toEqual({
			status: "exact",
			start: 15,
			end: 22,
		});
		expect(
			reviewTargetKey({
				kind: "message-span",
				messageId: first.id,
				role: "assistant",
				anchor,
			}),
		).toContain("span:15-22");
	});

	it("recovers a moved quote and detects a stale quote", () => {
		const source = "Diagnose first. Then give one small hint.";
		const anchor = createTextAnchor(
			source,
			source.indexOf("one small hint"),
			source.indexOf("one small hint") + "one small hint".length,
		);
		const moved = "Begin with the learner. Diagnose first. Then give one small hint.";
		expect(reanchorText(moved, anchor)).toEqual({
			status: "moved",
			start: moved.indexOf("one small hint"),
			end: moved.indexOf("one small hint") + "one small hint".length,
		});
		expect(reanchorText("The advice was removed.", anchor).status).toBe("stale");
	});

	it("creates task-specific model pools without storing credentials", () => {
		const model = {
			provider: "provider-a",
			id: "teacher-1",
			name: "Teacher 1",
			api: "openai-completions",
			baseUrl: "https://reviewer:secret@models.test/v1?api_key=hidden",
			reasoning: true,
			input: ["text"],
			cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128_000,
			maxTokens: 8_192,
		} as Model<any>;
		const pools = defaultReviewModelPools(model, 10);
		expect(pools).toHaveLength(3);
		expect(pools[0].tasks).toEqual(["response"]);
		expect(pools[0].models[0]).not.toHaveProperty("apiKey");
		expect(pools[0].models[0].provider).toBe("provider-a");
		expect(pools[0].models[0].baseUrl).toBe("https://models.test/v1");
		expect(contentFingerprint("same")).toBe(contentFingerprint("same"));
	});

	it("pins namespaced artifact versions with a cryptographic content hash", async () => {
		const contentHash = await sha256ContentHash("# Frozen lesson");
		const targetKey = reviewTargetKey({
			kind: "artifact",
			artifact: {
				source: { source: "course", courseId: "course-1", id: "artifact-1" },
				artifactType: "plan",
				format: "markdown",
				versionId: "revision-3",
				contentHash,
				frozen: true,
			},
		});
		expect(contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(targetKey).toContain("course:course-1:artifact-1:revision-3");
	});
});

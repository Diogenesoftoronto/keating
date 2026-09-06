import { describe, expect, test } from "bun:test";

import { buildLiveSessionContext, safeLiveContextText } from "../src/keating/live-context";
import type { KeatingStorage } from "../src/keating/storage";

describe("live learner context", () => {
	test("redacts provider secrets and private keys", () => {
		expect(safeLiveContextText("token aabbccddeeff00112233445566778899")).toBe("token [REDACTED]");
		expect(safeLiveContextText("OPENAI_API_KEY=sk-exampleabcdefghijklmnop")).toBe("[REDACTED]");
	});

	test("collects the active learner, uploaded documents, and current-session artifacts", async () => {
		const storage = {
			getLearnerState: async () => ({
				strengths: ["calculus"],
				weaknesses: ["matrix geometry"],
				topicsExplored: ["derivatives", "matrices"],
				studyPriorities: [{ targetType: "topic", targetId: "eigenvectors", priority: "focus" }],
			}),
			getLessonPlans: async () => [
				{ id: "p1", topic: "Eigenvectors", content: "Start from invariant directions.", createdAt: 2, updatedAt: 2, sessionId: "active" },
				{ id: "p2", topic: "Unrelated", content: "Do not include.", createdAt: 3, updatedAt: 3, sessionId: "other" },
			],
			getLessonMaps: async () => [],
			getAnimations: async () => [],
			getVerifications: async () => [],
			getDecks: async () => [],
		} as unknown as KeatingStorage;
		const context = await buildLiveSessionContext({
			storage,
			sessionId: "active",
			providedProfile: "Call me Ada. API_KEY=aabbccddeeff00112233445566778899",
			messages: [{
				role: "user-with-attachments",
				attachments: [{
					fileName: "matrix-notes.pdf",
					mimeType: "application/pdf",
					extractedText: "Eigenvectors keep their direction under a linear map.",
				}],
			}],
		});
		expect(context.learner.strengths).toEqual(["calculus"]);
		expect(context.learner.providedProfile).toContain("[REDACTED]");
		expect(context.documents).toEqual([{
			title: "matrix-notes.pdf",
			kind: "application/pdf",
			excerpt: "Eigenvectors keep their direction under a linear map.",
			source: "session",
		}]);
		expect(context.artifacts).toHaveLength(1);
		expect(context.artifacts[0]?.title).toBe("Eigenvectors");
	});
});

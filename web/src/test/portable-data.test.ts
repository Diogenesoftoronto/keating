import { describe, expect, it } from "bun:test";

import {
	buildKeatingPortableDataBundleFromSources,
	parseKeatingPortableDataBundle,
} from "../keating/portable-data";
import { mergeFeedbackById, type KeatingStoragePortableData } from "../keating/storage";
import type { SessionData, SessionMetadata } from "../types/session";

function emptyPortableStorage(overrides: Partial<KeatingStoragePortableData> = {}): KeatingStoragePortableData {
	return {
		lessonPlans: [],
		lessonMaps: [],
		animations: [],
		verifications: [],
		benchmarks: [],
		evolutions: [],
		policies: [],
		feedback: [],
		learnerState: {
			topicsExplored: [],
			feedbackHistory: [],
			strengths: [],
			weaknesses: [],
			topicProfiles: [],
			sessionsCount: 0,
			sessions: [],
		},
		promptEvolutions: [],
		improvements: [],
		goals: [],
		quizResults: [],
		decks: [],
		cardReviews: [],
		questionChecks: [],
		...overrides,
	};
}

describe("portable Keating data bundle", () => {
	it("preserves session data and recomputes metadata fields from messages", () => {
		const session: SessionData = {
			id: "s1",
			title: "Derivative lesson",
			model: {} as never,
			thinkingLevel: "medium",
			createdAt: "2026-06-01T00:00:00.000Z",
			lastModified: "2026-06-01T00:05:00.000Z",
			messages: [
				{ role: "user", content: "Teach derivatives." },
				{ role: "assistant", content: "A derivative measures local change." },
			] as never,
		};
		const metadata: SessionMetadata = {
			id: "s1",
			title: "Derivative lesson",
			createdAt: session.createdAt,
			lastModified: session.lastModified,
			messageCount: 99,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			thinkingLevel: "medium",
			preview: "old preview",
		};

		const bundle = buildKeatingPortableDataBundleFromSources({
			generatedAt: "2026-06-10T00:00:00.000Z",
			sessions: [{ data: session, metadata }],
			storage: emptyPortableStorage({
			feedback: [{ id: "f1", topic: "Derivative", signal: "thumbs-up", createdAt: 1 }],
			questionChecks: [{ id: "c1", topic: "Derivative", question: "What is a derivative?", answer: "Rate of change", score: 1, grading: "auto", createdAt: 2 }],
			}),
		});

		expect(bundle.kind).toBe("keating-portable-data");
		expect(bundle.sessions[0].data).toEqual(session);
		expect(bundle.sessions[0].metadata.messageCount).toBe(2);
		expect(bundle.storage.feedback[0].id).toBe("f1");
		expect(bundle.storage.questionChecks[0]?.grading).toBe("auto");
		expect(parseKeatingPortableDataBundle(bundle)).toBe(bundle);
	});

	it("rejects unsupported bundle shapes", () => {
		expect(() => parseKeatingPortableDataBundle({ kind: "keating-finetune", schemaVersion: 1 })).toThrow("Unsupported Keating portable data bundle");
		expect(() => parseKeatingPortableDataBundle(null)).toThrow("Unsupported Keating portable data bundle");
	});

	it("round-trips feedback attribution fields and merges feedback by id", () => {
		const feedback = {
			id: "f1",
			topic: "Derivative",
			signal: "thumbs-up" as const,
			createdAt: 1,
			sessionId: "s1",
			messageId: "assistant-0-2000",
			topicSource: "session-title" as const,
			referent: {
				sessionId: "s1",
				messageId: "assistant-0-2000",
				content: "A derivative measures local change.",
				createdAt: 2000,
			},
		};
		const bundle = buildKeatingPortableDataBundleFromSources({
			generatedAt: "2026-06-10T00:00:00.000Z",
			sessions: [],
			storage: emptyPortableStorage({ feedback: [feedback] }),
		});
		expect(parseKeatingPortableDataBundle(bundle).storage.feedback[0]).toEqual(feedback);
		expect(mergeFeedbackById(
			[{ ...feedback, evidence: "old" }],
			[{ ...feedback, evidence: "new" }],
			[{ id: "f2", topic: "Derivative", signal: "confused", createdAt: 2 }],
		)).toEqual([
			{ ...feedback, evidence: "new" },
			{ id: "f2", topic: "Derivative", signal: "confused", createdAt: 2 },
		]);
	});
});

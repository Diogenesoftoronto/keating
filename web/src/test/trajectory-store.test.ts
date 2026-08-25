import { describe, expect, it } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import {
	TRAJECTORY_REVIEW_SCHEMA_VERSION,
	createReviewRecordId,
	reviewTargetKey,
	type ReviewGenerationCandidate,
	type TrajectoryAnnotation,
} from "../keating/trajectory-review";
import { TrajectoryReviewStore } from "../keating/trajectory-store";

describe("trajectory review storage", () => {
	it("persists annotations, pools, candidates, and an atomic preference", async () => {
		const store = new TrajectoryReviewStore({ indexedDB: new IDBFactory(), databaseName: "review-test" });
		const review = await store.getOrCreateReview("session-1", 1);
		const target = {
			kind: "message" as const,
			messageId: "message-1",
			role: "assistant",
			contentFingerprint: "abc",
		};
		const targetKey = reviewTargetKey(target);
		const annotation: TrajectoryAnnotation = {
			schemaVersion: TRAJECTORY_REVIEW_SCHEMA_VERSION,
			id: createReviewRecordId("annotation"),
			reviewId: review.id,
			sessionId: review.sessionId,
			target,
			targetKey,
			kind: "problem",
			category: "scaffolding",
			severity: 3,
			note: "The response supplied the answer before checking the learner's model.",
			status: "draft",
			createdAt: 2,
			updatedAt: 2,
		};
		await store.saveAnnotation(annotation, 2);
		await store.saveArtifactVersion({
			schemaVersion: TRAJECTORY_REVIEW_SCHEMA_VERSION,
			id: "artifact-version-1",
			reviewId: review.id,
			sessionId: review.sessionId,
			artifact: {
				source: { source: "indexeddb", store: "lesson-plans", id: "plan-1" },
				artifactType: "plan",
				format: "markdown",
				versionId: "plan-1:1",
				contentHash: "sha256:abc",
				frozen: true,
			},
			label: "Plan: recursion",
			topic: "recursion",
			content: "# Recursion",
			createdAt: 1,
			capturedAt: 2,
		});

		const model = {
			provider: "test",
			id: "model",
			name: "Model",
			api: "openai-completions",
			baseUrl: "https://models.test/v1",
			reasoning: false,
			input: ["text" as const],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 8_192,
			maxTokens: 2_048,
		};
		await store.saveModelPool({
			schemaVersion: TRAJECTORY_REVIEW_SCHEMA_VERSION,
			id: "pool",
			name: "Tutor responses",
			tasks: ["response"],
			models: [model],
			candidateCount: 99,
			temperature: 5,
			maxTokens: 2_048,
			createdAt: 3,
			updatedAt: 3,
		}, 3);
		expect((await store.listModelPools())[0]).toMatchObject({ candidateCount: 8, temperature: 2 });

		const candidate = (id: string, content: string): ReviewGenerationCandidate => ({
			schemaVersion: TRAJECTORY_REVIEW_SCHEMA_VERSION,
			id,
			reviewId: review.id,
			sessionId: review.sessionId,
			target: { kind: "response", messageId: "message-1", originalContent: "Original" },
			targetKey,
			poolId: "pool",
			model,
			prompt: "Improve the response.",
			annotationIds: [annotation.id],
			state: "completed",
			content,
			preferred: false,
			createdAt: 4,
			updatedAt: 4,
		});
		await store.saveCandidate(candidate("candidate-a", "First"), 4);
		await store.saveCandidate(candidate("candidate-b", "Second"), 5);
		const choice = await store.chooseCandidate(review, "candidate-b", 6);
		expect(choice.review.selectedCandidateIds[targetKey]).toBe("candidate-b");
		expect(choice.candidates.filter((entry) => entry.preferred).map((entry) => entry.id)).toEqual(["candidate-b"]);
		const materialized = await store.saveCandidate({ ...candidate("candidate-b", "Second"), insertedSessionId: "revision-1" }, 7);
		expect(materialized.preferred).toBe(true);
		const rechoice = await store.chooseCandidate(choice.review, "candidate-a", 8);
		expect(rechoice.candidates.filter((entry) => entry.preferred).map((entry) => entry.id)).toEqual(["candidate-a"]);
		const staleChosenUpdate = await store.saveCandidate({
			...choice.candidates.find((entry) => entry.id === "candidate-b")!,
			materializedArtifactId: "artifact-revision-1",
		}, 9);
		expect(staleChosenUpdate.preferred).toBe(false);
		const staleFormSave = await store.saveReview({ ...review, summary: "Reviewer notes", selectedCandidateIds: {} }, 10);
		expect(staleFormSave.selectedCandidateIds[targetKey]).toBe("candidate-a");

		const snapshot = await store.exportSnapshot(review.id);
		expect(snapshot.annotations).toHaveLength(1);
		expect(snapshot.candidates).toHaveLength(2);
		expect(snapshot.modelPools.map((pool) => pool.id)).toEqual(["pool"]);
		expect(snapshot.artifacts.map((artifact) => artifact.id)).toEqual(["artifact-version-1"]);
		await expect(store.deleteModelPool("pool")).rejects.toThrow("retained for provenance");
		await store.saveModelPool({
			...(await store.listModelPools())[0],
			id: "unused-pool",
			name: "Unused",
		}, 11);
		await store.deleteModelPool("unused-pool");
		expect((await store.listModelPools()).map((pool) => pool.id)).toEqual(["pool"]);
		store.close();
	});
});

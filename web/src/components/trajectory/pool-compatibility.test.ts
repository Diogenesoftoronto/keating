import { describe, expect, test } from "bun:test";
import {
	TRAJECTORY_REVIEW_SCHEMA_VERSION,
	type ReviewGenerationTask,
	type ReviewModelPool,
	type StoredModelReference,
} from "../../keating/trajectory-review";
import {
	REVIEW_TASK_OPTIONS,
	artifactReviewTask,
	compatibleReviewModelPools,
	resolveCompatiblePoolId,
	reviewPoolGenerationAvailability,
} from "./pool-compatibility";

function model(provider: string, id: string): StoredModelReference {
	return {
		provider,
		id,
		name: id,
		api: `${provider}-api`,
		baseUrl: `https://${provider}.example`,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8_192,
		maxTokens: 2_048,
	};
}

function pool(id: string, tasks: ReviewGenerationTask[], models: StoredModelReference[] = []): ReviewModelPool {
	return {
		schemaVersion: TRAJECTORY_REVIEW_SCHEMA_VERSION,
		id,
		name: id,
		tasks,
		models,
		candidateCount: 3,
		temperature: 0.7,
		maxTokens: 2_048,
		createdAt: 1,
		updatedAt: 1,
	};
}

describe("trajectory review model-pool compatibility", () => {
	const responsePool = pool("responses", ["response"]);
	const artifactPool = pool("artifacts", ["artifact:animation", "artifact:map"]);
	const documentPool = pool("documents", ["artifact:document"]);
	const pools = [responsePool, artifactPool, documentPool];

	test("keeps text-backed artifact tasks and excludes native media", () => {
		expect(artifactReviewTask("animation")).toBe("artifact:animation");
		expect(artifactReviewTask("document")).toBe("artifact:document");
		expect(artifactReviewTask("image")).toBeNull();
		expect(artifactReviewTask("video")).toBeNull();
		expect(artifactReviewTask("audio")).toBeNull();
	});

	test("shows only pools compatible with the active task", () => {
		expect(compatibleReviewModelPools(pools, "response").map((entry) => entry.id)).toEqual(["responses"]);
		expect(compatibleReviewModelPools(pools, "artifact:animation").map((entry) => entry.id)).toEqual(["artifacts"]);
		expect(compatibleReviewModelPools(pools, "artifact:quiz")).toEqual([]);
	});

	test("keeps a compatible selection and replaces an incompatible one", () => {
		expect(resolveCompatiblePoolId(pools, "artifact:animation", "artifacts")).toBe("artifacts");
		expect(resolveCompatiblePoolId(pools, "artifact:document", "responses")).toBe("documents");
		expect(resolveCompatiblePoolId(pools, "artifact:quiz", "responses")).toBeUndefined();
	});

	test("does not expose native media as materializable pool tasks", () => {
		const tasks = REVIEW_TASK_OPTIONS.map((option) => option.value);
		expect(tasks).toContain("artifact:animation");
		expect(tasks).not.toContain("artifact:image");
		expect(tasks).not.toContain("artifact:video");
		expect(tasks).not.toContain("artifact:audio");
	});

	test("requires every exact provider and model id to remain in the catalog", () => {
		const openaiModel = model("openai", "shared-id");
		const anthropicModel = model("anthropic", "shared-id");
		const secondOpenaiModel = model("openai", "second-id");
		const reviewPool = pool("catalog-guard", ["response"], [openaiModel, secondOpenaiModel]);

		const wrongProvider = reviewPoolGenerationAvailability(reviewPool, "response", [anthropicModel, secondOpenaiModel]);
		expect(wrongProvider.ready).toBe(false);
		expect(wrongProvider.unavailableModels.map((entry) => `${entry.provider}/${entry.id}`)).toEqual(["openai/shared-id"]);

		const complete = reviewPoolGenerationAvailability(reviewPool, "response", [openaiModel, secondOpenaiModel]);
		expect(complete.ready).toBe(true);
		expect(complete.unavailableModels).toEqual([]);
	});

	test("rejects empty and task-incompatible pools even when the catalog is present", () => {
		const available = model("browser", "local-model");
		expect(reviewPoolGenerationAvailability(pool("empty", ["response"]), "response", [available]).ready).toBe(false);
		expect(reviewPoolGenerationAvailability(pool("wrong-task", ["artifact:image"], [available]), "response", [available]).ready).toBe(false);
	});
});

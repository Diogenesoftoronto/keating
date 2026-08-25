import type {
	ArtifactReviewKind,
	ReviewGenerationTask,
	ReviewModelPool,
	StoredModelReference,
} from "../../keating/trajectory-review";

export const REVIEW_TASK_OPTIONS: ReadonlyArray<{ value: ReviewGenerationTask; label: string }> = [
	{ value: "response", label: "Tutor responses" },
	{ value: "artifact:plan", label: "Plans" },
	{ value: "artifact:map", label: "Maps" },
	{ value: "artifact:animation", label: "Animations" },
	{ value: "artifact:quiz", label: "Quizzes" },
	{ value: "artifact:verification", label: "Verifications" },
	{ value: "artifact:deck", label: "Decks" },
	{ value: "artifact:benchmark", label: "Benchmarks" },
	{ value: "artifact:evolution", label: "Evolution" },
	{ value: "artifact:prompt-evolution", label: "Prompt evolution" },
	{ value: "artifact:document", label: "Documents" },
	{ value: "artifact:openui", label: "OpenUI" },
	{ value: "artifact:other", label: "Other" },
];

export function artifactReviewTask(kind: ArtifactReviewKind): ReviewGenerationTask | null {
	if (kind === "image" || kind === "video" || kind === "audio") return null;
	return `artifact:${kind}`;
}

export function compatibleReviewModelPools(
	pools: readonly ReviewModelPool[],
	task: ReviewGenerationTask,
): ReviewModelPool[] {
	return pools.filter((pool) => pool.tasks.includes(task));
}

export interface ReviewPoolGenerationAvailability {
	taskCompatible: boolean;
	hasModels: boolean;
	unavailableModels: StoredModelReference[];
	ready: boolean;
}

export function unavailableReviewPoolModels(
	pool: ReviewModelPool,
	availableModels: readonly StoredModelReference[],
): StoredModelReference[] {
	return pool.models.filter((model) => !availableModels.some((available) =>
		available.provider === model.provider && available.id === model.id,
	));
}

export function reviewPoolGenerationAvailability(
	pool: ReviewModelPool,
	task: ReviewGenerationTask,
	availableModels: readonly StoredModelReference[],
): ReviewPoolGenerationAvailability {
	const taskCompatible = pool.tasks.includes(task);
	const hasModels = pool.models.length > 0;
	const unavailableModels = unavailableReviewPoolModels(pool, availableModels);
	return {
		taskCompatible,
		hasModels,
		unavailableModels,
		ready: taskCompatible && hasModels && unavailableModels.length === 0,
	};
}

export function resolveCompatiblePoolId(
	pools: readonly ReviewModelPool[],
	task: ReviewGenerationTask,
	activePoolId?: string,
): string | undefined {
	const compatible = compatibleReviewModelPools(pools, task);
	if (activePoolId && compatible.some((pool) => pool.id === activePoolId)) return activePoolId;
	return compatible[0]?.id;
}

export function reviewTaskLabel(task: ReviewGenerationTask): string {
	return REVIEW_TASK_OPTIONS.find((option) => option.value === task)?.label ?? task.replace("artifact:", "");
}

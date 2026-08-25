import { describe, expect, it } from "bun:test";
import {
	initialReviewWorkspaceUiState,
	reviewWorkspaceUiReducer,
} from "../keating/trajectory-review-ui-state";
import { createReviewRecord } from "../keating/trajectory-review";

describe("trajectory review workspace reducer", () => {
	it("owns source selection and clears stale annotation state", () => {
		let state = reviewWorkspaceUiReducer(initialReviewWorkspaceUiState, { type: "reset", sessionId: "session-1" });
		state = reviewWorkspaceUiReducer(state, {
			type: "hydrate",
			turnId: "turn-1",
			turnTargetKey: "message:turn-1",
			artifactId: "artifact-1",
			poolId: "pool-1",
		});
		state = reviewWorkspaceUiReducer(state, {
			type: "open-annotation",
			generationTargetKey: "message:turn-1",
			sourceId: "turn-1",
			draft: {
				target: { kind: "message", messageId: "turn-1", role: "assistant", contentFingerprint: "abc" },
				targetKey: "message:turn-1",
				kind: "problem",
				category: "scaffolding",
				note: "",
				status: "draft",
			},
		});
		state = reviewWorkspaceUiReducer(state, { type: "select-artifact", id: "artifact-1", targetKey: "artifact:v1" });

		expect(state).toMatchObject({
			sessionId: "session-1",
			activeSource: "artifact",
			activeTurnId: "turn-1",
			activeArtifactId: "artifact-1",
			activeModelPoolId: "pool-1",
			activeTargetKey: "artifact:v1",
			annotationDraft: null,
		});
	});

	it("keeps unsaved form edits while merging external candidate choices", () => {
		const stored = createReviewRecord("session-1", 1);
		let state = reviewWorkspaceUiReducer(initialReviewWorkspaceUiState, { type: "reset", sessionId: "session-1" });
		state = reviewWorkspaceUiReducer(state, { type: "sync-review", review: stored });
		state = reviewWorkspaceUiReducer(state, {
			type: "change-review",
			review: { ...stored, summary: "Unsaved explanation", ratings: { scaffolding: 2 }, updatedAt: 2 },
		});
		state = reviewWorkspaceUiReducer(state, {
			type: "sync-review",
			review: { ...stored, selectedCandidateIds: { "message:turn-1": "candidate-1" }, updatedAt: 3 },
		});

		expect(state.reviewDirty).toBe(true);
		expect(state.reviewDraft?.summary).toBe("Unsaved explanation");
		expect(state.reviewDraft?.ratings).toEqual({ scaffolding: 2 });
		expect(state.reviewDraft?.selectedCandidateIds).toEqual({ "message:turn-1": "candidate-1" });

		const wrongSession = createReviewRecord("session-2", 4);
		expect(reviewWorkspaceUiReducer(state, {
			type: "review-saved",
			review: wrongSession,
			submittedRevision: state.reviewDraftRevision,
		})).toBe(state);
	});

	it("synchronizes the active source identity when opening an annotation", () => {
		let state = reviewWorkspaceUiReducer(initialReviewWorkspaceUiState, { type: "reset", sessionId: "session-1" });
		state = reviewWorkspaceUiReducer(state, {
			type: "hydrate",
			turnId: "turn-1",
			turnTargetKey: "message:turn-1",
			artifactId: "artifact-1",
		});
		state = reviewWorkspaceUiReducer(state, {
			type: "open-annotation",
			generationTargetKey: "message:turn-2",
			sourceId: "turn-2",
			draft: {
				target: { kind: "message", messageId: "turn-2", role: "assistant", contentFingerprint: "def" },
				targetKey: "message:turn-2",
				kind: "problem",
				category: "scaffolding",
				note: "",
				status: "draft",
			},
		});

		expect(state).toMatchObject({
			activeSource: "message",
			activeTurnId: "turn-2",
			activeArtifactId: "artifact-1",
			activeTargetKey: "message:turn-2",
		});

		state = reviewWorkspaceUiReducer(state, {
			type: "open-annotation",
			generationTargetKey: "artifact:version-2",
			sourceId: "artifact-2",
			draft: {
				target: {
					kind: "artifact",
					artifact: {
						source: { source: "indexeddb", store: "artifacts", id: "artifact-2" },
						artifactType: "document",
						format: "markdown",
						versionId: "version-2",
						contentHash: "hash-2",
						frozen: true,
					},
				},
				targetKey: "artifact:version-2",
				kind: "problem",
				category: "scaffolding",
				note: "",
				status: "draft",
			},
		});

		expect(state).toMatchObject({
			activeSource: "artifact",
			activeTurnId: "turn-2",
			activeArtifactId: "artifact-2",
			activeTargetKey: "artifact:version-2",
		});
	});

	it("does not let an older review save overwrite newer controlled edits", () => {
		const stored = createReviewRecord("session-1", 1);
		let state = reviewWorkspaceUiReducer(initialReviewWorkspaceUiState, { type: "reset", sessionId: "session-1" });
		state = reviewWorkspaceUiReducer(state, { type: "sync-review", review: stored });
		state = reviewWorkspaceUiReducer(state, {
			type: "change-review",
			review: { ...stored, summary: "Submitted draft", updatedAt: 2 },
		});
		const submittedRevision = state.reviewDraftRevision;
		state = reviewWorkspaceUiReducer(state, {
			type: "change-review",
			review: { ...state.reviewDraft!, summary: "Newer unsaved draft", updatedAt: 3 },
		});

		const afterStaleSave = reviewWorkspaceUiReducer(state, {
			type: "review-saved",
			review: { ...stored, summary: "Submitted draft", updatedAt: 4 },
			submittedRevision,
		});
		expect(afterStaleSave.reviewDirty).toBe(true);
		expect(afterStaleSave.reviewDraft?.summary).toBe("Newer unsaved draft");

		const currentRevision = afterStaleSave.reviewDraftRevision;
		const afterCurrentSave = reviewWorkspaceUiReducer(afterStaleSave, {
			type: "review-saved",
			review: { ...afterStaleSave.reviewDraft!, updatedAt: 5 },
			submittedRevision: currentRevision,
		});
		expect(afterCurrentSave.reviewDirty).toBe(false);
		expect(afterCurrentSave.reviewDraft?.summary).toBe("Newer unsaved draft");
	});

	it("owns the selectable model catalog and clears it between sessions", () => {
		const model = {
			provider: "openai",
			id: "gpt-review",
			name: "GPT Review",
			api: "openai-responses",
			baseUrl: "https://api.example.test/v1",
			reasoning: true,
			input: ["text"] as Array<"text" | "image">,
			cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128_000,
			maxTokens: 8_192,
		};

		let state = reviewWorkspaceUiReducer(initialReviewWorkspaceUiState, { type: "reset", sessionId: "session-1" });
		state = reviewWorkspaceUiReducer(state, { type: "models-loaded", models: [model] });
		expect(state.availableModels).toEqual([model]);

		state = reviewWorkspaceUiReducer(state, { type: "reset", sessionId: "session-2" });
		expect(state.availableModels).toEqual([]);
	});
});

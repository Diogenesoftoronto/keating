import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CandidateLedger } from "../components/trajectory/CandidateLedger";
import { TrajectoryReviewWorkspace } from "../components/trajectory/TrajectoryReviewWorkspace";
import type { TrajectoryReviewWorkspaceCallbacks } from "../components/trajectory/types";
import {
	TRAJECTORY_REVIEW_SCHEMA_VERSION,
	createReviewRecord,
	type ReviewGenerationCandidate,
	type ReviewModelPool,
	type StoredModelReference,
} from "../keating/trajectory-review";

const noOp = () => {};

const callbacks = {
	onSelectTurn: noOp,
	onSelectArtifact: noOp,
	onTextSelection: noOp,
	onReviewChange: noOp,
	onStartAnnotation: noOp,
	onAnnotationDraftChange: noOp,
	onSaveAnnotation: noOp,
	onCancelAnnotation: noOp,
	onEditAnnotation: noOp,
	onDeleteAnnotation: noOp,
	onSelectCandidate: noOp,
	onChooseCandidate: noOp,
	onInsertCandidate: noOp,
	onRegenerateCandidate: noOp,
	onGenerateCandidates: noOp,
	onSelectModelPool: noOp,
	onModelPoolChange: noOp,
	onAddModel: noOp,
	onRemoveModel: noOp,
	onCreateModelPool: noOp,
	onDeleteModelPool: noOp,
	onSave: noOp,
	onExport: noOp,
} satisfies TrajectoryReviewWorkspaceCallbacks;

describe("trajectory review workspace", () => {
	it("renders the controlled transcript, review desk, and artifact navigation", () => {
		const review = createReviewRecord("session-1", 1);
		const catalogModels: StoredModelReference[] = [
			{
				provider: "openai",
				id: "gpt-5-mini",
				name: "GPT-5 mini",
				api: "openai-responses",
				baseUrl: "https://api.openai.com/v1",
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 400_000,
				maxTokens: 128_000,
			},
			{
				provider: "anthropic",
				id: "claude-sonnet-4-5",
				name: "Claude Sonnet 4.5",
				api: "anthropic-messages",
				baseUrl: "https://api.anthropic.com",
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200_000,
				maxTokens: 64_000,
			},
		];
		const responsePool: ReviewModelPool = {
			schemaVersion: TRAJECTORY_REVIEW_SCHEMA_VERSION,
			id: "pool-1",
			name: "Response reviewers",
			tasks: ["response"],
			models: [catalogModels[0]],
			candidateCount: 2,
			temperature: 0.7,
			maxTokens: 2_048,
			createdAt: 1,
			updatedAt: 1,
		};
		const html = renderToStaticMarkup(
			<TrajectoryReviewWorkspace
				data={{
					session: { id: "session-1", title: "Fractions review", subtitle: "2 recorded turns" },
					messages: [{
						id: "assistant-1",
						role: "assistant",
						ordinal: 1,
						text: "Invert the divisor. What operation does that undo?",
						contentFingerprint: "message-hash",
						label: "Tutor response",
					}],
					artifacts: [{
						id: "artifact-1",
						title: "Fraction plan",
						reference: {
							source: { source: "session", sessionId: "session-1", id: "plan-1" },
							artifactType: "plan",
							format: "markdown",
							versionId: "v1",
							contentHash: "sha256:plan",
							frozen: true,
						},
						plainText: "# Fraction plan",
					}],
					review,
					annotations: [],
					annotationDraft: null,
					modelPools: [responsePool],
					availableModels: catalogModels,
					candidates: [],
					activeTurnId: "assistant-1",
					activeArtifactId: "artifact-1",
					activeModelPoolId: "pool-1",
					activeTargetKey: "message:assistant-1",
					reviewDirty: false,
				}}
				callbacks={callbacks}
			/>,
		);

		expect(html).toContain("Fractions review");
		expect(html).toContain("Review records stay local");
		expect(html).toContain("Invert the divisor");
		expect(html).toContain("Pedagogy rubric");
		expect(html).toContain("Artifacts (1)");
		expect(html).toContain("Response reviewers");
		// Pooled models identify themselves the way chat's picker does.
		expect(html).toContain("Provider: openai · gpt-5-mini");
		// The catalog now lives behind the shared picker, so it is not inlined.
		expect(html).toContain("Add model");
		expect(html).toContain("Picks come from the same catalog as chat");
	});

	it("keeps native images annotatable while disabling text-only candidate generation", () => {
		const html = renderToStaticMarkup(
			<TrajectoryReviewWorkspace
				data={{
					session: { id: "media-session", title: "Native media review" },
					messages: [],
					artifacts: [{
						id: "image-1",
						title: "Generated diagram",
						reference: {
							source: { source: "session", sessionId: "media-session", id: "image-1" },
							artifactType: "image",
							format: "image/png",
							versionId: "v1",
							contentHash: "sha256:image",
							frozen: true,
						},
						media: {
							kind: "image",
							src: "data:image/png;base64,iVBORw0KGgo=",
							alt: "Generated diagram",
							assetHash: "sha256:raster",
							naturalWidth: 320,
							naturalHeight: 180,
						},
					}],
					review: createReviewRecord("media-session", 1),
					annotations: [],
					annotationDraft: null,
					modelPools: [],
					availableModels: [],
					candidates: [],
					activeArtifactId: "image-1",
					activeTargetKey: "artifact:image-1",
				}}
				callbacks={callbacks}
			/>,
		);

		expect(html).toContain("Drag to select an image region for annotation");
		expect(html).toContain("Annotate this image directly. Parallel candidates currently return text only and cannot materialize native media.");
		expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Generate<\/button>/);
	});

	it("keeps an animation screenshot on the text-backed animation task", () => {
		const animationPool: ReviewModelPool = {
			schemaVersion: TRAJECTORY_REVIEW_SCHEMA_VERSION,
			id: "animation-pool",
			name: "Animation reviewers",
			tasks: ["artifact:animation"],
			models: [],
			candidateCount: 1,
			temperature: 0.5,
			maxTokens: 1_024,
			createdAt: 1,
			updatedAt: 1,
		};
		const html = renderToStaticMarkup(
			<TrajectoryReviewWorkspace
				data={{
					session: { id: "animation-session", title: "Animation review" },
					messages: [],
					artifacts: [{
						id: "animation-1",
						title: "Fraction animation",
						reference: {
							source: { source: "session", sessionId: "animation-session", id: "animation-1" },
							artifactType: "animation",
							format: "hyperframes",
							versionId: "v1",
							contentHash: "sha256:animation",
							frozen: true,
						},
						plainText: "Storyboard and source",
						media: {
							kind: "image",
							src: "data:image/png;base64,iVBORw0KGgo=",
							alt: "Animation preview",
							assetHash: "sha256:preview",
							naturalWidth: 320,
							naturalHeight: 180,
						},
					}],
					review: createReviewRecord("animation-session", 1),
					annotations: [],
					annotationDraft: null,
					modelPools: [animationPool],
					availableModels: [],
					candidates: [],
					activeArtifactId: "animation-1",
					activeModelPoolId: "animation-pool",
					activeTargetKey: "artifact:animation-1",
				}}
				callbacks={callbacks}
			/>,
		);

		expect(html).toContain("Model pool for animations");
		expect(html).not.toContain("cannot materialize native media");
	});

	it("disables generation when a pool model is absent from the exact catalog", () => {
		const unavailableModel: StoredModelReference = {
			provider: "openai",
			id: "shared-model-id",
			name: "Unavailable reviewer",
			api: "openai-responses",
			baseUrl: "https://api.openai.com/v1",
			reasoning: false,
			input: ["text"],
			cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 32_000,
			maxTokens: 4_096,
		};
		const wrongProviderCatalogEntry: StoredModelReference = { ...unavailableModel, provider: "anthropic", name: "Different provider" };
		const guardedPool: ReviewModelPool = {
			schemaVersion: TRAJECTORY_REVIEW_SCHEMA_VERSION,
			id: "guarded-pool",
			name: "Guarded pool",
			tasks: ["response"],
			models: [unavailableModel],
			candidateCount: 1,
			temperature: 0.5,
			maxTokens: 1_024,
			createdAt: 1,
			updatedAt: 1,
		};
		const priorCandidate: ReviewGenerationCandidate = {
			schemaVersion: TRAJECTORY_REVIEW_SCHEMA_VERSION,
			id: "candidate-1",
			reviewId: "review:session-1",
			sessionId: "session-1",
			target: {
				kind: "response",
				messageId: "assistant-1",
				originalContent: "Original response",
			},
			targetKey: "message:assistant-1",
			poolId: guardedPool.id,
			model: unavailableModel,
			prompt: "Improve this response",
			annotationIds: [],
			state: "completed",
			content: "Candidate response",
			preferred: false,
			createdAt: 1,
			updatedAt: 1,
		};
		const html = renderToStaticMarkup(
			<CandidateLedger
				candidates={[priorCandidate]}
				modelPools={[guardedPool]}
				availableModels={[wrongProviderCatalogEntry]}
				activeTargetKey="message:assistant-1"
				activeTask="response"
				promptCharacters={80}
				activeModelPoolId="guarded-pool"
				onSelectCandidate={noOp}
				onSelectModelPool={noOp}
				onGenerate={noOp}
				onChoose={noOp}
				onInsert={noOp}
				onRegenerate={noOp}
			/>,
		);

		expect(html).toContain("Unavailable in the current model catalog: openai/shared-model-id.");
		expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Generate<\/button>/);
		expect(html).toContain("Cannot regenerate. Unavailable in the current model catalog: openai/shared-model-id.");
		expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Regenerate<\/button>/);
	});
});

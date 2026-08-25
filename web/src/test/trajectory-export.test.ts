import { describe, expect, it } from "bun:test";
import { strFromU8, unzipSync } from "fflate";
import {
	buildTrajectoryReviewArchive,
	type TrajectoryReviewArchiveInput,
} from "../keating/trajectory-export";
import {
	TRAJECTORY_REVIEW_SCHEMA_VERSION,
	contentFingerprint,
	messageReviewAnchor,
	reviewTargetKey,
	type ArtifactVersionReference,
	type ReviewGenerationCandidate,
	type ReviewModelPool,
	type StoredModelReference,
	type TrajectoryAnnotation,
	type TrajectoryReview,
} from "../keating/trajectory-review";
import type { TrajectoryReviewSnapshot } from "../keating/trajectory-store";

const NOW = 1_800_000_000_000;
const SECRET = "sk-supersecret123456789";

function parseJsonl(bytes: Uint8Array | undefined): any[] {
	if (!bytes) return [];
	const content = strFromU8(bytes).trim();
	return content ? content.split("\n").map((line) => JSON.parse(line)) : [];
}

function fixture(): TrajectoryReviewArchiveInput {
	const sessionId = "session-review-1";
	const messages = [
		{ role: "user", content: `Explain recursion without exposing ${SECRET}.`, timestamp: 1000 },
		{ role: "assistant", content: "Recursion is when a function calls itself.", timestamp: 2000 },
	] as any[];
	const messageId = messageReviewAnchor(sessionId, messages[1], 1).id;
	const responseTarget = {
		kind: "response" as const,
		messageId,
		messageTimestamp: 2000,
		originalContent: "Recursion is when a function calls itself.",
	};
	const artifact: ArtifactVersionReference = {
		source: { source: "session", sessionId, id: "plan-1", messageId },
		artifactType: "plan",
		format: "markdown",
		versionId: "plan-v1",
		contentHash: "sha256:original-plan",
		frozen: true,
	};
	const artifactTarget = {
		kind: "artifact" as const,
		artifact,
		topic: "recursion",
		originalContent: `# Recursion\n\nUse ${SECRET} in an example.`,
	};
	const responseTargetKey = reviewTargetKey(responseTarget);
	const artifactTargetKey = reviewTargetKey(artifactTarget);
	const model: StoredModelReference = {
		provider: "openai",
		id: "gpt-review",
		name: "GPT Review",
		api: "openai-responses",
		baseUrl: "https://api.openai.com/v1",
		reasoning: true,
		input: ["text"],
		cost: { input: 2, output: 8, cacheRead: 1, cacheWrite: 2 },
		contextWindow: 128_000,
		maxTokens: 4_096,
	};
	const pool: ReviewModelPool = {
		schemaVersion: TRAJECTORY_REVIEW_SCHEMA_VERSION,
		id: "pool-pedagogy",
		name: "Pedagogy pool",
		tasks: ["response", "artifact:plan"],
		models: [model],
		candidateCount: 2,
		temperature: 0.4,
		maxTokens: 2_048,
		createdAt: NOW - 100,
		updatedAt: NOW - 100,
	};
	const annotation: TrajectoryAnnotation = {
		schemaVersion: TRAJECTORY_REVIEW_SCHEMA_VERSION,
		id: "annotation-final",
		reviewId: `review:${sessionId}`,
		sessionId,
		target: {
			kind: "message",
			messageId,
			role: "assistant",
			messageTimestamp: 2000,
			contentFingerprint: contentFingerprint(responseTarget.originalContent),
		},
		targetKey: `message:${messageId}`,
		kind: "suggestion",
		category: "scaffolding",
		severity: 3,
		note: `Add a concrete trace and remove ${SECRET}.`,
		suggestedAlternative: "Walk through factorial(3) and make the base case visible.",
		status: "final",
		createdAt: NOW - 90,
		updatedAt: NOW - 90,
	};
	const responseCandidate: ReviewGenerationCandidate = {
		schemaVersion: TRAJECTORY_REVIEW_SCHEMA_VERSION,
		id: "candidate-response",
		reviewId: `review:${sessionId}`,
		sessionId,
		target: responseTarget,
		targetKey: responseTargetKey,
		poolId: pool.id,
		model,
		prompt: `Rewrite from this feedback: do not leak ${SECRET}.`,
		annotationIds: [annotation.id, "annotation-draft"],
		state: "completed",
		content: "Start with factorial(3): each call shrinks the input until factorial(1), the base case, returns 1.",
		preferred: true,
		usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.0042, latencyMs: 800 },
		createdAt: NOW - 80,
		updatedAt: NOW - 80,
	};
	const artifactCandidate: ReviewGenerationCandidate = {
		schemaVersion: TRAJECTORY_REVIEW_SCHEMA_VERSION,
		id: "candidate-artifact",
		reviewId: `review:${sessionId}`,
		sessionId,
		target: artifactTarget,
		targetKey: artifactTargetKey,
		poolId: pool.id,
		model,
		prompt: "Revise the lesson plan around an explicit call-stack trace.",
		annotationIds: [annotation.id],
		state: "completed",
		content: "# Recursion\n\nTrace factorial(3) to its base case, then unwind each return value.",
		preferred: true,
		materializedArtifactId: "plan-2",
		usage: { inputTokens: 80, outputTokens: 40, totalTokens: 120 },
		createdAt: NOW - 70,
		updatedAt: NOW - 70,
	};
	const draftAnnotation: TrajectoryAnnotation = {
		...annotation,
		id: "annotation-draft",
		note: "An unapproved draft observation.",
		status: "draft",
		createdAt: NOW - 60,
		updatedAt: NOW - 60,
	};
	const review: TrajectoryReview = {
		schemaVersion: TRAJECTORY_REVIEW_SCHEMA_VERSION,
		id: `review:${sessionId}`,
		sessionId,
		status: "final",
		verdict: "rejected",
		ratings: { accuracy: 3, scaffolding: 2 },
		overallRating: 2,
		summary: `The response needs a concrete trace; ${SECRET} must not leave the browser.`,
		selectedCandidateIds: {
			[responseTargetKey]: responseCandidate.id,
			[artifactTargetKey]: artifactCandidate.id,
		},
		createdAt: NOW - 200,
		updatedAt: NOW - 50,
	};
	const snapshot: TrajectoryReviewSnapshot = {
		schemaVersion: TRAJECTORY_REVIEW_SCHEMA_VERSION,
		review,
		annotations: [draftAnnotation, annotation],
		candidates: [artifactCandidate, responseCandidate],
		modelPools: [pool],
		artifacts: [{
			schemaVersion: TRAJECTORY_REVIEW_SCHEMA_VERSION,
			id: "artifact-snapshot-1",
			reviewId: review.id,
			sessionId,
			artifact,
			label: "Original recursion plan",
			topic: "recursion",
			content: `# Original plan\n\nNever export ${SECRET}.`,
			metadata: {
				apiKey: "short-private-value",
				nested: { authorization: "Basic private-credential" },
			},
			createdAt: NOW - 120,
			capturedAt: NOW - 110,
		}],
	};
	return {
		snapshot,
		session: {
			id: sessionId,
			title: "Recursion review",
			systemPrompt: "Teach with a diagnostic question before explaining.",
			messages,
		},
	};
}

describe("trajectory review archive", () => {
	it("packages a redacted raw snapshot and finalized SFT, DPO, KTO, and artifact records", () => {
		const archive = buildTrajectoryReviewArchive(fixture(), { now: NOW });
		const files = unzipSync(archive.bytes);

		expect(archive.filename).toBe("keating-trajectory-review-2027-01-15T08-00-00-000Z.zip");
		expect(Object.keys(files).sort()).toEqual([
			"README.md",
			"data/artifacts/review-revisions.jsonl",
			"data/preferences/review.dpo.chat.jsonl",
			"data/preferences/review.dpo.text.jsonl",
			"data/preferences/review.kto.jsonl",
			"data/reviews/trajectory-reviews.jsonl",
			"data/sft/review-corrections.alpaca.jsonl",
			"data/sft/review-corrections.chatml.jsonl",
			"manifest.json",
		].sort());

		const combined = Object.values(files).map((bytes) => strFromU8(bytes)).join("\n");
		expect(combined).toContain("[REDACTED]");
		expect(combined).not.toContain(SECRET);
		expect(combined).not.toContain("short-private-value");
		expect(combined).not.toContain("private-credential");

		const raw = parseJsonl(files["data/reviews/trajectory-reviews.jsonl"])[0];
		expect(raw.annotations).toHaveLength(2);
		expect(raw.candidates).toHaveLength(2);
		expect(raw.artifacts[0].metadata).toEqual({ apiKey: "[REDACTED]", nested: { authorization: "[REDACTED]" } });
		expect(raw.candidates.find((candidate: any) => candidate.id === "candidate-response").prompt).toContain("[REDACTED]");

		const chatml = parseJsonl(files["data/sft/review-corrections.chatml.jsonl"])[0];
		expect(chatml.messages).toEqual([
			{ role: "system", content: "Teach with a diagnostic question before explaining." },
			{ role: "user", content: "Explain recursion without exposing [REDACTED]." },
			{ role: "assistant", content: "Start with factorial(3): each call shrinks the input until factorial(1), the base case, returns 1." },
		]);
		expect(chatml.keating.provenance.annotationIds).toEqual(["annotation-final"]);
		expect(chatml.keating.provenance.model).toMatchObject({ provider: "openai", id: "gpt-review" });
		expect(chatml.keating.provenance.costUsd).toBe(0.0042);
		expect(chatml.keating.provenance.pricingUsdPerMillionTokens).toEqual({
			cacheRead: 1,
			cacheWrite: 2,
			input: 2,
			output: 8,
		});

		const alpaca = parseJsonl(files["data/sft/review-corrections.alpaca.jsonl"])[0];
		expect(alpaca.instruction).toBe("Explain recursion without exposing [REDACTED].");
		expect(alpaca.input).toBe("System: Teach with a diagnostic question before explaining.");

		const dpo = parseJsonl(files["data/preferences/review.dpo.chat.jsonl"])[0];
		expect(dpo.chosen).toContain("factorial(3)");
		expect(dpo.rejected).toBe("Recursion is when a function calls itself.");
		const kto = parseJsonl(files["data/preferences/review.kto.jsonl"]);
		expect(kto.map((record) => record.label)).toEqual([true, false]);
		expect(kto[0].completion).toBe(dpo.chosen);
		expect(kto[1].completion).toBe(dpo.rejected);

		const artifact = parseJsonl(files["data/artifacts/review-revisions.jsonl"])[0];
		expect(artifact.revisedContent).toContain("unwind each return value");
		expect(artifact.materializedArtifactId).toBe("plan-2");
		expect(artifact.provenance.costUsd).toBeCloseTo(0.00048);

		const manifest = JSON.parse(strFromU8(files["manifest.json"]));
		expect(manifest).toMatchObject({
			schemaVersion: 1,
			kind: "keating-trajectory-review-archive",
			redactionEnabled: true,
			counts: {
				annotations: 2,
				finalAnnotations: 1,
				approvedCorrections: 1,
				approvedArtifactRevisions: 1,
				dpoChatLines: 1,
				ktoLines: 2,
			},
		});
		expect(strFromU8(files["README.md"])).toContain("Approval boundary");
	});

	it("keeps draft material only in the raw snapshot", () => {
		const input = fixture();
		input.snapshot.review = { ...input.snapshot.review, status: "draft" };
		const archive = buildTrajectoryReviewArchive(input, { now: NOW });
		const files = unzipSync(archive.bytes);

		expect(parseJsonl(files["data/reviews/trajectory-reviews.jsonl"])).toHaveLength(1);
		expect(parseJsonl(files["data/sft/review-corrections.chatml.jsonl"])).toHaveLength(0);
		expect(parseJsonl(files["data/preferences/review.dpo.chat.jsonl"])).toHaveLength(0);
		expect(parseJsonl(files["data/preferences/review.kto.jsonl"])).toHaveLength(0);
		expect(parseJsonl(files["data/artifacts/review-revisions.jsonl"])).toHaveLength(0);
		expect(archive.manifest.counts.approvedCorrections).toBe(0);
		expect(archive.manifest.warnings[0]).toContain("still a draft");
	});

	it("does not invent prompt context and produces deterministic bytes for a fixed timestamp", () => {
		const input = fixture();
		delete input.session;
		const first = buildTrajectoryReviewArchive(input, { now: NOW });
		const second = buildTrajectoryReviewArchive(input, { now: NOW });
		const files = unzipSync(first.bytes);

		expect(first.bytes).toEqual(second.bytes);
		expect(parseJsonl(files["data/sft/review-corrections.chatml.jsonl"])).toHaveLength(0);
		expect(parseJsonl(files["data/preferences/review.dpo.chat.jsonl"])).toHaveLength(0);
		expect(parseJsonl(files["data/artifacts/review-revisions.jsonl"])).toHaveLength(1);
		expect(first.manifest.counts.skippedApprovedCandidates).toBe(1);
		expect(first.manifest.warnings).toEqual([
			"Selected response candidate candidate-response was skipped because its prompt context could not be reconstructed.",
		]);
	});

	it("exports immutable run provenance without turning unknown cost into zero", () => {
		const input = fixture();
		const candidate = input.snapshot.candidates.find((entry) => entry.id === "candidate-response")!;
		const storedPool = input.snapshot.modelPools[0];
		candidate.usage = { ...candidate.usage, costUsd: 0 };
		candidate.generation = {
			run: {
				id: "run-immutable",
				task: "response",
				candidateIndex: 0,
				requestedAt: NOW - 81,
				pool: { ...storedPool, name: "Pool at generation time", models: [...storedPool.models], tasks: [...storedPool.tasks] },
				requestedModel: { ...candidate.model },
				effectiveMaxTokens: 2_048,
				hostedWebSearch: false,
				toolsEnabled: false,
			},
			latencyMs: 800,
			usageSource: "unavailable",
			cost: { known: false, provenance: "unknown" },
			response: { provider: "hosted", model: candidate.model.id, stopReason: "stop" },
		};
		storedPool.name = "Pool edited later";

		const files = unzipSync(buildTrajectoryReviewArchive(input, { now: NOW }).bytes);
		const provenance = parseJsonl(files["data/sft/review-corrections.chatml.jsonl"])[0].keating.provenance;
		expect(provenance.costUsd).toBeUndefined();
		expect(provenance.cost).toEqual({ known: false, provenance: "unknown" });
		expect(provenance.pool.name).toBe("Pool at generation time");
		expect(provenance.pool.snapshot.name).toBe("Pool at generation time");
		expect(provenance.generation.run.id).toBe("run-immutable");
	});

	it("skips ambiguous timestamp and content fallbacks instead of exporting the wrong turn", () => {
		const input = fixture();
		const candidate = input.snapshot.candidates.find((entry) => entry.id === "candidate-response")!;
		if (candidate.target.kind !== "response" || !input.session) throw new Error("Invalid response fixture");
		candidate.target = { ...candidate.target, messageId: "stale-message-id" };
		input.session.messages = [
			input.session.messages[0],
			input.session.messages[1],
			{ ...input.session.messages[1] } as any,
		];

		const archive = buildTrajectoryReviewArchive(input, { now: NOW });
		const files = unzipSync(archive.bytes);
		expect(parseJsonl(files["data/sft/review-corrections.chatml.jsonl"])).toHaveLength(0);
		expect(archive.manifest.warnings).toContain(
			"Selected response candidate candidate-response was skipped because its prompt context could not be reconstructed.",
		);
	});

	it("replaces embedded image bytes with an artifact marker in training prompts", () => {
		const input = fixture();
		if (!input.session) throw new Error("Missing session fixture");
		const dataUrl = `data:image/png;base64,${"A".repeat(128)}`;
		const tag = `<keating-image json=${JSON.stringify(JSON.stringify({ title: "Recursion diagram", dataUrl }))} />`;
		input.session.messages = input.session.messages.map((message, index) => index === 0
			? { ...message, content: `Explain recursion.\n${tag}` } as any
			: message);

		const files = unzipSync(buildTrajectoryReviewArchive(input, { now: NOW }).bytes);
		const chatml = parseJsonl(files["data/sft/review-corrections.chatml.jsonl"])[0];
		expect(chatml.messages[1].content).toContain("[Generated image artifact: Recursion diagram]");
		expect(chatml.messages[1].content).not.toContain(dataUrl);
	});
});

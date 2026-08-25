import { describe, expect, test } from "bun:test";
import {
	projectSharedSessionPayload,
	validateSharedSessionPayload,
} from "../src/keating/share-contract";
import { contentFingerprint } from "../src/keating/trajectory-review";

function v2TuiPayload() {
	return {
		schemaVersion: 2,
		title: "TUI share",
		createdAt: "2026-01-01T00:00:00.000Z",
		sharedAt: "2026-01-01T00:00:00.000Z",
		messageCount: 2,
		model: { provider: "openai", id: "gpt-5.5" },
		thinkingLevel: "medium",
		messages: [
			{ role: "user", timestamp: 10, content: [{ type: "text", text: "Hello" }] },
			{ role: "assistant", timestamp: 20, content: [{ type: "text", text: "Hi" }] },
		],
	};
}

function v3Payload() {
	return {
		schemaVersion: 3,
		title: "Reviewed share",
		createdAt: "2026-01-01T00:00:00.000Z",
		sharedAt: "2026-01-01T00:00:00.000Z",
		messageCount: 1,
		messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
		trajectory: {
			schemaVersion: 1,
			turnCount: 1,
			turns: [{ id: "turn-1", ordinal: 0, role: "user", text: "Hello", contentFingerprint: contentFingerprint("Hello") }],
			artifactCount: 0,
			artifacts: [],
			annotationCount: 0,
			annotations: [],
			omitted: {
				turns: 0,
				artifacts: 0,
				invalidArtifacts: 0,
				internalArtifacts: 0,
				privateArtifacts: 0,
				uninspectedArtifacts: 0,
				annotations: 0,
				artifactContents: 0,
				artifactPreviews: 0,
			},
		},
	};
}

describe("shared session wire contract", () => {
	test("accepts and canonicalizes representative TUI v2 uploads", () => {
		const payload = v2TuiPayload();
		expect(validateSharedSessionPayload(payload)).toBeNull();
		const projected = projectSharedSessionPayload(payload) as any;
		expect(projected.schemaVersion).toBe(2);
		expect(projected.messages).toEqual([
			{ role: "user", content: [{ type: "text", text: "Hello" }] },
			{ role: "assistant", content: [{ type: "text", text: "Hi" }] },
		]);
		expect(projected.messages[0].timestamp).toBeUndefined();
	});

	test("rejects unknown v3 fields at every public boundary", () => {
		expect(validateSharedSessionPayload({ ...v3Payload(), secret: "no" })).toContain("Unexpected");
		expect(validateSharedSessionPayload({
			...v3Payload(),
			messages: [{ role: "user", content: [{ type: "text", text: "Hello" }], usage: { cost: 1 } }],
		})).toContain("Invalid shared session message");
		expect(validateSharedSessionPayload({
			...v3Payload(),
			trajectory: { ...v3Payload().trajectory, candidates: [{ prompt: "secret" }] },
		})).toContain("Invalid shared session trajectory");
	});

	test("the browser projector strips non-wire metadata before upload", () => {
		const projected = projectSharedSessionPayload({
			...v3Payload(),
			secret: "strip-me",
			model: { provider: "openai", id: "gpt-5.5", api: "private-api", baseUrl: "https://private.example" },
			messages: [{ role: "user", content: [{ type: "text", text: "Hello" }], responseId: "private", usage: { cost: 3 } }],
		}) as any;
		expect(projected.secret).toBeUndefined();
		expect(projected.model).toEqual({ provider: "openai", id: "gpt-5.5" });
		expect(projected.messages[0]).toEqual({ role: "user", content: [{ type: "text", text: "Hello" }] });
	});

	test("rejects executable artifact bodies and per-turn timestamps", () => {
		const payload = v3Payload();
		expect(validateSharedSessionPayload({
			...payload,
			trajectory: {
				...payload.trajectory,
				turns: [{ ...payload.trajectory.turns[0], timestamp: 123 }],
			},
		})).toContain("Invalid shared session trajectory");
		expect(validateSharedSessionPayload({
			...payload,
			trajectory: {
				...payload.trajectory,
				artifactCount: 1,
				artifacts: [{
					id: "artifact-1",
					artifactType: "animation",
					format: "text/html",
					label: "Unsafe",
					content: "<script>alert(1)</script>",
					createdAt: 1,
					capturedAt: 1,
				}],
			},
		})).toContain("Invalid shared session trajectory");
	});

	test("rejects duplicate public trajectory identities", () => {
		const payload = v3Payload();
		const turn = payload.trajectory.turns[0];
		for (const trajectory of [
			{ ...payload.trajectory, turnCount: 2, turns: [turn, { ...turn }] },
			{
				...payload.trajectory,
				artifactCount: 2,
				artifacts: [artifact("artifact-1"), artifact("artifact-1")],
			},
			{
				...payload.trajectory,
				annotationCount: 2,
				annotations: [annotation("annotation-1", { kind: "session" }), annotation("annotation-1", { kind: "session" })],
			},
		]) {
			expect(validateSharedSessionPayload({ ...payload, trajectory })).toContain("Invalid shared session trajectory");
		}
	});

	test("rejects dangling trajectory references", () => {
		const payload = v3Payload();
		for (const trajectory of [
			{
				...payload.trajectory,
				annotationCount: 1,
				annotations: [annotation("annotation-1", { kind: "message", turnId: "missing-turn" })],
			},
			{
				...payload.trajectory,
				annotationCount: 1,
				annotations: [annotation("annotation-1", { kind: "artifact", artifactId: "missing-artifact" })],
			},
			{
				...payload.trajectory,
				artifactCount: 1,
				artifacts: [{ ...artifact("artifact-1"), parentArtifactId: "missing-artifact" }],
			},
		]) {
			expect(validateSharedSessionPayload({ ...payload, trajectory })).toContain("Invalid shared session trajectory");
		}
	});

	test("rejects cyclic artifact parent graphs", () => {
		const payload = v3Payload();
		for (const artifacts of [
			[{ ...artifact("artifact-1"), parentArtifactId: "artifact-1" }],
			[
				{ ...artifact("artifact-1"), parentArtifactId: "artifact-2" },
				{ ...artifact("artifact-2"), parentArtifactId: "artifact-1" },
			],
		]) {
			expect(validateSharedSessionPayload({
				...payload,
				trajectory: { ...payload.trajectory, artifactCount: artifacts.length, artifacts },
			})).toContain("Invalid shared session trajectory");
		}
	});

	test("rejects turn fingerprints that do not match public text", () => {
		const payload = v3Payload();
		const stale = {
			...payload,
			trajectory: {
				...payload.trajectory,
				turns: [{ ...payload.trajectory.turns[0], contentFingerprint: contentFingerprint("Different") }],
			},
		};
		expect(validateSharedSessionPayload(stale)).toContain("Invalid shared session trajectory");
		const projected = projectSharedSessionPayload(stale) as any;
		expect(projected.trajectory.turns[0].contentFingerprint).toBe(contentFingerprint("Hello"));
		expect(validateSharedSessionPayload(projected)).toBeNull();
	});

	test("rejects invalid normalized artifact regions", () => {
		const payload = v3Payload();
		const base = {
			kind: "artifact-region",
			artifactId: "artifact-1",
			coordinateSpace: "normalized-intrinsic",
			x: 0.1,
			y: 0.2,
			width: 0.3,
			height: 0.4,
			naturalWidth: 640,
			naturalHeight: 480,
		};
		for (const target of [
			{ ...base, x: -0.1 },
			{ ...base, width: 0 },
			{ ...base, x: 0.8, width: 0.3 },
			{ ...base, naturalWidth: 0 },
			{ ...base, naturalHeight: 1.5 },
		]) {
			const trajectory = {
				...payload.trajectory,
				artifactCount: 1,
				artifacts: [artifact("artifact-1", "image", { preview: imagePreview(640, 480) })],
				annotationCount: 1,
				annotations: [annotation("annotation-1", target)],
			};
			expect(validateSharedSessionPayload({ ...payload, trajectory })).toContain("Invalid shared session trajectory");
		}
	});

	test("rejects invalid artifact time ranges and durations", () => {
		const payload = v3Payload();
		const base = {
			kind: "artifact-time-range",
			artifactId: "artifact-1",
			timeBasis: "media-time",
			startMs: 1_000,
			endMs: 2_000,
			durationMs: 3_000,
		};
		for (const target of [
			{ ...base, startMs: -1 },
			{ ...base, endMs: 1_000 },
			{ ...base, durationMs: 0 },
			{ ...base, durationMs: 1_500 },
			{ ...base, timeBasis: "normalized-progress", startMs: 0.2, endMs: 1.1 },
		]) {
			const trajectory = {
				...payload.trajectory,
				artifactCount: 1,
				artifacts: [artifact("artifact-1", "video")],
				annotationCount: 1,
				annotations: [annotation("annotation-1", target)],
			};
			expect(validateSharedSessionPayload({ ...payload, trajectory })).toContain("Invalid shared session trajectory");
		}
	});

	test("requires annotation targets to match artifact capabilities and target keys", () => {
		const payload = v3Payload();
		const region = {
			kind: "artifact-region",
			artifactId: "artifact-1",
			coordinateSpace: "normalized-intrinsic",
			x: 0.1,
			y: 0.1,
			width: 0.5,
			height: 0.5,
			naturalWidth: 640,
			naturalHeight: 480,
		};
		const timeRange = {
			kind: "artifact-time-range",
			artifactId: "artifact-1",
			timeBasis: "media-time",
			startMs: 100,
			endMs: 200,
			durationMs: 300,
		};
		for (const [target, sharedArtifact] of [
			[region, artifact("artifact-1", "plan", { preview: imagePreview(640, 480) })],
			[region, artifact("artifact-1", "image")],
			[region, artifact("artifact-1", "image", { preview: imagePreview(320, 240) })],
			[timeRange, artifact("artifact-1", "plan")],
		] as const) {
			expect(validateSharedSessionPayload({
				...payload,
				trajectory: {
					...payload.trajectory,
					artifactCount: 1,
					artifacts: [sharedArtifact],
					annotationCount: 1,
					annotations: [annotation("annotation-1", target)],
				},
			})).toContain("Invalid shared session trajectory");
		}

		const mismatchedKey = { ...annotation("annotation-1", { kind: "message", turnId: "turn-1" }), targetKey: "message:other" };
		expect(validateSharedSessionPayload({
			...payload,
			trajectory: { ...payload.trajectory, annotationCount: 1, annotations: [mismatchedKey] },
		})).toContain("Invalid shared session trajectory");
	});

	test("accepts relationally valid region and normalized-progress targets", () => {
		const payload = v3Payload();
		const artifacts = [
			artifact("artifact-image", "image", { preview: imagePreview(640, 480) }),
			artifact("artifact-image-omitted", "image", { previewOmitted: "preview-too-large" }),
			artifact("artifact-video", "animation"),
		];
		const annotations = [
			annotation("annotation-region", {
				kind: "artifact-region",
				artifactId: "artifact-image",
				coordinateSpace: "normalized-intrinsic",
				x: 0.1,
				y: 0.2,
				width: 0.3,
				height: 0.4,
				naturalWidth: 640,
				naturalHeight: 480,
			}),
			annotation("annotation-region-omitted", {
				kind: "artifact-region",
				artifactId: "artifact-image-omitted",
				coordinateSpace: "normalized-intrinsic",
				x: 0.1,
				y: 0.2,
				width: 0.3,
				height: 0.4,
				naturalWidth: 640,
				naturalHeight: 480,
			}),
			annotation("annotation-time", {
				kind: "artifact-time-range",
				artifactId: "artifact-video",
				timeBasis: "normalized-progress",
				startMs: 0.2,
				endMs: 0.8,
				durationMs: 5_000,
			}),
		];
		expect(validateSharedSessionPayload({
			...payload,
			trajectory: {
				...payload.trajectory,
				artifactCount: artifacts.length,
				artifacts,
				annotationCount: annotations.length,
				annotations,
			},
		})).toBeNull();
	});
});

function artifact(id: string, artifactType = "plan", overrides: Record<string, unknown> = {}) {
	return {
		id,
		artifactType,
		format: "text/markdown",
		label: "Shared artifact",
		createdAt: 1,
		capturedAt: 1,
		...overrides,
	};
}

function imagePreview(naturalWidth: number, naturalHeight: number) {
	return {
		kind: "image",
		dataUrl: "data:image/png;base64,iVBORw0KGgo=",
		alt: "Shared image",
		mimeType: "image/png",
		naturalWidth,
		naturalHeight,
	};
}

function annotation(id: string, target: Record<string, unknown>) {
	const targetKey = target.kind === "session"
		? "session"
		: target.kind === "message" || target.kind === "message-span"
			? `message:${String(target.turnId)}`
			: `artifact:${String(target.artifactId)}`;
	return {
		id,
		target,
		targetKey,
		kind: "problem",
		category: "scaffolding",
		note: "Needs improvement",
		status: "final",
		createdAt: 1,
		updatedAt: 1,
	};
}

import { describe, expect, it } from "bun:test";
import {
	captureSessionArtifactVersions,
	createArtifactRevisionSnapshot,
	reviewArtifactDisplayText,
	TRAJECTORY_IMAGE_CAPTURE_LIMITS,
	validatePersistedArtifactSnapshot,
} from "../keating/trajectory-artifacts";
import type { KeatingStoragePortableData } from "../keating/storage";

const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z0G0AAAAASUVORK5CYII=";

function generatedImagePayload() {
	return {
		title: "One-pixel teaching diagram",
		alt: "A single reference pixel",
		dataUrl: `data:image/png;base64,${ONE_PIXEL_PNG}`,
		mimeType: "image/png",
		model: "image-model",
		prompt: "Show one pixel.",
	};
}

function generatedImageResult(payload = generatedImagePayload(), overrides: Record<string, unknown> = {}) {
	return {
		role: "toolResult",
		timestamp: 4,
		toolCallId: "image-call-1",
		toolName: "generate_image",
		content: [
			{
				type: "text",
				text: `<keating-image json=${JSON.stringify(JSON.stringify(payload))} />`,
			},
		],
		details: { tool: "generate_image" },
		isError: false,
		...overrides,
	};
}

function portableData(): KeatingStoragePortableData {
	return {
		lessonPlans: [
			{
				id: "plan-1",
				topic: "recursion",
				createdAt: 1,
				updatedAt: 2,
				content: "# Plan",
				sessionId: "session-1",
			},
		],
		lessonMaps: [
			{
				id: "map-1",
				topic: "recursion",
				createdAt: 3,
				mmdContent: "graph TD",
				sessionId: "session-2",
			},
		],
		animations: [],
		verifications: [],
		benchmarks: [],
		evolutions: [],
		policies: [],
		feedback: [],
		learnerState: {
			schemaVersion: 3,
			topicsExplored: [],
			feedbackHistory: [],
			strengths: [],
			weaknesses: [],
			topicProfiles: [],
			sessionsCount: 0,
			sessions: [],
			profileBeliefs: [],
			studyPriorities: [],
		},
		promptEvolutions: [],
		improvements: [],
		goals: [],
		quizResults: [],
		decks: [],
		cardReviews: [],
		questionChecks: [],
	};
}

describe("trajectory artifact snapshots", () => {
	it("captures only artifacts belonging to the reviewed session", async () => {
		const snapshots = await captureSessionArtifactVersions(
			{ exportPortableData: async () => portableData() } as any,
			"review:session-1",
			"session-1",
			10,
		);
		expect(snapshots).toHaveLength(1);
		expect(snapshots[0]).toMatchObject({
			label: "Plan: recursion",
			content: "# Plan",
			capturedAt: 10,
		});
		expect(snapshots[0].artifact.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(snapshots[0].artifact.source).toEqual({
			source: "indexeddb",
			store: "lesson-plans",
			id: "plan-1",
		});
	});

	it("creates a frozen child version instead of overwriting the source", async () => {
		const [original] = await captureSessionArtifactVersions(
			{ exportPortableData: async () => portableData() } as any,
			"review:session-1",
			"session-1",
			10,
		);
		const revision = createArtifactRevisionSnapshot(
			original,
			"# Better plan",
			`sha256:${"1".repeat(64)}`,
			"candidate-1",
			20,
		);
		expect(revision.artifact.parentVersionId).toBe(original.artifact.versionId);
		expect(revision.artifact.source).toEqual({
			source: "session",
			sessionId: "session-1",
			id: "candidate-1",
		});
		expect(original.content).toBe("# Plan");
	});

	it("freezes local session images for intrinsic region annotations", async () => {
		const payload = generatedImagePayload();
		const messages = [
			generatedImageResult(payload),
			{
				role: "assistant",
				timestamp: 5,
				content: [{ type: "image", mimeType: "image/png", data: ONE_PIXEL_PNG }],
			},
			{
				role: "user",
				timestamp: 6,
				content: [
					{
						type: "text",
						text: `<keating-image json=${JSON.stringify(JSON.stringify(payload))} />`,
					},
				],
			},
			generatedImageResult(payload, {
				timestamp: 7,
				toolCallId: "failed-image-call",
				isError: true,
			}),
		] as any[];
		const snapshots = await captureSessionArtifactVersions(
			{ exportPortableData: async () => portableData() } as any,
			"review:session-1",
			"session-1",
			10,
			messages,
		);
		const images = snapshots.filter((snapshot) => snapshot.artifact.artifactType === "image");
		const image = images.find((snapshot) => snapshot.label === payload.title);

		expect(snapshots).toHaveLength(3);
		expect(images).toHaveLength(2);
		expect(image?.label).toBe("One-pixel teaching diagram");
		expect(image?.media).toMatchObject({
			kind: "image",
			alt: "A single reference pixel",
			mimeType: "image/png",
			naturalWidth: 1,
			naturalHeight: 1,
		});
		expect(image?.media?.assetHash).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(image?.artifact.source).toMatchObject({
			source: "session",
			sessionId: "session-1",
		});
		expect(
			new Set(
				images.map((snapshot) =>
					snapshot.artifact.source.source === "session" ? snapshot.artifact.source.messageId : undefined,
				),
			).size,
		).toBe(2);
		expect(image?.content).not.toContain("base64");
		expect(reviewArtifactDisplayText((messages[0] as any).content[0].text)).toBe(
			"[Generated image artifact: One-pixel teaching diagram]",
		);
		const remoteTag = generatedImageResult({
			...payload,
			dataUrl: "https://example.test/image.png",
		}).content[0].text;
		expect(reviewArtifactDisplayText(remoteTag)).toBe(remoteTag);
	});

	it("bounds image count while retaining distinct same-byte occurrences", async () => {
		const content = Array.from({ length: TRAJECTORY_IMAGE_CAPTURE_LIMITS.maxImages + 4 }, () => ({
			type: "image",
			mimeType: "image/png",
			data: ONE_PIXEL_PNG,
		}));
		const snapshots = await captureSessionArtifactVersions(
			{ exportPortableData: async () => portableData() } as any,
			"review:session-1",
			"session-1",
			10,
			[{ role: "user", timestamp: 5, content }] as any[],
		);
		const images = snapshots.filter((snapshot) => snapshot.artifact.artifactType === "image");
		expect(images).toHaveLength(TRAJECTORY_IMAGE_CAPTURE_LIMITS.maxImages);
		expect(new Set(images.map((snapshot) => snapshot.id)).size).toBe(TRAJECTORY_IMAGE_CAPTURE_LIMITS.maxImages);
	});

	it("rejects forged MIME declarations and partial image signatures", async () => {
		const partialPngBytes = new Uint8Array(24);
		partialPngBytes.set([0x89, 0x50, 0x4e, 0x47]);
		partialPngBytes[19] = 1;
		partialPngBytes[23] = 1;
		const partialPng = btoa(Array.from(partialPngBytes, (byte) => String.fromCharCode(byte)).join(""));
		const oversizedPngBytes = new Uint8Array(33);
		oversizedPngBytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
		oversizedPngBytes.set([0, 0, 0x80, 1], 16);
		oversizedPngBytes.set([0, 0, 0, 1], 20);
		const oversizedPng = btoa(Array.from(oversizedPngBytes, (byte) => String.fromCharCode(byte)).join(""));
		const messages = [
			{
				role: "user",
				timestamp: 5,
				content: [
					{ type: "image", mimeType: "image/jpeg", data: ONE_PIXEL_PNG },
					{ type: "image", mimeType: "image/png", data: partialPng },
					{ type: "image", mimeType: "image/png", data: oversizedPng },
				],
			},
		] as any[];
		const snapshots = await captureSessionArtifactVersions(
			{ exportPortableData: async () => portableData() } as any,
			"review:session-1",
			"session-1",
			10,
			messages,
		);
		expect(snapshots.filter((snapshot) => snapshot.artifact.artifactType === "image")).toHaveLength(0);
	});

	it("uses unambiguous framing for primary and secondary artifact content", async () => {
		const separator = "\n\u0000\n";
		const first = portableData();
		first.animations = [
			{
				id: "animation-1",
				topic: "frames",
				createdAt: 8,
				scene: "a",
				storyboard: `b${separator}c`,
				manifest: "{}",
				sessionId: "session-1",
			},
		];
		const second = portableData();
		second.animations = [
			{
				id: "animation-1",
				topic: "frames",
				createdAt: 8,
				scene: `a${separator}b`,
				storyboard: "c",
				manifest: "{}",
				sessionId: "session-1",
			},
		];
		const [firstSnapshots, secondSnapshots] = await Promise.all([
			captureSessionArtifactVersions(
				{ exportPortableData: async () => first } as any,
				"review:session-1",
				"session-1",
				10,
			),
			captureSessionArtifactVersions(
				{ exportPortableData: async () => second } as any,
				"review:session-1",
				"session-1",
				10,
			),
		]);
		const firstAnimation = firstSnapshots.find((snapshot) => snapshot.artifact.artifactType === "animation");
		const secondAnimation = secondSnapshots.find((snapshot) => snapshot.artifact.artifactType === "animation");
		expect(firstAnimation?.artifact.contentHash).not.toBe(secondAnimation?.artifact.contentHash);
		expect(firstAnimation?.id).not.toBe(secondAnimation?.id);
	});

	it("revalidates persisted media bytes, dimensions, and hashes", async () => {
		const snapshots = await captureSessionArtifactVersions(
			{ exportPortableData: async () => portableData() } as any,
			"review:session-1",
			"session-1",
			10,
			[generatedImageResult()] as any[],
		);
		const image = snapshots.find((snapshot) => snapshot.artifact.artifactType === "image");
		expect(image).toBeDefined();
		expect(await validatePersistedArtifactSnapshot(image)).toEqual(image!);
		expect(
			await validatePersistedArtifactSnapshot({
				...image,
				media: { ...image?.media, dataUrl: "https://example.test/image.png" },
			}),
		).toBeNull();
		expect(
			await validatePersistedArtifactSnapshot({
				...image,
				media: { ...image?.media, assetHash: `sha256:${"0".repeat(64)}` },
			}),
		).toBeNull();
	});

	it("refuses to materialize text as a media revision", async () => {
		const snapshots = await captureSessionArtifactVersions(
			{ exportPortableData: async () => portableData() } as any,
			"review:session-1",
			"session-1",
			10,
			[generatedImageResult()] as any[],
		);
		const image = snapshots.find((snapshot) => snapshot.artifact.artifactType === "image");
		expect(() =>
			createArtifactRevisionSnapshot(image!, "not image bytes", `sha256:${"0".repeat(64)}`, "candidate-image", 20),
		).toThrow("Media artifact revisions require a validated frozen replacement asset.");
	});
});

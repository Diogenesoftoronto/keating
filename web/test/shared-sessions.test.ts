import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { SharedSession } from "../src/keating/shared-sessions";
import {
	buildSharedTrajectory,
	loadSharedSessionFromUrl,
	loadSharedSessionResultFromUrl,
	sharedSessionUrl,
	shouldWarnBeforePublicShare,
} from "../src/keating/shared-sessions";
import { messageReviewAnchor, type ReviewArtifactSnapshot } from "../src/keating/trajectory-review";

function createMockStorage() {
	const store = new Map<string, string>();
	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => {
			store.set(key, String(value));
		},
		removeItem: (key: string) => {
			store.delete(key);
		},
		clear: () => {
			store.clear();
		},
	} as unknown as Storage;
}

function sharedSession(): SharedSession {
	const repeated = "Recursion reduces a problem into a smaller instance until a base case stops the chain. ".repeat(10);
	return {
		id: "share1234",
		schemaVersion: 2,
		title: "Recursion",
		createdAt: "2026-01-01T00:00:00.000Z",
		sharedAt: "2026-01-02T00:00:00.000Z",
		messageCount: 2,
		model: { provider: "openai", id: "gpt-5.5", name: "GPT-5.5", api: "openai-responses" },
		thinkingLevel: "medium",
		messages: [
			{ role: "user", content: [{ type: "text", text: "Explain recursion." }] },
			{
				role: "assistant",
				api: "openai-responses",
				provider: "openai",
				model: "gpt-5.5",
				responseId: "resp_metadata_should_not_be_encoded",
				usage: {
					input: 1200,
					output: 800,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 2000,
					cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 },
				},
				stopReason: "stop",
				timestamp: 1_700_000_000_000,
				content: [{ type: "text", text: repeated }],
			},
		] as SharedSession["messages"],
	};
}

function richSharedSession(): SharedSession {
	return {
		...sharedSession(),
		schemaVersion: 3,
		trajectory: {
			schemaVersion: 1,
			turnCount: 1,
			turns: [{ id: "turn-1", ordinal: 0, role: "user", text: "Explain recursion", contentFingerprint: "fnv1a:turn" }],
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

const originalCompressionStream = (globalThis as any).CompressionStream;

beforeEach(() => {
	(globalThis as any).localStorage = createMockStorage();
});

afterEach(() => {
	(globalThis as any).CompressionStream = originalCompressionStream;
});

describe("shared session URLs", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("compressed-hash mode produces an actually compressed gz. URL without CompressionStream", async () => {
		(globalThis as any).CompressionStream = undefined;
		const session = sharedSession();

		const result = await sharedSessionUrl(session, "https://keating.help", "compressed-hash");
		const url = new URL(result.url);
		const encoded = new URLSearchParams(url.hash.slice(1)).get("session");

		expect(result.mode).toBe("compressed-hash");
		expect(result.fallback).toBe(false);
		expect(encoded?.startsWith("gz.")).toBe(true);
		expect(encoded?.startsWith("json.")).toBe(false);
		expect(result.url.length).toBeLessThan(JSON.stringify(session).length);
	});

	test("compressed share URLs load back into normalized shared sessions", async () => {
		const result = await sharedSessionUrl(sharedSession(), "https://keating.help", "compressed-hash");
		const url = new URL(result.url);
		const loaded = await loadSharedSessionFromUrl("share1234", url.hash);

		expect(loaded?.id).toBe("share1234");
		expect(loaded?.messages).toHaveLength(2);
		expect((loaded?.messages[1] as any).role).toBe("assistant");
		expect((loaded?.messages[1] as any).content[0].text).toContain("Recursion reduces");
		expect((loaded?.messages[1] as any).responseId).toBeUndefined();
		expect((loaded?.messages[1] as any).usage).toBeUndefined();
	});

	test("shared session result reports invalid snapshot links instead of only null", async () => {
		const loaded = await loadSharedSessionResultFromUrl("share1234", "#session=not-valid");
		expect(loaded.ok).toBe(false);
		if (!loaded.ok) {
			expect(loaded.reason).toBe("invalid-link");
			expect(loaded.message).toContain("unreadable");
		}
	});

	test("shared session result reports share server status failures", async () => {
		globalThis.fetch = (async () => new Response("bad id", { status: 400 })) as unknown as typeof fetch;
		const loaded = await loadSharedSessionResultFromUrl("bad-id", "");
		expect(loaded.ok).toBe(false);
		if (!loaded.ok) {
			expect(loaded.reason).toBe("server-error");
			expect(loaded.status).toBe(400);
			expect(loaded.message).toContain("bad id");
		}
	});

	test("portable-short mode does not fall back to a giant snapshot URL when share storage fails", async () => {
		globalThis.fetch = (async () => new Response("not found", { status: 404 })) as unknown as typeof fetch;

		await expect(sharedSessionUrl(sharedSession(), "https://keating.help", "portable-short"))
			.rejects
			.toThrow("Could not save the session to the share server");
	});

	test("portable-short upload omits the local UUID id and uses the server-minted short id", async () => {
		let uploadedBody: any = null;
		globalThis.fetch = (async (_url: string, init?: RequestInit) => {
			uploadedBody = JSON.parse(String(init?.body ?? "{}"));
			return new Response(JSON.stringify({ id: "srv12345" }), { status: 200 });
		}) as unknown as typeof fetch;

		const result = await sharedSessionUrl(sharedSession(), "https://keating.help", "portable-short");

		// The client must not send its 36-char UUID; the server validates ids as
		// /^[A-Za-z0-9_-]{8,32}$/ and would 400 on it.
		expect(uploadedBody.id).toBeUndefined();
		expect(uploadedBody.title).toBe("Recursion");
		expect(result.mode).toBe("portable-short");
		expect(result.fallback).toBe(false);
		expect(result.url).toBe("https://keating.help/s/srv12345");
		expect(result.url).not.toContain("#session=");
	});

	test("portable upload uses the strict v3 projector and retains only curated trajectory data", async () => {
		let uploadedBody: any = null;
		globalThis.fetch = (async (_url: string, init?: RequestInit) => {
			uploadedBody = JSON.parse(String(init?.body ?? "{}"));
			return new Response(JSON.stringify({ id: "srv54321" }), { status: 200 });
		}) as unknown as typeof fetch;
		const session = richSharedSession() as SharedSession & { privateState?: unknown };
		session.privateState = { token: "secret" };
		(session.messages[1] as any).responseId = "resp-secret";
		(session.messages[1] as any).usage = { cost: 99 };
		session.model = { ...session.model!, api: "openai-responses", baseUrl: "https://private.example/v1" };

		const result = await sharedSessionUrl(session, "https://keating.help", "portable-short");

		expect(result.includesTrajectory).toBe(true);
		expect(uploadedBody.schemaVersion).toBe(3);
		expect(uploadedBody.trajectory.turns[0].id).toBe("turn-1");
		expect(uploadedBody.privateState).toBeUndefined();
		expect(uploadedBody.messages[1].responseId).toBeUndefined();
		expect(uploadedBody.messages[1].usage).toBeUndefined();
		expect(uploadedBody.model.api).toBeUndefined();
		expect(uploadedBody.model.baseUrl).toBeUndefined();
	});

	test("cache quota failures do not invalidate portable or compressed links", async () => {
		(globalThis as any).localStorage = {
			getItem: () => null,
			setItem: () => { throw new DOMException("quota", "QuotaExceededError"); },
		} as unknown as Storage;
		globalThis.fetch = (async () => new Response(JSON.stringify({ id: "srvquota1" }), { status: 200 })) as unknown as typeof fetch;

		const portable = await sharedSessionUrl(richSharedSession(), "https://keating.help", "portable-short");
		const compressed = await sharedSessionUrl(richSharedSession(), "https://keating.help", "compressed-hash");
		expect(portable.url).toBe("https://keating.help/s/srvquota1");
		expect(compressed.url).toContain("#session=");
		await expect(sharedSessionUrl(richSharedSession(), "https://keating.help", "local-short"))
			.rejects
			.toThrow("Could not store this local share");
	});
});

describe("public share warning", () => {
	test("warns for public modes until acknowledged", () => {
		expect(shouldWarnBeforePublicShare("portable-short", false)).toBe(true);
		expect(shouldWarnBeforePublicShare("compressed-hash", false)).toBe(true);
		expect(shouldWarnBeforePublicShare("portable-short", true)).toBe(false);
		expect(shouldWarnBeforePublicShare("compressed-hash", true)).toBe(false);
	});

	test("never warns for on-device local links", () => {
		expect(shouldWarnBeforePublicShare("local-short", false)).toBe(false);
		expect(shouldWarnBeforePublicShare("local-short", true)).toBe(false);
	});
});

describe("shared trajectory curation", () => {
	function artifact(
		id: string,
		artifactType: ReviewArtifactSnapshot["artifact"]["artifactType"],
		overrides: Partial<ReviewArtifactSnapshot> = {},
	): ReviewArtifactSnapshot {
		return {
			schemaVersion: 1,
			id: `snapshot:${id}`,
			reviewId: "review:session-original",
			sessionId: "session-original",
			artifact: {
				source: { source: "filesystem", path: `/private/${id}` },
				artifactType,
				format: artifactType === "animation" ? "text/html" : artifactType === "image" ? "image/png" : "markdown",
				versionId: `${id}-version`,
				contentHash: `${id}-hash`,
				frozen: true,
			},
			label: id,
			content: `${id} content`,
			createdAt: 1,
			capturedAt: 1,
			...overrides,
		};
	}

	test("rebases anchors and publishes only final, safe review data and artifacts", async () => {
		const messages = [
			{ role: "user", timestamp: 10, content: [{ type: "text", text: "Help me with fractions" }] },
			{
				role: "assistant",
				timestamp: 20,
				content: [
					{ type: "text", text: "I will explain with a visual." },
					{ type: "toolCall", id: "tool-private", name: "lookup", arguments: { token: "secret-tool-argument" } },
				],
			},
			{ role: "toolResult", timestamp: 30, content: [{ type: "text", text: "secret-tool-result" }] },
		] as any;
		const assistantAnchor = messageReviewAnchor("session-original", messages[1], 1);
		const plan = artifact("plan-private-id", "plan", { content: "# Fraction plan" });
		const animation = artifact("animation-private-id", "animation", {
			content: "<html><script>privateExecutable()</script></html>",
			secondaryContent: "Storyboard: split a circle into fourths.",
			createdAt: 2,
			capturedAt: 2,
		});
		const generatedImage = artifact("generated-private-id", "image", {
			content: "Diagram\n\nGeneration prompt: private image prompt",
			media: {
				kind: "image",
				dataUrl: "data:image/png;base64,iVBORw0KGgo=",
				alt: "Fraction diagram",
				mimeType: "image/png",
				assetHash: "private-asset-hash",
				naturalWidth: 16,
				naturalHeight: 16,
			},
			metadata: { model: "image-model", generationPrompt: "private image prompt" },
			createdAt: 3,
			capturedAt: 3,
		});
		const learnerUpload = artifact("learner-upload-private-id", "image", {
			media: generatedImage.media,
			metadata: { messageRole: "user", partIndex: 0 },
			createdAt: 4,
			capturedAt: 4,
		});
		const internalBenchmark = artifact("benchmark-private-id", "benchmark", { createdAt: 5, capturedAt: 5 });
		const acceptedRevision = artifact("accepted-private-id", "document", {
			artifact: {
				source: { source: "course", courseId: "private-course", id: "private-storage-id" },
				artifactType: "document",
				format: "markdown",
				versionId: "accepted-version",
				contentHash: "accepted-hash",
				frozen: true,
			},
			content: "Accepted explanation",
			createdAt: 6,
			capturedAt: 6,
		});
		const reviewSnapshot = {
			schemaVersion: 1,
			review: {
				schemaVersion: 1,
				id: "review:session-original",
				sessionId: "session-original",
				status: "final",
				verdict: "accepted",
				ratings: { scaffolding: 5 },
				overallRating: 5,
				summary: "Good final review",
				selectedCandidateIds: { "message:private": "candidate-private" },
				createdAt: 1,
				updatedAt: 9,
			},
			annotations: [
				{
					schemaVersion: 1,
					id: "annotation-private-message",
					reviewId: "review:session-original",
					sessionId: "session-original",
					target: { kind: "message", messageId: assistantAnchor.id, role: "assistant", contentFingerprint: assistantAnchor.contentFingerprint },
					targetKey: `message:${assistantAnchor.id}`,
					kind: "strength",
					category: "scaffolding",
					note: "The visual setup helps.",
					status: "final",
					createdAt: 1,
					updatedAt: 2,
				},
				{
					schemaVersion: 1,
					id: "annotation-private-artifact",
					reviewId: "review:session-original",
					sessionId: "session-original",
					target: { kind: "artifact", artifact: acceptedRevision.artifact },
					targetKey: "artifact:private",
					kind: "suggestion",
					category: "accuracy",
					note: "Keep the accepted revision.",
					status: "final",
					createdAt: 2,
					updatedAt: 3,
				},
				{
					schemaVersion: 1,
					id: "annotation-draft-private",
					reviewId: "review:session-original",
					sessionId: "session-original",
					target: { kind: "session" },
					targetKey: "session",
					kind: "problem",
					category: "draft",
					note: "Never publish this draft.",
					status: "draft",
					createdAt: 3,
					updatedAt: 4,
				},
			],
			candidates: [{ prompt: "private candidate prompt", generation: { secret: true }, content: "candidate output" }],
			modelPools: [{ baseUrl: "https://private-provider.example" }],
			artifacts: [acceptedRevision],
		} as any;

		const trajectory = await buildSharedTrajectory("session-original", messages, {
			captureArtifacts: async () => [plan, animation, generatedImage, learnerUpload, internalBenchmark],
			loadFinalReviewSnapshot: async () => reviewSnapshot,
			validateStoredArtifact: async (value) => value as ReviewArtifactSnapshot,
		});
		const serialized = JSON.stringify(trajectory);

		expect(trajectory.turns.map((turn) => turn.id)).toEqual(["turn-1", "turn-2"]);
		expect(trajectory.turns.every((turn) => !("timestamp" in turn))).toBe(true);
		expect(serialized).not.toContain("secret-tool-result");
		expect(serialized).not.toContain("secret-tool-argument");
		expect(trajectory.artifactCount).toBe(4);
		expect(trajectory.omitted.privateArtifacts).toBe(1);
		expect(trajectory.omitted.internalArtifacts).toBe(1);
		expect(trajectory.artifacts.find((entry) => entry.artifactType === "animation")).toMatchObject({
			contentOmitted: "unsafe-content",
			secondaryContent: "Storyboard: split a circle into fourths.",
		});
		expect(trajectory.artifacts.find((entry) => entry.artifactType === "image")?.content).toBe("generated-private-id\n\nFraction diagram");
		expect(serialized).not.toContain("private image prompt");
		expect(serialized).not.toContain("/private/");
		expect(serialized).not.toContain("private-course");
		expect(serialized).not.toContain("private-storage-id");
		expect(serialized).not.toContain("candidate-private");
		expect(serialized).not.toContain("private candidate prompt");
		expect(trajectory.review?.status).toBe("final");
		expect(trajectory.annotations).toHaveLength(2);
		expect(trajectory.annotations[0].target).toEqual({ kind: "message", turnId: "turn-2" });
		expect(trajectory.annotations[1].target).toEqual({ kind: "artifact", artifactId: "artifact-4" });
	});
});

import { describe, expect, test } from "bun:test";
import { gzipSync, strToU8 } from "fflate";
import {
	COMPRESSED_PREFIX,
	JSON_PREFIX,
	bytesToBase64Url,
	decodeSharedSessionPayload,
	encodeSharedSession,
	minifySharedSession,
} from "../src/keating/share-codec";
import type { SharedSession } from "../src/keating/shared-sessions";
import { contentFingerprint } from "../src/keating/trajectory-review";

function makeSession(overrides: Partial<SharedSession> = {}): SharedSession {
	const text = "Recursion is when a function calls itself to solve a smaller version of the same problem. ".repeat(8);
	const messages = [
		{ role: "user", content: [{ type: "text", text: "Can you explain recursion to me?" }] },
		{
			role: "assistant",
			// Carries metadata a real assistant message would have; none of this
			// should survive into the encoded payload.
			api: "openai-responses",
			provider: "openai",
			model: "gpt-5.5",
			responseId: "resp_0123456789abcdef",
			usage: { input: 1000, output: 2000, cacheRead: 0, cacheWrite: 0, totalTokens: 3000, cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 } },
			stopReason: "stop",
			timestamp: 1_700_000_000_000,
			content: [{ type: "text", text }],
		},
	] as unknown as SharedSession["messages"];
	return {
		id: "abc123xyz",
		schemaVersion: 2,
		title: "Understanding recursion",
		createdAt: "2026-01-01T00:00:00.000Z",
		sharedAt: "2026-01-02T00:00:00.000Z",
		messageCount: messages.length,
		model: { provider: "openai", id: "gpt-5.5", name: "GPT-5.5", api: "openai-responses" },
		thinkingLevel: "medium",
		messages,
		...overrides,
	};
}

function trajectory() {
	return {
		schemaVersion: 1 as const,
		turnCount: 1,
		turns: [{ id: "turn-1", ordinal: 0, role: "user" as const, text: "Explain recursion", contentFingerprint: contentFingerprint("Explain recursion") }],
		artifactCount: 1,
		artifacts: [{
			id: "artifact-1",
			artifactType: "plan" as const,
			format: "markdown",
			label: "Recursion plan",
			content: "Start with a base case.",
			createdAt: 1,
			capturedAt: 2,
		}],
		review: {
			status: "final" as const,
			verdict: "accepted" as const,
			ratings: { scaffolding: 5 as const },
			summary: "Clear progression",
			createdAt: 1,
			updatedAt: 2,
		},
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
	};
}

describe("share-codec", () => {
	test("compresses a realistic session with the gz. prefix", () => {
		const encoded = encodeSharedSession(makeSession());
		expect(encoded.startsWith(COMPRESSED_PREFIX)).toBe(true);
		// The encoded link must be materially smaller than the raw JSON snapshot.
		const rawLength = JSON.stringify(makeSession()).length;
		expect(encoded.length).toBeLessThan(rawLength);
	});

	test("round-trips a session through encode/decode", () => {
		const session = makeSession();
		const decoded = decodeSharedSessionPayload(encodeSharedSession(session));
		expect(decoded?.id).toBe(session.id);
		expect(decoded?.title).toBe(session.title);
		expect(decoded?.messages?.length).toBe(session.messages.length);
		const firstText = (decoded?.messages?.[0] as any)?.content?.[0]?.text;
		expect(firstText).toBe("Can you explain recursion to me?");
	});

	test("strips non-rendered assistant metadata before encoding", () => {
		const minified = minifySharedSession(makeSession());
		const assistant = minified.messages[1] as any;
		expect(assistant.role).toBe("assistant");
		expect(assistant.content).toEqual([{ type: "text", text: expect.any(String) }]);
		// None of the heavy provider/model/usage metadata should remain.
		expect(assistant.usage).toBeUndefined();
		expect(assistant.responseId).toBeUndefined();
		expect(assistant.provider).toBeUndefined();
		expect(assistant.timestamp).toBeUndefined();
	});

	test("retains the curated v3 trajectory while stripping every non-wire field", () => {
		const session = makeSession({
			schemaVersion: 3,
			trajectory: trajectory(),
			model: {
				provider: "openai",
				id: "gpt-5.5",
				name: "GPT-5.5",
				api: "openai-responses",
				baseUrl: "https://private-provider.example/v1",
			},
		}) as SharedSession & { internalSecret?: string };
		session.internalSecret = "do-not-publish";

		const minified = minifySharedSession(session) as any;
		expect(minified.schemaVersion).toBe(3);
		expect(minified.trajectory).toEqual(trajectory());
		expect(minified.internalSecret).toBeUndefined();
		expect(minified.model.api).toBeUndefined();
		expect(minified.model.baseUrl).toBeUndefined();
		expect(minified.messages[1].usage).toBeUndefined();

		const decoded = decodeSharedSessionPayload(encodeSharedSession(session));
		expect(decoded?.schemaVersion).toBe(3);
		expect(decoded?.trajectory?.artifacts[0]?.content).toBe("Start with a base case.");
	});

	test("decodes legacy gzip links produced by CompressionStream-style gzip", () => {
		// A `gz.` link created with a different (standard) gzip encoder must still
		// decode, proving backward compatibility with previously shared links.
		const session = makeSession({ id: "legacy123" });
		const payload = {
			id: session.id,
			schemaVersion: 2,
			title: session.title,
			createdAt: session.createdAt,
			sharedAt: session.sharedAt,
			messageCount: 1,
			messages: [{ role: "user", content: [{ type: "text", text: "Legacy link" }] }],
		};
		const gz = gzipSync(strToU8(JSON.stringify(payload)));
		const legacyLink = `${COMPRESSED_PREFIX}${bytesToBase64Url(gz)}`;
		const decoded = decodeSharedSessionPayload(legacyLink);
		expect(decoded?.id).toBe("legacy123");
	});

	test("decodes legacy uncompressed json. links", () => {
		const payload = {
			id: "json123",
			title: "Plain",
			messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
		};
		const bytes = new TextEncoder().encode(JSON.stringify(payload));
		const link = `${JSON_PREFIX}${bytesToBase64Url(bytes)}`;
		expect(decodeSharedSessionPayload(link)?.id).toBe("json123");
	});

	test("returns null for malformed payloads", () => {
		expect(decodeSharedSessionPayload("gz.not-valid-gzip!!!")).toBeNull();
		expect(decodeSharedSessionPayload("json.@@@notbase64@@@")).toBeNull();
	});

	test("rejects compressed payloads whose advertised output exceeds the public cap", () => {
		const oversized = gzipSync(strToU8("x".repeat(512 * 1024 + 1)));
		const encoded = `${COMPRESSED_PREFIX}${bytesToBase64Url(oversized)}`;
		expect(decodeSharedSessionPayload(encoded)).toBeNull();
	});

	test("round-trips unicode content", () => {
		const session = makeSession({
			messages: [{ role: "user", content: [{ type: "text", text: "héllo · 日本語 · 🎓 recursion" }] }] as any,
			messageCount: 1,
		});
		const decoded = decodeSharedSessionPayload(encodeSharedSession(session));
		expect((decoded?.messages?.[0] as any)?.content?.[0]?.text).toBe("héllo · 日本語 · 🎓 recursion");
	});
});

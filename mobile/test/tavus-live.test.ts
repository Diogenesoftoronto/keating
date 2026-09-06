import { describe, expect, test } from "bun:test";
import type { PortableLearnerData } from "@keating/learner-contracts";
import {
  buildMobileTavusContext,
  createMobileTavusConversation,
  parseTavusAppMessage,
  resolveTavusToolCall,
	safeMobileTavusText,
} from "../src/lib/tavus-live";
import type { ChatSession } from "../src/lib/types";

const learnerData: PortableLearnerData = {
  generatedAt: "2026-08-29T12:00:00.000Z",
  sessions: [],
  artifacts: [{
    id: "artifact-notes",
    kind: "document",
    format: "text",
    title: "Matrix notes",
    content: "Eigenvectors keep their direction under the transformation.",
    createdAt: "2026-08-29T11:00:00.000Z",
    updatedAt: "2026-08-29T11:00:00.000Z",
  }],
  goals: [],
  questionChecks: [],
  quizResults: [],
  decks: [],
  cardReviews: [],
  studyPriorities: [],
  feedbackEvents: [],
  usageEvents: [],
  topicEvidence: [],
  benchmarks: [],
  evolutions: [],
  learnerProfile: {
    topicsExplored: ["matrices"],
    strengths: ["worked examples"],
    weaknesses: ["eigenvalue intuition"],
    sessionsCount: 4,
  },
};

const session: ChatSession = {
  id: "session-live",
  title: "Eigenvectors",
  createdAt: 1,
  updatedAt: 2,
  messages: [
    { id: "message-1", role: "user", content: "Why does the direction stay fixed?", createdAt: 1 },
    { id: "message-2", role: "assistant", content: "Think of a transformation stretching one line.", createdAt: 2 },
  ],
};

describe("native Tavus Live contracts", () => {
  test("builds a bounded dossier from the active lesson and learner evidence", () => {
    const context = buildMobileTavusContext({
      session,
      learnerContext: "I learn visually.",
      learnerData,
      artifacts: [],
    });
    expect(context).toContain("I learn visually.");
    expect(context).toContain("eigenvalue intuition");
    expect(context).toContain("Matrix notes");
    expect(context).toContain("Learner: Why does the direction stay fixed?");
    expect(context.length).toBeLessThanOrEqual(12_000);
  });

	test("reserves the bounded dossier for the current conversation before artifacts", () => {
		const context = buildMobileTavusContext({
			session: {
				...session,
				messages: [{ id: "latest", role: "user", content: "CURRENT MOBILE TURN MUST SURVIVE", createdAt: 3 }],
			},
			learnerContext: "profile ".repeat(2_000),
			learnerData: {
				...learnerData,
				artifacts: Array.from({ length: 12 }, (_, index) => ({
					...learnerData.artifacts[0]!,
					id: `artifact-${index}`,
					title: `Artifact ${index}`,
					content: "artifact ".repeat(500),
				})),
			},
			artifacts: [],
		});
		expect(context).toContain("CURRENT MOBILE TURN MUST SURVIVE");
		expect(context.length).toBeLessThanOrEqual(12_000);
	});

	test("redacts credentials from every mobile dossier source", () => {
		const secretKey = "sk-ant-abcdefghijklmnop";
		const bearer = "Bearer abcdefghijklmnopqrstuvwxyz.123456";
		const privateKey = "-----BEGIN PRIVATE KEY-----\nsecret-material\n-----END PRIVATE KEY-----";
		const context = buildMobileTavusContext({
			session: {
				...session,
				messages: [{ id: "secret-message", role: "user", content: bearer, createdAt: 3 }],
			},
			learnerContext: `My key is ${secretKey}`,
			learnerData: {
				...learnerData,
				artifacts: [{ ...learnerData.artifacts[0]!, content: privateKey }],
				learnerProfile: {
					...learnerData.learnerProfile,
					weaknesses: ["SERVICE_API_KEY=top-secret-value"],
				},
			},
			artifacts: [],
		});
		expect(context).not.toContain(secretKey);
		expect(context).not.toContain(bearer);
		expect(context).not.toContain("secret-material");
		expect(context).not.toContain("top-secret-value");
		expect(context.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(4);
		expect(safeMobileTavusText(`token ${secretKey}`, 100)).toBe("token [REDACTED]");
	});

  test("normalizes utterances and tool calls from Daily app messages", () => {
    expect(parseTavusAppMessage({ data: {
      event_type: "conversation.utterance",
      inference_id: "utterance-1",
      properties: { role: "pal", speech: "Let's make a retrieval check." },
    } })).toEqual({ kind: "utterance", id: "utterance-1", role: "assistant", text: "Let's make a retrieval check." });
    expect(parseTavusAppMessage({
      event_type: "conversation.tool_call",
      conversation_id: "c_mobile",
      properties: { tool_call_id: "tool-1", name: "quiz", arguments: '{"topic":"matrices"}' },
    })).toEqual({
      kind: "tool-call",
      call: { callId: "tool-1", name: "quiz", arguments: { topic: "matrices" }, conversationId: "c_mobile" },
    });
  });

  test("returns compact success and error tool results without throwing into the call", async () => {
    const call = { callId: "tool-1", name: "deck", arguments: { topic: "matrices" }, conversationId: "c_mobile" };
    await expect(resolveTavusToolCall(call, async () => ({ deckId: "deck-1" }))).resolves.toMatchObject({
      event_type: "conversation.tool_result",
      properties: { tool_call_id: "tool-1", output: '{"deckId":"deck-1"}', status: "success" },
    });
    await expect(resolveTavusToolCall(call, async () => { throw new Error("Deck write failed."); })).resolves.toMatchObject({
      properties: { tool_call_id: "tool-1", output: "Deck write failed.", status: "error" },
    });
  });
});

test("cancellation receives allocated conversation IDs for cleanup instead of aborting the POST", async () => {
  const { saveDeviceSession, setAccountCredentialStoreForTests } = await import("../src/lib/notorganic-account/credentials");
  const { setDeviceKeyAdapterForTests } = await import("../src/lib/notorganic-account/dpop");
  const { setAccountCryptoAdapterForTests } = await import("../src/lib/notorganic-account/crypto");
  const values = new Map<string, string>();
  setAccountCredentialStoreForTests({ getItem: async (key) => values.get(key) ?? null, setItem: async (key, value) => { values.set(key, value); }, deleteItem: async (key) => { values.delete(key); } });
  setDeviceKeyAdapterForTests({ getOrCreatePublicJwkAsync: async () => ({ kty: "EC", crv: "P-256", x: "x", y: "y" }), signAsync: async () => "signature", deleteKeyAsync: async () => undefined });
  setAccountCryptoAdapterForTests({ randomBytes: async (length) => new Uint8Array(length), sha256Base64: async () => "hash" });
  const originalFetch = globalThis.fetch;
  const abort = new AbortController();
  let requests = 0;
  try {
    await saveDeviceSession({ accessToken: "access", accessExpiresAt: Date.now() + 60_000, refreshToken: "refresh", refreshExpiresAt: Date.now() + 120_000, scope: "realtime:connect" });
    globalThis.fetch = (async (_url, init) => {
      requests += 1;
      abort.abort();
      expect(init?.signal).toBeUndefined();
      return Response.json({ conversationId: "allocated", embedUrl: "https://call.test", terminationToken: "end-token", status: "active" });
    }) as typeof fetch;
    await expect(createMobileTavusConversation("lesson", abort.signal)).resolves.toMatchObject({ conversationId: "allocated", terminationToken: "end-token" });
    await expect(createMobileTavusConversation("lesson", abort.signal)).rejects.toThrow("cancelled");
    expect(requests).toBe(1);
  } finally {
    globalThis.fetch = originalFetch;
    setAccountCredentialStoreForTests(null);
    setDeviceKeyAdapterForTests(null);
    setAccountCryptoAdapterForTests(null);
  }
});

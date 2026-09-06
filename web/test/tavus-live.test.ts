import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { startTavusLiveSession, tavusConversationContext, tavusLiveProvider } from "../src/keating/speech-providers/tavus-live";
import { DEFAULT_WEB_SPEECH_SETTINGS } from "../src/keating/speech";

const originalFetch = globalThis.fetch;
const capabilityRequests: Array<{ path: string; method: string }> = [];
const authenticated = {
	capabilityHeaders: async (path: string, method: string) => {
		capabilityRequests.push({ path, method });
		return {
			authorization: "DPoP test-access-token",
			"x-notorganic-dpop": "test-provider-proof",
		};
	},
};

afterEach(() => {
	globalThis.fetch = originalFetch;
	capabilityRequests.length = 0;
});

describe("Tavus Live provider", () => {
	test("does not allocate when already cancelled or cancelled while obtaining credentials", async () => {
		let allocations = 0;
		globalThis.fetch = (async () => { allocations += 1; return Response.json({}); }) as unknown as typeof fetch;
		for (const alreadyAborted of [true, false]) {
			const controller = new AbortController();
			if (alreadyAborted) controller.abort();
			await expect(startTavusLiveSession({
				settings: DEFAULT_WEB_SPEECH_SETTINGS,
				getApiKey: async () => undefined,
				signal: controller.signal,
			}, {
				capabilityHeaders: async (path, method) => {
					controller.abort();
					return authenticated.capabilityHeaders(path, method);
				},
			})).rejects.toThrow("cancelled");
		}
		expect(allocations).toBe(0);
	});

	test("terminates a late allocation when cancelled during the creation request", async () => {
		const controller = new AbortController();
		const requests: Request[] = [];
		globalThis.fetch = (async (input, init) => {
			const request = new Request(new URL(String(input), "https://keating.test"), init);
			requests.push(request);
			if (String(input).endsWith("/end")) return Response.json({ ended: true });
			controller.abort();
			// An abortable allocation fetch would discard the only cleanup token.
			if (request.signal.aborted) throw new DOMException("Aborted", "AbortError");
			return Response.json({
				conversationId: "c_cancelled_123",
				embedUrl: "https://tavus.daily.co/c_cancelled_123",
				terminationToken: "late-cleanup-token",
				status: "active",
			});
		}) as typeof fetch;
		await expect(startTavusLiveSession({
			settings: DEFAULT_WEB_SPEECH_SETTINGS,
			getApiKey: async () => undefined,
			signal: controller.signal,
		}, authenticated)).rejects.toThrow("cancelled");
		expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
			"/api/tavus/conversations",
			"/api/tavus/conversations/c_cancelled_123/end",
		]);
		expect(requests[1]?.headers.get("x-tavus-termination-token")).toBe("late-cleanup-token");
	});

	test("shares an in-flight stop and permits retry after termination fails", async () => {
		let endings = 0;
		let completeEnd!: (response: Response) => void;
		globalThis.fetch = (async (input) => {
			if (String(input).endsWith("/end")) {
				endings += 1;
				if (endings === 1) return Response.json({ statusMessage: "Temporary cleanup failure" }, { status: 503 });
				return new Promise<Response>((resolve) => { completeEnd = resolve; });
			}
			return Response.json({
				conversationId: "c_retry_123",
				embedUrl: "https://tavus.daily.co/c_retry_123",
				terminationToken: "retry-cleanup-token",
				status: "active",
			});
		}) as typeof fetch;
		const session = await startTavusLiveSession({
			settings: DEFAULT_WEB_SPEECH_SETTINGS,
			getApiKey: async () => undefined,
		}, authenticated);
		await expect(session.stop()).rejects.toThrow("Temporary cleanup failure");
		const retry = session.stop();
		const concurrentStop = session.stop();
		let concurrentFinished = false;
		void concurrentStop.then(() => { concurrentFinished = true; });
		await Promise.resolve();
		expect(endings).toBe(2);
		expect(concurrentFinished).toBe(false);
		completeEnd(Response.json({ ended: true }));
		await Promise.all([retry, concurrentStop]);
		await session.stop();
		expect(endings).toBe(2);
		expect(session.state).toBe("closed");
	});

	test("aborts stalled termination after the cleanup timeout", async () => {
		const timeoutController = new AbortController();
		const timeout = spyOn(AbortSignal, "timeout").mockImplementation(() => timeoutController.signal);
		try {
			globalThis.fetch = (async (input, init) => {
				if (String(input).endsWith("/end")) {
					return new Promise<Response>((_resolve, reject) => {
						init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
					});
				}
				return Response.json({
					conversationId: "c_timeout_123",
					embedUrl: "https://tavus.daily.co/c_timeout_123",
					terminationToken: "timeout-cleanup-token",
					status: "active",
				});
			}) as typeof fetch;
			const session = await startTavusLiveSession({
				settings: DEFAULT_WEB_SPEECH_SETTINGS,
				getApiKey: async () => undefined,
			}, authenticated);
			const stopping = session.stop();
			await Promise.resolve();
			expect(timeout).toHaveBeenCalledWith(10_000);
			timeoutController.abort(new DOMException("Cleanup timed out", "TimeoutError"));
			await expect(stopping).rejects.toThrow("Cleanup timed out");
			expect(session.state).toBe("closed");
		} finally {
			timeout.mockRestore();
		}
	});

	test("creates an embedded KeatingBot call with recent lesson context", async () => {
		const requests: Request[] = [];
		globalThis.fetch = (async (input, init) => {
			const request = new Request(new URL(String(input), "https://keating.test"), init);
			requests.push(request);
			return Response.json({
				conversationId: "c_keating_123",
				embedUrl: "https://tavus.daily.co/c_keating_123?t=short-lived",
				terminationToken: "termination-token-123",
				status: "active",
			});
		}) as typeof fetch;
		const states: string[] = [];
		const session = await startTavusLiveSession({
			settings: { ...DEFAULT_WEB_SPEECH_SETTINGS, providerId: "tavus", model: "keatingbot" },
			getApiKey: async () => undefined,
			history: [
				{ role: "user", text: "Help me understand eigenvectors." },
				{ role: "assistant", text: "Start with a transformation that stretches one direction." },
			],
			onState: (state) => states.push(state),
		}, authenticated);

		expect(session.embeddedSurface).toEqual({
			kind: "tavus",
			url: "https://tavus.daily.co/c_keating_123?t=short-lived",
			title: "KeatingBot interactive video conversation",
		});
		expect(session.videoCapable).toBe(false);
		expect(session.videoRoute).toBe("provider-hosted");
		expect(states).toEqual(["connecting", "listening"]);
		const createBody = await requests[0]?.json() as { conversationalContext: string };
		expect(requests[0]?.headers.get("authorization")).toBe("DPoP test-access-token");
		expect(requests[0]?.headers.get("x-notorganic-dpop")).toBe("test-provider-proof");
		expect(createBody.conversationalContext).toContain("Learner: Help me understand eigenvectors.");
		expect(createBody.conversationalContext).toContain("Keating: Start with a transformation");

		await session.stop();
		await session.stop();
		expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
			"/api/tavus/conversations",
			"/api/tavus/conversations/c_keating_123/end",
		]);
		expect(requests[1]?.headers.get("authorization")).toBe("DPoP test-access-token");
		expect(requests[1]?.headers.get("x-notorganic-dpop")).toBe("test-provider-proof");
		expect(requests[1]?.headers.get("x-tavus-termination-token")).toBe("termination-token-123");
		expect(capabilityRequests).toEqual([
			{ path: "/v1/tavus/conversations", method: "POST" },
			{ path: "/v1/tavus/conversations/c_keating_123/end", method: "POST" },
		]);
		expect(states.at(-1)).toBe("closed");
	});

	test("surfaces the same-origin broker error", async () => {
		globalThis.fetch = (async () => Response.json(
			{ statusMessage: "Tavus Live is not configured on this Keating server." },
			{ status: 503 },
		)) as unknown as typeof fetch;
		await expect(startTavusLiveSession({
			settings: { ...DEFAULT_WEB_SPEECH_SETTINGS, providerId: "tavus", model: "keatingbot" },
			getApiKey: async () => undefined,
		}, authenticated)).rejects.toThrow("Tavus Live is not configured");
	});

	test("registers Tavus as a duplex PAL rather than a browser API-key provider", () => {
		expect(tavusLiveProvider).toMatchObject({
			id: "tavus",
			kind: "duplex",
		});
		expect("needsApiKey" in tavusLiveProvider).toBe(false);
	});

	test("hands the PAL a redacted learner, course, document, and artifact dossier", () => {
		const context = tavusConversationContext(
			[{ role: "user", text: "Use token aabbccddeeff00112233445566778899 while we study." }],
			{
				sessionId: "session_1",
				learner: {
					displayName: "Ada",
					role: "student",
					providedProfile: "I learn best from worked examples.",
					strengths: ["linear algebra"],
					needsReview: ["eigenvalue intuition"],
					recentTopics: ["matrices"],
					studyPriorities: ["topic: eigenvectors (focus)"],
				},
				course: {
					id: "course_1",
					title: "Linear Algebra",
					outcomes: ["Explain eigendecomposition"],
					currentLesson: {
						id: "lesson_1",
						title: "Eigenvectors",
						objectives: ["Recognize invariant directions"],
					},
					completedLessons: 2,
					totalLessons: 8,
				},
				documents: [{ title: "notes.pdf", kind: "application/pdf", excerpt: "A basis changes coordinates.", source: "session" }],
				artifacts: [{ title: "Matrix map", kind: "lesson map", excerpt: "matrix --> eigenvector", source: "session" }],
			},
		);
		expect(context).toContain("Name: Ada");
		expect(context).toContain("Current lesson: Eigenvectors");
		expect(context).toContain("notes.pdf");
		expect(context).toContain("Matrix map");
		expect(context).not.toContain("aabbccddeeff00112233445566778899");
		expect(context).toContain("[REDACTED]");
	});

	test("keeps recent turns inside the server context budget ahead of optional dossier material", () => {
		const context = tavusConversationContext(
			[{ role: "user", text: "CURRENT LESSON TURN MUST SURVIVE" }],
			{
				learner: {
					providedProfile: "profile ".repeat(2_000),
					strengths: Array.from({ length: 20 }, (_, index) => `strength ${index} ${"x".repeat(500)}`),
					needsReview: [],
					recentTopics: [],
					studyPriorities: [],
				},
				documents: Array.from({ length: 5 }, (_, index) => ({ title: `document ${index}`, kind: "text", excerpt: "d".repeat(900), source: "session" as const })),
				artifacts: Array.from({ length: 6 }, (_, index) => ({ title: `artifact ${index}`, kind: "note", excerpt: "a".repeat(900), source: "session" as const })),
			},
		);
		expect(context?.slice(0, 12_000)).toContain("CURRENT LESSON TURN MUST SURVIVE");
	});

	test("feeds Tavus utterances back into the Keating transcript once", async () => {
		globalThis.fetch = (async (input: URL | RequestInfo) => {
			if (String(input).includes("/end")) return Response.json({ status: "ended" });
			return Response.json({
				conversationId: "c_keating_events",
				embedUrl: "https://tavus.daily.co/c_keating_events?t=short-lived",
				terminationToken: "termination-token-events",
				status: "active",
			});
		}) as typeof fetch;
		const turns: string[] = [];
		const events: string[] = [];
		const session = await startTavusLiveSession({
			settings: { ...DEFAULT_WEB_SPEECH_SETTINGS, providerId: "tavus", model: "keatingbot" },
			getApiKey: async () => undefined,
			conversationIds: { sessionId: "keating_session" },
			onUserTranscript: (text) => turns.push(`user:${text}`),
			onAssistantTranscript: (text) => turns.push(`assistant:${text}`),
			onConversationEvent: (event) => events.push(`${event.type}:${event.sessionId}`),
		}, authenticated);
		session.handleEmbeddedEvent?.({
			event_type: "conversation.utterance",
			seq: 1,
			inference_id: "inference_user",
			properties: { role: "user", speech: "Can we draw that?" },
		});
		session.handleEmbeddedEvent?.({
			event_type: "conversation.utterance",
			seq: 2,
			inference_id: "inference_pal",
			properties: { role: "pal", speech: "Yes, let us map the transformation." },
		});
		// Tavus also emits a legacy replica-role duplicate for PAL turns.
		session.handleEmbeddedEvent?.({
			event_type: "conversation.utterance",
			seq: 3,
			inference_id: "inference_pal",
			properties: { role: "replica", speech: "Yes, let us map the transformation." },
		});
		expect(turns).toEqual([
			"user:Can we draw that?",
			"assistant:Yes, let us map the transformation.",
		]);
		expect(events).toEqual([
			"transcript.delta:keating_session",
			"transcript.delta:keating_session",
		]);
		await session.stop();
	});

	test("executes an allowed Keating tool and returns a Tavus app-message result", async () => {
		globalThis.fetch = (async (input: URL | RequestInfo) => {
			if (String(input).includes("/end")) return Response.json({ status: "ended" });
			return Response.json({
				conversationId: "c_keating_tools",
				embedUrl: "https://tavus.daily.co/c_keating_tools?t=short-lived",
				terminationToken: "termination-token-tools",
				status: "active",
			});
		}) as typeof fetch;
		const calls: unknown[] = [];
		const session = await startTavusLiveSession({
			settings: { ...DEFAULT_WEB_SPEECH_SETTINGS, providerId: "tavus", model: "keatingbot" },
			getApiKey: async () => undefined,
			tools: [{ name: "deck", description: "Save a deck", parameters: {} }],
			onToolCall: async (call) => {
				calls.push(call);
				return { deckId: "deck-1", cardCount: 3 };
			},
		}, authenticated);
		const result = await session.handleEmbeddedEvent?.({
			event_type: "conversation.tool_call",
			conversation_id: "c_keating_tools",
			properties: {
				tool_call_id: "call-1",
				name: "deck",
				arguments: JSON.stringify({ topic: "eigenvectors", cards: [] }),
			},
		});
		expect(calls).toEqual([{ callId: "call-1", name: "deck", arguments: { topic: "eigenvectors", cards: [] } }]);
		expect(result).toEqual({
			message_type: "conversation",
			event_type: "conversation.tool_result",
			conversation_id: "c_keating_tools",
			properties: {
				tool_call_id: "call-1",
				output: '{"deckId":"deck-1","cardCount":3}',
				status: "success",
			},
		});
		await session.stop();
	});
});

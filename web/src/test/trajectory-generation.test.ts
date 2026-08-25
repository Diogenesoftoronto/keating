import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
	Api,
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	Model,
	SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import {
	ReviewGenerationAbortedError,
	ReviewModelUnavailableError,
	assertTextReviewCandidateGeneration,
	buildReviewGenerationContext,
	buildReviewGenerationPrompt,
	generateReviewCandidates,
	serializeReviewTrajectory,
	supportsTextReviewCandidateGeneration,
	type GeneratedReviewCandidate,
	type ReviewStreamFn,
} from "../keating/trajectory-generation";
import {
	storedModelReference,
	type ReviewCandidateTarget,
	type ReviewModelPool,
	type TrajectoryAnnotation,
} from "../keating/trajectory-review";

function model(provider: string, id: string, cost = { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 }): Model<Api> {
	return {
		provider,
		id,
		name: `${provider} ${id}`,
		api: provider === "browser" ? "browser" : "openai-completions",
		baseUrl: provider === "browser" ? "" : `https://${provider}.test/v1`,
		reasoning: false,
		input: ["text"],
		cost,
		contextWindow: 32_000,
		maxTokens: 4_096,
	};
}

function pool(models: Model<Api>[], candidateCount = models.length): ReviewModelPool {
	return {
		schemaVersion: 1,
		id: "pool-1",
		name: "Review pool",
		tasks: ["response", "artifact:plan"],
		models: models.map(storedModelReference),
		candidateCount,
		temperature: 0.4,
		maxTokens: 2_000,
		createdAt: 1,
		updatedAt: 1,
	};
}

const target: ReviewCandidateTarget = {
	kind: "response",
	messageId: "assistant-2",
	messageTimestamp: 30,
	originalContent: "The answer is 4. Memorize it.",
};

function artifactTarget(artifactType: "image" | "video" | "audio" | "animation"): ReviewCandidateTarget {
	return {
		kind: "artifact",
		topic: "fractions",
		originalContent: "Frozen artifact source",
		artifact: {
			source: { source: "indexeddb", store: "artifacts", id: `${artifactType}-1` },
			artifactType,
			format: artifactType === "animation" ? "html" : `native-${artifactType}`,
			versionId: `${artifactType}-version-1`,
			contentHash: `${artifactType}-hash-1`,
			frozen: true,
		},
	};
}

const annotation: TrajectoryAnnotation = {
	schemaVersion: 1,
	id: "annotation-1",
	reviewId: "review-1",
	sessionId: "session-1",
	target: {
		kind: "message",
		messageId: "assistant-2",
		role: "assistant",
		messageTimestamp: 30,
		contentFingerprint: "fingerprint",
	},
	targetKey: "message:assistant-2",
	kind: "suggestion",
	category: "scaffolding",
	severity: 3,
	note: "Elicit the learner's method before giving the result.",
	pedagogicalImpact: "The original removes productive struggle.",
	suggestedAlternative: "Ask for the first step and offer one hint.",
	status: "final",
	createdAt: 1,
	updatedAt: 1,
};

const trajectory = [
	{ role: "user", timestamp: 10, content: "How do I solve 2 + 2?" },
	{
		role: "assistant",
		timestamp: 20,
		provider: "test",
		model: "teacher",
		api: "openai-completions",
		content: [
			{ type: "text", text: "Let me inspect the learner state." },
			{ type: "toolCall", id: "tool-1", name: "learner_state", arguments: { topic: "addition" } },
		],
		stopReason: "toolUse",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	},
	{
		role: "toolResult",
		timestamp: 25,
		toolCallId: "tool-1",
		toolName: "learner_state",
		content: [{ type: "text", text: "Learner uses counting." }],
		details: { confidence: 0.8 },
		isError: false,
	},
	{
		role: "assistant",
		timestamp: 30,
		provider: "test",
		model: "teacher",
		api: "openai-completions",
		content: [{ type: "text", text: target.originalContent }],
		stopReason: "stop",
		usage: {
			input: 4,
			output: 4,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 8,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	},
] as AgentMessage[];

function assistantMessage(
	selectedModel: Model<Api>,
	content: string,
	stopReason: AssistantMessage["stopReason"] = "stop",
	errorMessage?: string,
	costTotal = 0,
): AssistantMessage {
	return {
		role: "assistant",
		api: selectedModel.api,
		provider: selectedModel.provider,
		model: selectedModel.id,
		content: [{ type: "text", text: content }],
		stopReason,
		errorMessage,
		timestamp: 100,
		usage: {
			input: 120,
			output: 40,
			cacheRead: 10,
			cacheWrite: 0,
			totalTokens: 170,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: costTotal },
		},
	};
}

function resultStream(message: AssistantMessage): AssistantMessageEventStream {
	return { result: async () => message } as AssistantMessageEventStream;
}

function input(reviewPool: ReviewModelPool) {
	return {
		reviewId: "review-1",
		sessionId: "session-1",
		target,
		trajectory,
		annotations: [annotation],
		pool: reviewPool,
	};
}

describe("trajectory review generation", () => {
	it("serializes assistant and tool context into one explicit, tool-free user message", () => {
		const serialized = serializeReviewTrajectory(trajectory);
		expect(serialized).toContain("Let me inspect the learner state.");
		expect(serialized).toContain('"name": "learner_state"');
		expect(serialized).toContain("Learner uses counting.");

		const context = buildReviewGenerationContext({ target, trajectory, annotations: [annotation] }, 55);
		expect(context.messages).toHaveLength(1);
		expect(context.messages[0].role).toBe("user");
		expect(context.tools).toEqual([]);
		expect(context.messages[0].content).toContain("full_session_trajectory");
		expect(context.messages[0].content).toContain("productive struggle");
	});

	it("summarizes embedded media bytes instead of sending them in trajectory text", () => {
		const dataUrl = `data:image/png;base64,${"A".repeat(128)}`;
		const payload = JSON.stringify(JSON.stringify({ title: "Diagram", dataUrl }));
		const mediaTrajectory = [{
			role: "assistant",
			timestamp: 40,
			content: [{ type: "text", text: `<keating-image json=${payload} />` }],
			details: { preview: dataUrl },
		}] as unknown as AgentMessage[];
		const serialized = serializeReviewTrajectory(mediaTrajectory);

		expect(serialized).toContain("image artifact payload omitted");
		expect(serialized).not.toContain(dataUrl);
		expect(serialized).not.toContain("A".repeat(64));
	});

	it("redacts secret-shaped values before a hosted prompt is serialized or persisted", async () => {
		const selected = model("provider-a", "teacher");
		const apiKey = "sk-abcdefghijklmnop";
		const bearer = "Bearer abcdefghijklmnop";
		const sensitiveTrajectory = [
			{ role: "user", timestamp: 10, content: `Please use ${apiKey}` },
			{
				role: "assistant",
				timestamp: 20,
				provider: "provider-a",
				model: "teacher",
				api: "openai-completions",
				content: [{
					type: "toolCall",
					id: "tool-secret",
					name: "lookup",
					arguments: { apiKey, nested: { authorization: bearer } },
				}],
				stopReason: "toolUse",
				usage: {
					input: 1,
					output: 1,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 2,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			},
			{
				role: "toolResult",
				timestamp: 25,
				toolCallId: "tool-secret",
				toolName: "lookup",
				content: [{ type: "text", text: bearer }],
				details: { sessionToken: "opaque-session-value" },
				isError: false,
			},
		] as AgentMessage[];
		const sensitiveTarget = { ...target, originalContent: `${target.originalContent} ${apiKey}` };
		const sensitiveAnnotation = { ...annotation, note: `${annotation.note} ${bearer}` };
		let streamedPrompt = "";
		const [candidate] = await generateReviewCandidates({
			...input(pool([selected], 1)),
			target: sensitiveTarget,
			trajectory: sensitiveTrajectory,
			annotations: [sensitiveAnnotation],
		}, {
			getSelectableModels: async () => [selected],
			stream: async (_model, context) => {
				streamedPrompt = String(context.messages[0]?.content ?? "");
				return resultStream(assistantMessage(selected, "Safe revision"));
			},
		});

		for (const prompt of [streamedPrompt, candidate.prompt, serializeReviewTrajectory(sensitiveTrajectory)]) {
			expect(prompt).toContain("[REDACTED]");
			expect(prompt).not.toContain(apiKey);
			expect(prompt).not.toContain(bearer);
			expect(prompt).not.toContain("opaque-session-value");
		}
		const toolCall = (sensitiveTrajectory[1] as unknown as {
			content: Array<{ arguments?: { apiKey?: string } }>;
		}).content[0];
		expect(toolCall.arguments?.apiKey).toBe(apiKey);
	});

	it("requires a frozen artifact source and pins its version in the prompt", () => {
		const artifactTarget: ReviewCandidateTarget = {
			kind: "artifact",
			topic: "fractions",
			originalContent: "# Fractions",
			artifact: {
				source: { source: "indexeddb", store: "plans", id: "plan-1" },
				artifactType: "plan",
				format: "markdown",
				versionId: "version-3",
				contentHash: "sha256:abc",
				frozen: true,
			},
		};
		const prompt = buildReviewGenerationPrompt({ target: artifactTarget, trajectory, annotations: [annotation] });
		expect(prompt).toContain('"versionId": "version-3"');
		expect(prompt).toContain('"contentHash": "sha256:abc"');
		expect(prompt).toContain("without modifying the frozen source");

		expect(() => buildReviewGenerationPrompt({
			target: { ...artifactTarget, artifact: { ...artifactTarget.artifact, frozen: false } },
			trajectory,
			annotations: [annotation],
		})).toThrow("frozen source version");
	});

	it("fails closed for native media artifacts while retaining text-backed animation", async () => {
		const selected = model("provider-a", "teacher");
		let catalogCalls = 0;
		for (const artifactType of ["image", "video", "audio"] as const) {
			const mediaTarget = artifactTarget(artifactType);
			expect(supportsTextReviewCandidateGeneration(mediaTarget)).toBe(false);
			expect(() => assertTextReviewCandidateGeneration(mediaTarget)).toThrow(`native ${artifactType} artifacts`);
			expect(() => buildReviewGenerationPrompt({
				target: mediaTarget,
				trajectory,
				annotations: [],
			})).toThrow(`native ${artifactType} artifacts`);

			await expect(generateReviewCandidates({
				reviewId: "review-1",
				sessionId: "session-1",
				target: mediaTarget,
				trajectory,
				annotations: [],
				pool: {
					...pool([selected], 1),
					tasks: [`artifact:${artifactType}`],
				},
			}, {
				getSelectableModels: async () => {
					catalogCalls += 1;
					return [selected];
				},
			})).rejects.toThrow(`native ${artifactType} artifacts`);
		}
		expect(catalogCalls).toBe(0);

		const animationTarget = artifactTarget("animation");
		expect(supportsTextReviewCandidateGeneration(animationTarget)).toBe(true);
		expect(buildReviewGenerationPrompt({
			target: animationTarget,
			trajectory,
			annotations: [],
		})).toContain("complete replacement animation artifact");
	});

	it("resolves every pool entry by exact provider and id without fallback", async () => {
		const selected = model("provider-a", "teacher");
		let streamCalls = 0;
		await expect(generateReviewCandidates(input(pool([selected], 1)), {
			getSelectableModels: async () => [model("provider-b", "teacher")],
			stream: async () => {
				streamCalls += 1;
				return resultStream(assistantMessage(selected, "unused"));
			},
		})).rejects.toBeInstanceOf(ReviewModelUnavailableError);
		expect(streamCalls).toBe(0);
	});

	it("runs browser candidates sequentially and remote candidates with bounded concurrency", async () => {
		const browser = model("browser", "local-teacher");
		const remote = model("provider-a", "remote-teacher");
		const active = { browser: 0, remote: 0 };
		const maximum = { browser: 0, remote: 0 };
		const calls: Array<{ model: string; context: Context; options?: SimpleStreamOptions & { hostedWebSearch?: boolean } }> = [];
		const stream: ReviewStreamFn = async (selectedModel, context, options) => {
			const bucket = selectedModel.provider === "browser" ? "browser" : "remote";
			active[bucket] += 1;
			maximum[bucket] = Math.max(maximum[bucket], active[bucket]);
			calls.push({ model: selectedModel.id, context, options });
			await new Promise((resolve) => setTimeout(resolve, 8));
			active[bucket] -= 1;
			return resultStream(assistantMessage(selectedModel, `Candidate from ${selectedModel.id}`));
		};

		const candidates = await generateReviewCandidates(input(pool([browser, remote], 8)), {
			getSelectableModels: async () => [browser, remote],
			stream,
			createCandidateId: (index) => `candidate-${index}`,
		});

		expect(maximum.browser).toBe(1);
		expect(maximum.remote).toBeGreaterThan(1);
		expect(maximum.remote).toBeLessThanOrEqual(3);
		expect(candidates.every((candidate) => candidate.state === "completed")).toBe(true);
		expect(calls.every((call) => call.context.messages.length === 1)).toBe(true);
		expect(calls.every((call) => call.context.tools?.length === 0)).toBe(true);
		expect(calls.every((call) => call.options?.hostedWebSearch === false)).toBe(true);
		expect(candidates.filter((candidate) => candidate.model.provider === "browser")
			.every((candidate) => candidate.generation?.cost.provenance === "local-zero")).toBe(true);
	});

	it("serializes browser inference across overlapping pool runs", async () => {
		const browser = model("browser", "local-teacher");
		let active = 0;
		let maximum = 0;
		const stream: ReviewStreamFn = async (selectedModel) => {
			active += 1;
			maximum = Math.max(maximum, active);
			await new Promise((resolve) => setTimeout(resolve, 8));
			active -= 1;
			return resultStream(assistantMessage(selectedModel, "Local candidate"));
		};
		const dependencies = {
			getSelectableModels: async () => [browser],
			stream,
		};

		await Promise.all([
			generateReviewCandidates(input(pool([browser], 2)), dependencies),
			generateReviewCandidates(input(pool([browser], 2)), dependencies),
		]);
		expect(maximum).toBe(1);
	});

	it("records actual usage and rejects errors, truncation, and empty output", async () => {
		const selected = model("provider-a", "teacher");
		let call = 0;
		const messages = [
			assistantMessage(selected, "Ask how the learner counted.", "stop", undefined, 0.0042),
			assistantMessage(selected, "A truncated artifact", "length"),
			assistantMessage(selected, "", "error", "Provider unavailable"),
			assistantMessage(selected, "   ", "stop"),
		];
		const candidates = await generateReviewCandidates({
			...input(pool([selected], 4)),
			remoteConcurrency: 1,
		}, {
			getSelectableModels: async () => [selected],
			stream: async () => resultStream(messages[call++]),
		});

		expect(candidates.map((candidate) => candidate.state)).toEqual([
			"completed",
			"failed",
			"failed",
			"failed",
		]);
		expect(candidates[0].usage).toMatchObject({ inputTokens: 120, outputTokens: 40, totalTokens: 170, costUsd: 0.0042 });
		expect(candidates[0].generation?.cost).toEqual({ known: true, usd: 0.0042, provenance: "stream-usage" });
		expect(candidates[1].error).toContain('stop reason "length"');
		expect(candidates[2].error).toBe("Provider unavailable");
		expect(candidates[3].error).toBe("The model returned no text content.");
	});

	it("persists an immutable generation-time pool and run snapshot with explicit response provenance", async () => {
		const selected = model("provider-a", "teacher");
		const reviewPool = pool([selected], 1);
		const observed: GeneratedReviewCandidate[] = [];
		const response = {
			...assistantMessage(selected, "A revised response", "stop", undefined, 0.0025),
			responseModel: "teacher-2026-08-23",
			responseId: "response-1",
		};
		const [candidate] = await generateReviewCandidates({
			...input(reviewPool),
			onCandidate: (next) => { observed.push(structuredClone(next)); },
		}, {
			getSelectableModels: async () => [selected],
			stream: async () => resultStream(response),
			createRunId: () => "generation-run-1",
			createCandidateId: () => "candidate-1",
		});

		expect(candidate.generation.run).toMatchObject({
			id: "generation-run-1",
			task: "response",
			candidateIndex: 0,
			effectiveMaxTokens: 2_000,
			hostedWebSearch: false,
			toolsEnabled: false,
			requestedModel: { provider: "provider-a", id: "teacher" },
			pool: {
				id: "pool-1",
				name: "Review pool",
				candidateCount: 1,
				temperature: 0.4,
				maxTokens: 2_000,
			},
		});
		expect(candidate.generation.cost).toEqual({ known: true, usd: 0.0025, provenance: "stream-usage" });
		expect(candidate.generation.response).toEqual({
			provider: "provider-a",
			model: "teacher",
			responseModel: "teacher-2026-08-23",
			responseId: "response-1",
			stopReason: "stop",
		});

		reviewPool.name = "Edited later";
		reviewPool.tasks.splice(0);
		reviewPool.models[0].id = "different-model";
		reviewPool.models[0].cost.input = 999;
		expect(candidate.generation.run.pool.name).toBe("Review pool");
		expect(candidate.generation.run.pool.tasks).toEqual(["response", "artifact:plan"]);
		expect(candidate.generation.run.pool.models[0]).toMatchObject({
			id: "teacher",
			cost: { input: 1 },
		});
		expect(observed[0]).toMatchObject({
			state: "queued",
			generation: {
				run: { id: "generation-run-1", candidateIndex: 0 },
				cost: { known: false, provenance: "unknown" },
			},
		});
	});

	it("does not present zero-priced remote catalog data as a known free generation", async () => {
		const unknownPrice = model(
			"custom-provider",
			"teacher",
			{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		);
		const [candidate] = await generateReviewCandidates(input(pool([unknownPrice], 1)), {
			getSelectableModels: async () => [unknownPrice],
			stream: async () => resultStream(assistantMessage(unknownPrice, "A revised response")),
		});

		expect(candidate.state).toBe("completed");
		expect(candidate.generation?.cost).toEqual({ known: false, provenance: "unknown" });
		expect(candidate.usage).not.toHaveProperty("costUsd");
	});

	it("marks running and queued work cancelled when the shared signal aborts", async () => {
		const selected = model("provider-a", "teacher");
		const controller = new AbortController();
		let calls = 0;
		const candidates = await generateReviewCandidates({
			...input(pool([selected], 3)),
			signal: controller.signal,
			remoteConcurrency: 1,
		}, {
			getSelectableModels: async () => [selected],
			stream: async () => {
				calls += 1;
				controller.abort();
				return { result: () => new Promise<AssistantMessage>(() => {}) } as AssistantMessageEventStream;
			},
		});

		expect(calls).toBe(1);
		expect(candidates.map((candidate) => candidate.state)).toEqual(["cancelled", "cancelled", "cancelled"]);

		const preAborted = new AbortController();
		preAborted.abort();
		await expect(generateReviewCandidates({
			...input(pool([selected], 1)),
			signal: preAborted.signal,
		}, {
			getSelectableModels: async () => {
				throw new Error("catalog should not be queried");
			},
		})).rejects.toBeInstanceOf(ReviewGenerationAbortedError);
	});
});

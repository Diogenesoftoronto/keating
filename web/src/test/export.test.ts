import { describe, expect, it } from "bun:test";
import { buildWebFineTuneExportFromSources } from "../keating/export";
import { buildFineTuneImportSessionsFromFiles } from "../keating/import";

describe("web fine-tune export", () => {
	it("emits ChatML and Alpaca JSONL from artifacts and sessions", async () => {
		const result = await buildWebFineTuneExportFromSources({
			plans: [{
				id: "p1",
				topic: "derivative",
				createdAt: Date.now(),
				updatedAt: Date.now(),
				content: "# Derivative Plan\n\nUse slope and limits to teach derivatives.",
			}],
			sessions: [{
				id: "s1",
				title: "Recursion",
				model: {} as any,
				thinkingLevel: "medium",
				createdAt: new Date().toISOString(),
				lastModified: new Date().toISOString(),
				messages: [
					{ role: "user", content: "Teach recursion with a secret sk-testsecret1234567890." },
					{ role: "assistant", content: "Recursion solves a problem by reducing it to smaller versions of itself until a base case stops the process." },
				] as any,
			}],
		}, {
			source: "all",
			format: "both",
			redact: true,
			minAssistantChars: 40,
		});

		expect(result.exampleCount).toBe(2);
		expect(result.chatmlJsonl).toContain("\"messages\"");
		expect(result.alpacaJsonl).toContain("\"instruction\"");
		expect(result.chatmlJsonl).toContain("[REDACTED]");
		expect(result.chatmlJsonl).not.toContain("sk-testsecret");
		expect(result.redactionCount).toBeGreaterThanOrEqual(1);
	});

	it("respects source and format filters", async () => {
		const result = await buildWebFineTuneExportFromSources({
			plans: [{
				id: "p1",
				topic: "stoicism",
				createdAt: Date.now(),
				updatedAt: Date.now(),
				content: "# Stoicism\n\nTeach the dichotomy of control.",
			}],
			sessions: [{
				id: "s1",
				title: "Ignored",
				model: {} as any,
				thinkingLevel: "medium",
				createdAt: new Date().toISOString(),
				lastModified: new Date().toISOString(),
				messages: [
					{ role: "user", content: "ignored" },
					{ role: "assistant", content: "This assistant answer is long enough but should be excluded by source selection." },
				] as any,
			}],
		}, {
			source: "artifacts",
			format: "chatml",
			redact: true,
			minAssistantChars: 40,
		});

		expect(result.exampleCount).toBe(1);
		expect(result.chatmlJsonl).toBeDefined();
		expect(result.alpacaJsonl).toBeUndefined();
	});

	it("skips assistant turns shorter than the configured minimum", async () => {
		const result = await buildWebFineTuneExportFromSources({
			sessions: [{
				id: "s1",
				title: "Recursion",
				model: {} as any,
				thinkingLevel: "medium",
				createdAt: new Date().toISOString(),
				lastModified: new Date().toISOString(),
				messages: [
					{ role: "user", content: "Teach recursion briefly." },
					{ role: "assistant", content: "No." },
					{ role: "user", content: "Teach recursion with enough detail." },
					{ role: "assistant", content: "Recursion solves a problem by reducing it to smaller versions of itself until a base case stops the process and the call stack unwinds." },
				] as any,
			}],
		}, {
			source: "sessions",
			format: "chatml",
			redact: true,
			minAssistantChars: 40,
		});

		expect(result.exampleCount).toBe(1);
		expect(result.skippedCount).toBeGreaterThanOrEqual(1);
		expect(result.chatmlJsonl).not.toContain("No.");
		expect(result.chatmlJsonl).toContain("call stack unwinds");
	});

	it("can emit sandbox source and commit history for fine-tuning", async () => {
		const result = await buildWebFineTuneExportFromSources({
			sandbox: {
				schemaVersion: 1,
				kind: "keating-sandbox-portable",
				generatedAt: new Date().toISOString(),
				nodepod: {
					active: true,
					files: [{
						path: "/workspace/src/core/policy.ts",
						content: "export const policy = { retrievalFirst: true };\n",
					}],
					snapshots: [],
				},
				vc: {
					schemaVersion: 1,
					generatedAt: new Date().toISOString(),
					activeBranchId: "main",
					branches: [{ id: "main", name: "main", commitId: "c1", hidden: false, createdAt: new Date().toISOString() }],
					commits: [{ id: "c1", branchId: "main", parentId: null, message: "tighten retrieval policy", createdAt: new Date().toISOString() }],
					commitFiles: [{ commitId: "c1", path: "/workspace/src/core/policy.ts", contentHash: "abc123" }],
				},
			},
		}, {
			source: "sandbox",
			format: "chatml",
			redact: true,
			minAssistantChars: 40,
		});

		expect(result.exampleCount).toBe(2);
		expect(result.chatmlJsonl).toContain("policy.ts");
		expect(result.chatmlJsonl).toContain("tighten retrieval policy");
		expect(result.manifestJson).toContain("sandboxFilesRead");
	});

	it("emits rewarded export files with persona and manifest stats", async () => {
		const result = await buildWebFineTuneExportFromSources({
			persona: "Teach with care.",
			sessions: [{
				id: "s1",
				title: "Derivative",
				model: {} as any,
				thinkingLevel: "medium",
				createdAt: new Date().toISOString(),
				lastModified: new Date().toISOString(),
				messages: [
					{ role: "user", content: "Teach derivatives.", timestamp: 1000 },
					{ role: "assistant", content: "A derivative is local rate of change, grounded in slopes over shrinking intervals.", timestamp: 2000 },
				] as any,
			}],
			feedback: [{ id: "f1", topic: "Derivative", signal: "thumbs-up", createdAt: 2200, messageId: "assistant-0-2000", sessionId: "s1" }],
			quizResults: [{ id: "q1", topic: "Derivative", createdAt: 2500, score: 1, weightedScore: 0.75, totalQuestions: 1, sessionId: "s1" }],
		}, {
			source: "sessions",
			format: "chatml",
			redact: true,
			minAssistantChars: 40,
			now: 1_800_000_000_000,
		});
		const line = JSON.parse(result.rewardedJsonl!.trim());
		expect(line.reward).toBeGreaterThan(0.7);
		expect(line.signals.explicit).toBeDefined();
		expect(line.messages[0]).toEqual({ role: "system", content: "Teach with care." });
		expect(JSON.parse(result.manifestJson).rewardStats.scored).toBe(1);
	});

	it("keeps judge scoring off by default and applies mocked judge when supplied", async () => {
		let calls = 0;
		const sources = {
			sessions: [{
				id: "s1",
				title: "Recursion",
				model: {} as any,
				thinkingLevel: "medium" as const,
				createdAt: new Date().toISOString(),
				lastModified: new Date().toISOString(),
				messages: [
					{ role: "user", content: "Teach recursion.", timestamp: 1000 },
					{ role: "assistant", content: "Recursion reduces work to smaller self-similar cases until a base case.", timestamp: 2000 },
				] as any,
			}],
			feedback: [{ id: "f1", topic: "Recursion", signal: "confused" as const, createdAt: 2100, messageId: "assistant-0-2000", sessionId: "s1" }],
		};
		const withoutJudge = await buildWebFineTuneExportFromSources(sources, {
			source: "sessions",
			format: "chatml",
			redact: true,
			minAssistantChars: 40,
		});
		expect(calls).toBe(0);
		expect(withoutJudge.rewardStats?.bySource.judge).toBe(0);
		const withJudge = await buildWebFineTuneExportFromSources(sources, {
			source: "sessions",
			format: "chatml",
			redact: true,
			minAssistantChars: 40,
			judge: async (turns) => {
				calls += 1;
				return turns.map(() => ({ masteryGain: 1, retention: 1, engagement: 1, transfer: 1, confusion: 0 }));
			},
		});
		expect(calls).toBe(1);
		expect(withJudge.rewardStats?.bySource.judge).toBe(1);
		expect(JSON.parse(withJudge.rewardedJsonl!.trim()).reward).toBeGreaterThan(JSON.parse(withoutJudge.rewardedJsonl!.trim()).reward);
	});

	it("redacts secrets in rewarded, KTO, and GRPO outputs", async () => {
		const result = await buildWebFineTuneExportFromSources({
			sessions: [{
				id: "s1",
				title: "Secrets",
				model: {} as any,
				thinkingLevel: "medium",
				createdAt: new Date().toISOString(),
				lastModified: new Date().toISOString(),
				messages: [
					{ role: "user", content: "Use sk-testsecret1234567890 while teaching.", timestamp: 1000 },
					{ role: "assistant", content: "Never place secrets in training data; replace them before exporting.", timestamp: 2000 },
				] as any,
			}],
			feedback: [{ id: "f1", topic: "Secrets", signal: "thumbs-up", createdAt: 2100, messageId: "assistant-0-2000", sessionId: "s1" }],
		}, {
			source: "sessions",
			format: "chatml",
			redact: true,
			minAssistantChars: 40,
		});
		const combined = [result.rewardedJsonl, result.ktoJsonl, result.grpoPromptsJsonl].join("\n");
		expect(combined).toContain("[REDACTED]");
		expect(combined).not.toContain("sk-testsecret");
	});

	it("emits DPO preference files in chat and text trainer shapes", async () => {
		const sessionBase = {
			title: "Forked prompt",
			model: {} as any,
			thinkingLevel: "medium" as const,
			createdAt: new Date().toISOString(),
			lastModified: new Date().toISOString(),
			messages: [
				{ role: "user", content: "Explain recursion.", timestamp: 1000 },
				{ role: "assistant", content: "Recursion is a precise way to solve a problem by solving smaller copies of the same problem until a base case stops.", timestamp: 2000 },
			] as any,
		};
		const result = await buildWebFineTuneExportFromSources({
			persona: "Tutor persona",
			sessions: [
				{ ...sessionBase, id: "s1" },
				{
					...sessionBase,
					id: "s2",
					messages: [
						{ role: "user", content: "Explain recursion.", timestamp: 1000 },
						{ role: "assistant", content: "Recursion is when code calls itself.", timestamp: 2000 },
					] as any,
				},
			],
			feedback: [
				{ id: "f1", topic: "Forked prompt", signal: "thumbs-up", createdAt: 2100, messageId: "assistant-0-2000", sessionId: "s1" },
				{ id: "f2", topic: "Forked prompt", signal: "thumbs-down", createdAt: 2100, messageId: "assistant-0-2000", sessionId: "s2" },
			],
		}, {
			source: "sessions",
			format: "chatml",
			redact: true,
			minAssistantChars: 10,
		});
		const chat = JSON.parse(result.preferenceJsonl!.trim());
		const text = JSON.parse(result.dpoTextJsonl!.trim());
		expect(chat.prompt).toEqual([
			{ role: "system", content: "Tutor persona" },
			{ role: "user", content: "Explain recursion." },
		]);
		expect(chat.chosen).toContain("base case");
		expect(chat.rejected).toContain("calls itself");
		expect(text.prompt).toBe("System: Tutor persona\n\nUser: Explain recursion.");
		expect(JSON.parse(result.manifestJson).counts.dpoTextLines).toBe(1);
	});

	it("imports ChatML and Alpaca JSONL as one session per example", () => {
		const model = {
			id: "gpt-test",
			name: "GPT Test",
			api: "openai-responses",
			provider: "openai",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128_000,
			maxTokens: 8192,
		} as any;
		const result = buildFineTuneImportSessionsFromFiles([
			{
				name: "keating-finetune.chatml.jsonl",
				text: `${JSON.stringify({ messages: [
					{ role: "user", content: "Teach entropy." },
					{ role: "assistant", content: "Entropy tracks uncertainty across possible states." },
				] })}\n`,
			},
			{
				name: "keating-finetune.alpaca.jsonl",
				text: `${JSON.stringify({ instruction: "Teach recursion.", input: "Use stacks.", output: "A recursive function needs a base case." })}\n`,
			},
		], { now: 1_800_000_000_000, model, thinkingLevel: "high" });

		expect(result.examplesImported).toBe(2);
		// Two independent examples → two independent sessions (never flattened).
		expect(result.sessionsImported).toBe(2);
		expect(result.sessions).toHaveLength(2);
		expect(result.sessions[0].messages).toHaveLength(2);
		expect(result.sessions[1].messages).toHaveLength(2);
		expect(result.sessions[0].model).toBe(model);
		expect(result.sessions[0].thinkingLevel).toBe("high");
		// Reconstructed messages are valid AgentMessages (content is a parts array).
		expect((result.sessions[0].messages[0] as any).content[0]).toEqual({ type: "text", text: "Teach entropy." });
		expect(String((result.sessions[1].messages[0] as any).content[0].text)).toContain("Use stacks.");
	});

	it("deduplicates paired ChatML and Alpaca fine-tune imports", () => {
		const result = buildFineTuneImportSessionsFromFiles([
			{
				name: "keating-finetune.chatml.jsonl",
				text: `${JSON.stringify({ messages: [
					{ role: "user", content: "Teach entropy." },
					{ role: "assistant", content: "Entropy tracks uncertainty across possible states." },
				] })}\n`,
			},
			{
				name: "keating-finetune.alpaca.jsonl",
				text: `${JSON.stringify({ instruction: "Teach entropy.", input: "", output: "Entropy tracks uncertainty across possible states." })}\n`,
			},
		], { now: 1_800_000_000_000 });

		expect(result.examplesImported).toBe(1);
		expect(result.sessionsImported).toBe(1);
		expect(result.sessions[0].messages).toHaveLength(2);
	});

	it("reconstructs a lossless resumable session from the keating envelope", () => {
		const result = buildFineTuneImportSessionsFromFiles([
			{
				name: "train.chatml.jsonl",
				text: `${JSON.stringify({
					messages: [
						{ role: "system", content: "Tutor persona" },
						{ role: "user", content: "Explain recursion." },
						{ role: "assistant", content: "It calls itself with a base case." },
					],
					keating: {
						title: "Recursion chat",
						thinkingLevel: "low",
						sessionId: "sess-abc",
						source: "keating-session-export",
					},
				})}\n`,
			},
		], { now: 1_800_000_000_000 });

		expect(result.sessionsImported).toBe(1);
		const session = result.sessions[0];
		expect(session.title).toBe("Recursion chat");
		expect(session.thinkingLevel).toBe("low");
		expect(session.id).toBe("sess-abc-import-0");
		// System message preserved for faithful resume.
		expect((session.messages[0] as any).role).toBe("system");
		expect(session.messages).toHaveLength(3);
	});

	it("round-trips a session through lossless chatml export and import", async () => {
		const exported = await buildWebFineTuneExportFromSources({
			sessions: [{
				id: "s-rt",
				title: "Recursion deep dive",
				model: { id: "gpt-x", name: "GPT X", provider: "openai", api: "openai-responses" } as any,
				thinkingLevel: "low",
				createdAt: new Date(1_800_000_000_000).toISOString(),
				lastModified: new Date(1_800_000_000_000).toISOString(),
				messages: [
					{ role: "system", content: "Tutor persona" },
					{ role: "user", content: "Explain recursion in enough detail to learn it." },
					{ role: "assistant", content: "Recursion solves a problem by reducing it to smaller versions until a base case stops it." },
				] as any,
			}],
		}, { source: "sessions", format: "chatml", redact: false, minAssistantChars: 20 });

		expect(exported.chatmlJsonl).toBeTruthy();
		const imported = buildFineTuneImportSessionsFromFiles(
			[{ name: "train.chatml.jsonl", text: exported.chatmlJsonl! }],
			{ now: 1_800_000_000_000 },
		);

		expect(imported.sessionsImported).toBe(1);
		const session = imported.sessions[0];
		expect(session.title).toBe("Recursion deep dive");
		expect(session.thinkingLevel).toBe("low");
		// Lossless envelope round-trips the model and the system turn.
		expect((session.model as any).id).toBe("gpt-x");
		expect((session.messages[0] as any).role).toBe("system");
	});
});

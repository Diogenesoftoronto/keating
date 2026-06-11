import { describe, expect, it } from "bun:test";
import { buildWebFineTuneExportFromSources } from "../keating/export";

describe("web fine-tune export", () => {
	it("emits ChatML and Alpaca JSONL from artifacts and sessions", () => {
		const result = buildWebFineTuneExportFromSources({
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

	it("respects source and format filters", () => {
		const result = buildWebFineTuneExportFromSources({
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

	it("skips assistant turns shorter than the configured minimum", () => {
		const result = buildWebFineTuneExportFromSources({
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

	it("can emit sandbox source and commit history for fine-tuning", () => {
		const result = buildWebFineTuneExportFromSources({
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
});

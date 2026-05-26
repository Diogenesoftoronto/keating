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
});

import { describe, expect, it } from "bun:test";
import { strFromU8, unzipSync } from "fflate";
import { buildWebFineTuneExportFromSources } from "../keating/export";
import { buildWebTrainingArchive } from "../keating/training-archive";

describe("web training archive", () => {
	it("packages a documented, self-describing training dataset", async () => {
		const result = await buildWebFineTuneExportFromSources({
			persona: "Teach by asking one useful question at a time.",
			sessions: [{
				id: "session-1",
				title: "Recursion",
				model: { provider: "openai", id: "gpt-test" } as any,
				thinkingLevel: "high",
				createdAt: new Date().toISOString(),
				lastModified: new Date().toISOString(),
				messages: [
					{ role: "user", content: "Teach recursion.", timestamp: 1000 },
					{ role: "assistant", content: "Recursion reduces a problem to smaller versions until a base case stops the process.", timestamp: 2000 },
				] as any,
			}],
			feedback: [{ id: "f1", topic: "Recursion", signal: "thumbs-up", createdAt: 2100, messageId: "assistant-0-2000", sessionId: "session-1" }],
		}, {
			source: "sessions",
			format: "both",
			redact: true,
			minAssistantChars: 20,
			now: 1_800_000_000_000,
		});

		const archive = buildWebTrainingArchive(result);
		const files = unzipSync(archive.bytes);
		expect(archive.filename).toMatch(/^keating-training-.*\.zip$/);
		expect(strFromU8(files["README.md"])).toContain("Quality labels");
		expect(strFromU8(files["schemas/keating-training-record.schema.json"])).toContain("recommendedForSft");
		const canonical = JSON.parse(strFromU8(files["data/keating.training.jsonl"]).trim());
		expect(canonical.source).toMatchObject({
			type: "session",
			sessionId: "session-1",
			thinkingLevel: "high",
		});
		expect(canonical.messages[0]).toEqual({ role: "system", content: "Teach by asking one useful question at a time." });
		expect(canonical.quality).toMatchObject({ status: "accepted", recommendedForSft: true });
		const manifest = JSON.parse(strFromU8(files["manifest.json"]));
		expect(manifest.schemaVersion).toBe(2);
		expect(manifest.files.some((file: { path: string }) => file.path === "data/keating.training.jsonl")).toBe(true);
	});

	it("keeps low-quality responses for preference use but out of SFT files", async () => {
		const result = await buildWebFineTuneExportFromSources({
			sessions: [{
				id: "session-bad",
				title: "Weak answer",
				model: {} as any,
				thinkingLevel: "low",
				createdAt: new Date().toISOString(),
				lastModified: new Date().toISOString(),
				messages: [
					{ role: "user", content: "Explain entropy.", timestamp: 1000 },
					{ role: "assistant", content: "Entropy is just disorder and there is nothing else worth knowing about it.", timestamp: 2000 },
				] as any,
			}],
			feedback: [{ id: "f-bad", topic: "Weak answer", signal: "thumbs-down", createdAt: 2100, messageId: "assistant-0-2000", sessionId: "session-bad" }],
		}, {
			source: "sessions",
			format: "both",
			redact: true,
			minAssistantChars: 20,
		});

		expect(result.exampleCount).toBe(0);
		expect(result.recordCount).toBe(1);
		expect(result.chatmlJsonl).toBe("");
		expect(result.alpacaJsonl).toBe("");
		const canonical = JSON.parse(result.canonicalJsonl!.trim());
		expect(canonical.quality.status).toBe("rejected");
		expect(canonical.task).toBe("preference-learning");
		expect(result.rewardedJsonl).toContain("thumbs-down");
	});
});

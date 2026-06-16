import { describe, expect, it } from "bun:test";
import {
	branchBeforeAssistantTurn,
	canGenerateAlternativeFromBranch,
	lastAssistantTimestamp,
	shouldGenerateAlternativeResponse,
} from "../keating/alternative-responses";

describe("alternative response helpers", () => {
	it("samples the configured chance with clamped edge behavior", () => {
		expect(shouldGenerateAlternativeResponse(0, () => 0)).toBe(false);
		expect(shouldGenerateAlternativeResponse(-1, () => 0)).toBe(false);
		expect(shouldGenerateAlternativeResponse(1, () => 0.999)).toBe(true);
		expect(shouldGenerateAlternativeResponse(2, () => 0.999)).toBe(true);
		expect(shouldGenerateAlternativeResponse(0.05, () => 0.04)).toBe(true);
		expect(shouldGenerateAlternativeResponse(0.05, () => 0.05)).toBe(false);
	});

	it("branches before the completed assistant turn so a new answer shares the same prompt", () => {
		const messages = [
			{ role: "user", content: "u1", timestamp: 1000 },
			{ role: "assistant", content: "a1", timestamp: 2000 },
			{ role: "user", content: "u2", timestamp: 3000 },
			{ role: "assistant", content: "a2", timestamp: 4000 },
		] as any;
		expect(lastAssistantTimestamp(messages)).toBe(4000);
		expect(branchBeforeAssistantTurn(messages) as any).toEqual([
			{ role: "user", content: "u1", timestamp: 1000 },
			{ role: "assistant", content: "a1", timestamp: 2000 },
			{ role: "user", content: "u2", timestamp: 3000 },
		]);
		expect(canGenerateAlternativeFromBranch(branchBeforeAssistantTurn(messages))).toBe(true);
	});

	it("does not generate from a branch that does not end on a user prompt", () => {
		expect(canGenerateAlternativeFromBranch([{ role: "assistant", content: "a1" }] as any)).toBe(false);
	});
});

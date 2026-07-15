import { describe, expect, it } from "bun:test";
import { pickDiverseStarterPrompts, STARTER_PROMPTS } from "../keating/starter-prompts";

describe("starter prompts", () => {
	it("covers a broad range of starting domains", () => {
		expect(new Set(STARTER_PROMPTS.map((prompt) => prompt.domain)).size).toBeGreaterThanOrEqual(12);
	});

	it("selects distinct domains before repeating one", () => {
		const selected = pickDiverseStarterPrompts(STARTER_PROMPTS, 8, () => 0.42);
		expect(new Set(selected.map((prompt) => prompt.domain)).size).toBe(8);
	});

	it("does not mutate the source pool", () => {
		const pool = STARTER_PROMPTS.slice(0, 4);
		const snapshot = [...pool];
		expect(pickDiverseStarterPrompts(pool, 3, () => 0.1)).toHaveLength(3);
		expect(pool).toEqual(snapshot);
	});
});

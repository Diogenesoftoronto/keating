import { describe, expect, test } from "bun:test";
import { transpileTsToJs } from "../keating/nodepod-runtime";

describe("NodePod TypeScript transpilation", () => {
	test("strips array and generic type annotations without corrupting parameters", async () => {
		const js = await transpileTsToJs(`
export function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function chunk<T>(items: T[], size: number): T[][] {
  return [items.slice(0, size)];
}
`, "/workspace/src/core/util.ts");

		expect(js).toContain("function mean(values)");
		expect(js).toContain("function chunk(items, size)");
		expect(js).not.toContain("values]");
		expect(js).not.toContain("items]");
		expect(js).not.toContain(": number");
	});
});

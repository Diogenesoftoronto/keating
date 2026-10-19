import { describe, expect, it } from "bun:test";
import * as fc from "fast-check";
import {
	applyStringEdit,
	diffStrings,
	isMutablePath,
	buildSearchBlock,
} from "../src/keating/sandbox-engine";

function overlappingOccurrences(content: string, search: string): number {
	let count = 0;
	for (let index = 0; index <= content.length - search.length; index++) {
		if (content.startsWith(search, index)) count++;
	}
	return count;
}

describe("applyStringEdit", () => {
	it("always succeeds on unique search block", () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 1, maxLength: 50 }),
				fc.string({ minLength: 1, maxLength: 50 }),
				fc.string({ minLength: 1, maxLength: 30 }),
				fc.string({ minLength: 1, maxLength: 50 }),
				fc.string({ minLength: 1, maxLength: 30 }),
				(before, search, mid, after, replace) => {
					const uniqueContent = `${before}${search}${mid}${after}`;
					// Count overlapping matches in the complete concatenation, including boundaries.
					fc.pre(overlappingOccurrences(uniqueContent, search) === 1);

					const result = applyStringEdit(uniqueContent, { search, replace });
					expect(result.success).toBe(true);
					expect(result.message).toContain("Edited");
					expect(result.diff).toBeDefined();
					expect(result.diff!.charDelta).toBe(replace.length - search.length);
					expect(result.content).toBe(`${before}${replace}${mid}${after}`);
				}
			),
			{ numRuns: 500 }
		);
	});

	it("always succeeds even with multiline search block", () => {
		fc.assert(
			fc.property(
				fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 2, maxLength: 5 }),
				fc.string({ minLength: 1, maxLength: 30 }),
				(searchLines, replace) => {
					const search = searchLines.join("\n");
					const before = "prefix";
					const after = "suffix";
					const content = `${before}\n${search}\n${after}`;
					fc.pre(overlappingOccurrences(content, search) === 1);

					const result = applyStringEdit(content, { search, replace });
					expect(result.success).toBe(true);
					expect(result.diff).toBeDefined();
					expect(result.content).toBe(`${before}\n${replace}\n${after}`);
				}
			),
			{ numRuns: 300 }
		);
	});

	it("always fails on ambiguous (duplicate) search block", () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 1, maxLength: 20 }),
				fc.string({ minLength: 1, maxLength: 20 }),
				fc.string({ minLength: 1, maxLength: 50 }),
				(prefix, repeated, replace) => {
					const content = `${prefix}${repeated}${prefix}${repeated}${prefix}`;
					// Make sure repeated appears at least twice
					fc.pre(content.split(repeated).length - 1 >= 2);

					const result = applyStringEdit(content, { search: repeated, replace });
					expect(result.success).toBe(false);
					expect(result.message).toContain("rejected for safety");
				}
			),
			{ numRuns: 500 }
		);
	});

	it("always fails when search is not in content", () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 1, maxLength: 100 }),
				fc.string({ minLength: 1, maxLength: 20 }),
				(content, search) => {
					fc.pre(!content.includes(search));
					const result = applyStringEdit(content, { search, replace: "x" });
					expect(result.success).toBe(false);
					expect(result.message).toContain("not found");
				}
			),
			{ numRuns: 500 }
		);
	});

	it("preserves surrounding content after replace", () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 5, maxLength: 100 }),
				fc.string({ minLength: 1, maxLength: 30 }),
				fc.string({ minLength: 1, maxLength: 30 }),
				fc.string({ minLength: 1, maxLength: 100 }),
				(before, target, replacement, after) => {
					const content = `${before}\n${target}\n${after}`;
					// Ensure target is unique
					const occurrences = content.split(target).length - 1;
					fc.pre(occurrences === 1);

					const result = applyStringEdit(content, { search: target, replace: replacement });
					expect(result.success).toBe(true);
					const normalized = content.replace(/\r\n/g, "\n");
					const normalizedTarget = target.replace(/\r\n/g, "\n");
					const index = normalized.indexOf(normalizedTarget);
					expect(result.content).toBe(
						normalized.slice(0, index) + replacement + normalized.slice(index + normalizedTarget.length)
					);
				}
			),
			{ numRuns: 500 }
		);
	});

	it("replace with empty string works when unique", () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 10, maxLength: 200 }),
				fc.string({ minLength: 1, maxLength: 20 }),
				(content, search) => {
					fc.pre(content.includes(search));
					const occurrences = content.split(search).length - 1;
					fc.pre(occurrences === 1);

					const result = applyStringEdit(content, { search, replace: "" });
					expect(result.success).toBe(true);
					expect(result.diff!.linesRemoved).toBeGreaterThanOrEqual(1);
					expect(result.diff!.charDelta).toBe(-search.length);
				}
			),
			{ numRuns: 300 }
		);
	});
});

describe("diffStrings", () => {
	it("identical strings produce only unchanged lines", () => {
		fc.assert(
			fc.property(fc.string(), (content) => {
				const diffs = diffStrings(content, content);
				for (const d of diffs) {
					expect(d.type).toBe("unchanged");
				}
			}),
			{ numRuns: 200 }
		);
	});

	it("added lines are detected", () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 1, maxLength: 100 }),
				fc.string({ minLength: 1, maxLength: 50 }),
				(base, added) => {
					const current = `${base}\n${added}`;
					const diffs = diffStrings(base, current);
					const addedLines = diffs.filter((d) => d.type === "added");
					expect(addedLines.length).toBeGreaterThanOrEqual(1);
				}
			),
			{ numRuns: 300 }
		);
	});

	it("removed lines are detected", () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 1, maxLength: 100 }),
				fc.string({ minLength: 1, maxLength: 50 }),
				(base, removed) => {
					const baseline = `${base}\n${removed}`;
					const diffs = diffStrings(baseline, base);
					const removedLines = diffs.filter((d) => d.type === "removed");
					expect(removedLines.length).toBeGreaterThanOrEqual(1);
				}
			),
			{ numRuns: 300 }
		);
	});
});

describe("isMutablePath", () => {
	it("allows core teaching engine files", () => {
		expect(isMutablePath("/workspace/src/core/policy.ts")).toBe(true);
		expect(isMutablePath("/workspace/src/core/lesson-plan.ts")).toBe(true);
		expect(isMutablePath("/workspace/src/core/benchmark.ts")).toBe(true);
		expect(isMutablePath("/workspace/src/core/mutation.ts")).toBe(true);
		expect(isMutablePath("/workspace/src/core/map-elites.ts")).toBe(true);
		expect(isMutablePath("/workspace/src/core/prompt-evolution.ts")).toBe(true);
	});

	it("blocks safety-critical files", () => {
		expect(isMutablePath("/workspace/src/core/self-improve.ts")).toBe(false);
		expect(isMutablePath("/workspace/src/core/types.ts")).toBe(false);
		expect(isMutablePath("/workspace/src/core/config.ts")).toBe(false);
		expect(isMutablePath("/workspace/src/core/paths.ts")).toBe(false);
		expect(isMutablePath("/workspace/src/core/random.ts")).toBe(false);
	});

	it("allows prompt templates", () => {
		expect(isMutablePath("/workspace/pi/prompts/learn.md")).toBe(true);
		expect(isMutablePath("/workspace/pi/prompts/diagnose.md")).toBe(true);
	});

	it("blocks arbitrary files outside known paths", () => {
		expect(isMutablePath("/workspace/src/cli/main.ts")).toBe(false);
		expect(isMutablePath("/workspace/src/core/bogus.ts")).toBe(false);
		expect(isMutablePath("/etc/passwd")).toBe(false);
	});
});

describe("buildSearchBlock", () => {
	it("extracts context around a target line", () => {
		const content = "line1\nline2\nTARGET\nline4\nline5";
		const block = buildSearchBlock(content, "TARGET", 2);
		expect(block).toBe(content);
	});

	it("returns null for missing line", () => {
		const result = buildSearchBlock("a\nb\nc", "NOTHERE");
		expect(result).toBeNull();
	});

	it("handles partial context at file boundaries", () => {
		const content = "FIRST\nsecond\nthird";
		const block = buildSearchBlock(content, "FIRST", 5);
		expect(block).toBe(content);
	});
});

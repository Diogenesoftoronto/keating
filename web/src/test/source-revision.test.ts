import { describe, expect, it } from "bun:test";

import { applySourceRevision, buildSourceRevision, hashSourceTree } from "../keating/sync/source-revision";

describe("source revision diffs", () => {
	it("builds and applies deterministic add, modify, and delete patches", async () => {
		const before = [
			{ path: "/src/old.ts", content: "export const old = true;\n" },
			{ path: "/src/value.ts", content: "export const value = 1;\n" },
		];
		const after = [
			{ path: "/src/new.ts", content: "export const fresh = true;\n" },
			{ path: "/src/value.ts", content: "export const value = 2;\n" },
		];
		const revision = await buildSourceRevision({
			id: "revision-1",
			parentId: "commit-1",
			before,
			after,
			createdAt: "2026-08-15T00:00:00.000Z",
		});

		expect(revision.files.map((file) => [file.path, file.operation])).toEqual([
			["src/new.ts", "add"],
			["src/old.ts", "delete"],
			["src/value.ts", "modify"],
		]);
		expect(revision.files.every((file) => file.patch.includes("@@"))).toBe(true);
		expect(await applySourceRevision(before, revision)).toEqual(after.map((file) => ({ ...file, path: file.path.slice(1) })));
		expect(revision.resultingTreeSha256).toBe(await hashSourceTree(after));
	});

	it("rejects a revision when the local parent tree has diverged", async () => {
		const revision = await buildSourceRevision({
			id: "revision-2",
			before: [{ path: "lesson.ts", content: "old\n" }],
			after: [{ path: "lesson.ts", content: "new\n" }],
		});
		await expect(applySourceRevision([{ path: "lesson.ts", content: "locally changed\n" }], revision)).rejects.toThrow("parent tree");
	});

	it("rejects duplicate and traversal paths before diffing", async () => {
		await expect(buildSourceRevision({
			id: "revision-3",
			before: [],
			after: [{ path: "src/a.ts", content: "a" }, { path: "/src/a.ts", content: "b" }],
		})).rejects.toThrow("duplicate or unsafe path");
		await expect(buildSourceRevision({
			id: "revision-4",
			before: [],
			after: [{ path: "../outside.ts", content: "unsafe" }],
		})).rejects.toThrow("duplicate or unsafe path");
	});
});

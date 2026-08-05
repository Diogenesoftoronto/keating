import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as nodeFs from "node:fs";

import { createSandboxGit, type SandboxGit, type SandboxGitFs } from "../keating/sandbox-git";

/**
 * The module takes an injectable fs, so the engine can be exercised against a
 * real temp directory instead of browser IndexedDB.
 */
async function withRepo(run: (repo: SandboxGit) => Promise<void>): Promise<void> {
	const dir = await mkdtemp(join(tmpdir(), "keating-sandbox-git-"));
	try {
		const repo = createSandboxGit({
			fs: { promises: nodeFs.promises } as unknown as SandboxGitFs,
			dir: join(dir, "sandbox"),
		});
		await run(repo);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

describe("sandbox git", () => {
	test("commits retain file content, not just hashes", async () => {
		await withRepo(async (repo) => {
			const oid = await repo.commit(
				[{ path: "/workspace/a.js", content: "export const a = 1;\n" }],
				"first",
			);

			const files = await repo.readCommitFiles(oid);
			expect(files).toHaveLength(1);
			expect(files[0].path).toBe("/workspace/a.js");
			// The whole point of the swap: the body survives the round-trip.
			expect(files[0].content).toBe("export const a = 1;\n");
		});
	});

	test("log reports commits newest-first with messages and file counts", async () => {
		await withRepo(async (repo) => {
			await repo.commit([{ path: "/a.txt", content: "one" }], "first");
			await repo.commit(
				[
					{ path: "/a.txt", content: "one" },
					{ path: "/b.txt", content: "two" },
				],
				"second",
			);

			const commits = await repo.listCommits();
			expect(commits.map((c) => c.message)).toEqual(["second", "first"]);
			expect(commits[0].fileCount).toBe(2);
			expect(commits[1].fileCount).toBe(1);
			expect(new Date(commits[0].createdAt).toString()).not.toBe("Invalid Date");
		});
	});

	test("commits land on the checked-out branch, not always main", async () => {
		// This is the defect in the previous IndexedDB implementation: it wrote
		// every commit to main regardless of the active branch.
		await withRepo(async (repo) => {
			await repo.commit([{ path: "/a.txt", content: "base" }], "base");

			await repo.createBranch("feature");
			await repo.checkoutBranch("feature");
			expect(await repo.activeBranchId()).toBe("feature");

			await repo.commit([{ path: "/a.txt", content: "changed" }], "on-feature");

			const onFeature = await repo.listCommits("feature");
			const onMain = await repo.listCommits("main");

			expect(onFeature.map((c) => c.message)).toEqual(["on-feature", "base"]);
			expect(onMain.map((c) => c.message)).toEqual(["base"]);
		});
	});

	test("listBranches reports every branch and its head", async () => {
		await withRepo(async (repo) => {
			await repo.commit([{ path: "/a.txt", content: "base" }], "base");
			await repo.createBranch("feature");

			const branches = await repo.listBranches();
			const names = branches.map((b) => b.name).sort();
			expect(names).toEqual(["feature", "main"]);
			for (const branch of branches) {
				expect(branch.id).toBe(branch.name);
				expect(branch.commitId).toBeTruthy();
			}
		});
	});

	test("diff classifies added, removed, modified and unchanged", async () => {
		await withRepo(async (repo) => {
			const first = await repo.commit(
				[
					{ path: "/keep.txt", content: "same" },
					{ path: "/edit.txt", content: "before" },
					{ path: "/gone.txt", content: "bye" },
				],
				"first",
			);
			const second = await repo.commit(
				[
					{ path: "/keep.txt", content: "same" },
					{ path: "/edit.txt", content: "after" },
					{ path: "/new.txt", content: "hello" },
				],
				"second",
			);

			const changes = await repo.diffCommits(first, second);
			const byPath = new Map(changes.map((c) => [c.path, c.status]));

			expect(byPath.get("keep.txt")).toBe("unchanged");
			expect(byPath.get("edit.txt")).toBe("modified");
			expect(byPath.get("gone.txt")).toBe("removed");
			expect(byPath.get("new.txt")).toBe("added");
		});
	});

	test("an earlier commit can be read back for restore", async () => {
		await withRepo(async (repo) => {
			const first = await repo.commit([{ path: "/a.txt", content: "original" }], "first");
			await repo.commit([{ path: "/a.txt", content: "modified" }], "second");

			const restored = await repo.readCommitFiles(first);
			expect(restored).toEqual([{ path: "/a.txt", content: "original" }]);
		});
	});

	test("export/import round-trips history into a fresh repo", async () => {
		await withRepo(async (source) => {
			await source.commit([{ path: "/a.txt", content: "one" }], "first");
			await source.commit([{ path: "/a.txt", content: "two" }], "second");
			const bundle = await source.export();

			expect(bundle.schemaVersion).toBe(2);
			expect(Object.keys(bundle.objects).length).toBeGreaterThan(0);

			// The denormalized summary is what the fine-tune export reads.
			expect(bundle.commits.map((c) => c.message)).toEqual(["second", "first"]);
			expect(bundle.commits[0].files).toEqual([{ path: "a.txt", hash: expect.any(String) }]);

			await withRepo(async (target) => {
				await target.import(bundle);
				const commits = await target.listCommits();
				expect(commits.map((c) => c.message)).toEqual(["second", "first"]);

				const latest = await target.readCommitFiles(commits[0].id);
				expect(latest).toEqual([{ path: "/a.txt", content: "two" }]);
			});
		});
	});

	test("import rejects a payload that is not schemaVersion 2", async () => {
		await withRepo(async (repo) => {
			let caught: unknown;
			try {
				await repo.import({ schemaVersion: 1, objects: {} } as never);
			} catch (error) {
				caught = error;
			}
			expect(caught).toBeInstanceOf(Error);
			expect((caught as Error).message).toMatch(/Unsupported sandbox git export/);
		});
	});
});

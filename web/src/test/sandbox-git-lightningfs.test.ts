/**
 * Exercises the seam the other sandbox-git tests don't: the real browser
 * backing store. sandbox-git.test.ts runs the engine against node's fs, which
 * proves the git logic but not that isomorphic-git and LightningFS actually
 * cooperate over IndexedDB. This drives that combination against a fake
 * IndexedDB so a browser-only breakage can't reach production silently.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";

import LightningFS from "@isomorphic-git/lightning-fs";
import { createSandboxGit, type SandboxGitFs } from "../keating/sandbox-git";

// Assign the globals explicitly rather than relying on `fake-indexeddb/auto`'s
// import side effect: the whole web suite shares one process, so import order
// alone doesn't guarantee these are present (or still present) by the time
// LightningFS reaches for them.
beforeEach(() => {
	const globals = globalThis as unknown as {
		indexedDB: IDBFactory;
		IDBKeyRange: typeof IDBKeyRange;
	};
	globals.indexedDB = new IDBFactory();
	globals.IDBKeyRange = IDBKeyRange;
});

function freshRepo(name: string) {
	return createSandboxGit({
		fs: new LightningFS(name, { wipe: true }) as unknown as SandboxGitFs,
		dir: "/sandbox",
	});
}

describe("sandbox git on LightningFS", () => {
	test("commits and reads back content through IndexedDB", async () => {
		const repo = freshRepo("keating-test-basic");

		const oid = await repo.commit(
			[{ path: "/workspace/index.js", content: "console.log('hi');\n" }],
			"first",
		);

		const commits = await repo.listCommits();
		expect(commits.map((c) => c.message)).toEqual(["first"]);
		expect(commits[0].id).toBe(oid);

		const files = await repo.readCommitFiles(oid);
		expect(files).toEqual([{ path: "/workspace/index.js", content: "console.log('hi');\n" }]);
	});

	test("branch, checkout and diff work against the browser store", async () => {
		const repo = freshRepo("keating-test-branching");

		const first = await repo.commit([{ path: "/a.txt", content: "base" }], "base");
		await repo.createBranch("feature");
		await repo.checkoutBranch("feature");
		expect(await repo.activeBranchId()).toBe("feature");

		const second = await repo.commit([{ path: "/a.txt", content: "changed" }], "on-feature");

		expect((await repo.listCommits("main")).map((c) => c.message)).toEqual(["base"]);
		expect((await repo.listCommits("feature")).map((c) => c.message)).toEqual([
			"on-feature",
			"base",
		]);

		const changes = await repo.diffCommits(first, second);
		expect(changes.find((c) => c.path === "a.txt")?.status).toBe("modified");
	});

	test("export carries both raw objects and a commit summary", async () => {
		const repo = freshRepo("keating-test-export");

		await repo.commit([{ path: "/a.txt", content: "one" }], "first");
		const bundle = await repo.export();

		expect(bundle.schemaVersion).toBe(2);
		expect(Object.keys(bundle.objects).length).toBeGreaterThan(0);
		expect(bundle.commits.map((c) => c.message)).toEqual(["first"]);
	});
});

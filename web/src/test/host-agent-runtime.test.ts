import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executeHostAgentOperation } from "../../server/utils/host-agent-runtime";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixtureRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "keating-host-runtime-"));
	roots.push(root);
	await mkdir(join(root, "src"));
	await writeFile(join(root, "src", "lesson.ts"), "export const score = 1;\n", "utf8");
	return root;
}

describe("host agent runtime", () => {
	it("runs commands directly on the host inside the configured root", async () => {
		const root = await fixtureRoot();
		const result = await executeHostAgentOperation(root, "shell.exec", {
			command: "pwd",
			cwd: "/workspace/src",
		}) as { exitCode: number | null; stdout: string };

		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe(join(root, "src"));
	});

	it("supports external-runtime file listing, reading, and precise edits", async () => {
		const root = await fixtureRoot();
		const listed = await executeHostAgentOperation(root, "fs.list", { path: "/workspace/src" }) as Array<{ name: string }>;
		const read = await executeHostAgentOperation(root, "fs.read", { path: "/workspace/src/lesson.ts" }) as { content: string };
		await executeHostAgentOperation(root, "fs.edit", {
			path: "/workspace/src/lesson.ts",
			search: "score = 1",
			replace: "score = 2",
		});
		const edited = await executeHostAgentOperation(root, "fs.read", { path: "src/lesson.ts" }) as { content: string };

		expect(listed.map((entry) => entry.name)).toEqual(["lesson.ts"]);
		expect(read.content).toContain("score = 1");
		expect(edited.content).toContain("score = 2");
	});

	it("rejects filesystem and cwd traversal outside the project root", async () => {
		const root = await fixtureRoot();

		await expect(executeHostAgentOperation(root, "fs.read", { path: "../outside" })).rejects.toThrow("escapes project root");
		await expect(executeHostAgentOperation(root, "shell.exec", { command: "pwd", cwd: "../outside" })).rejects.toThrow("escapes project root");
	});
});

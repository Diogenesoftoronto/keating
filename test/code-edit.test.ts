import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import { applySourceEdit, applySourceEdits, rollbackEdits, editResultToMarkdown } from "../src/core/code-edit.js";

async function makeTmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "keating-code-edit-"));
}

describe("applySourceEdit", () => {
  let cwd: string;

  beforeEach(async () => { cwd = await makeTmpDir(); });
  afterEach(() => { try { rmSync(cwd, { recursive: true }); } catch {} });

  test("applies a simple search/replace", async () => {
    await writeFile(join(cwd, "test.ts"), "const a = 1;\nconst b = 2;\n", "utf8");
    const result = await applySourceEdit(cwd, {
      file: "test.ts",
      search: "const a = 1;",
      replace: "const a = 42;",
      reason: "update value",
    });
    expect(result.success).toBe(true);
    expect(result.diff?.linesRemoved).toBe(1);
    expect(result.diff?.linesAdded).toBe(1);
    expect(await readFile(join(cwd, "test.ts"), "utf8")).toBe("const a = 42;\nconst b = 2;\n");
  });

  test("rejects when search block not found", async () => {
    await writeFile(join(cwd, "test.ts"), "const a = 1;\n", "utf8");
    const result = await applySourceEdit(cwd, {
      file: "test.ts",
      search: "const z = 99;",
      replace: "const z = 0;",
      reason: "missing",
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain("Search block not found");
  });

  test("rejects when search block is ambiguous", async () => {
    await writeFile(join(cwd, "test.ts"), "const x = 1;\nconst x = 1;\n", "utf8");
    const result = await applySourceEdit(cwd, {
      file: "test.ts",
      search: "const x = 1;",
      replace: "const x = 2;",
      reason: "ambiguous",
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain("appears 2 times");
  });

  test("rejects when file does not exist", async () => {
    const result = await applySourceEdit(cwd, {
      file: "missing.ts",
      search: "a",
      replace: "b",
      reason: "missing file",
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain("Cannot read file");
  });

  test("creates backup when backupDir is provided", async () => {
    await writeFile(join(cwd, "test.ts"), "original\n", "utf8");
    const backupDir = join(cwd, ".backups");
    const result = await applySourceEdit(cwd, {
      file: "test.ts",
      search: "original",
      replace: "modified",
      reason: "test backup",
    }, backupDir);
    expect(result.success).toBe(true);
    const backupContent = await readFile(join(backupDir, "test.ts"), "utf8");
    expect(backupContent).toBe("original\n");
  });
});

describe("applySourceEdits batch", () => {
  let cwd: string;

  beforeEach(async () => { cwd = await makeTmpDir(); });
  afterEach(() => { try { rmSync(cwd, { recursive: true }); } catch {} });

  test("applies multiple edits in sequence", async () => {
    await writeFile(join(cwd, "test.ts"), "const a = 1;\nconst b = 2;\nconst c = 3;\n", "utf8");
    const { results } = await applySourceEdits(cwd, [
      { file: "test.ts", search: "const a = 1;", replace: "const a = 10;", reason: "a" },
      { file: "test.ts", search: "const b = 2;", replace: "const b = 20;", reason: "b" },
    ]);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(true);
    const content = await readFile(join(cwd, "test.ts"), "utf8");
    expect(content).toBe("const a = 10;\nconst b = 20;\nconst c = 3;\n");
  });

  test("stops on first failure and provides rollback snapshots", async () => {
    await writeFile(join(cwd, "test.ts"), "const a = 1;\nconst b = 2;\n", "utf8");
    const { results, rollbackSnapshots } = await applySourceEdits(cwd, [
      { file: "test.ts", search: "const a = 1;", replace: "const a = 10;", reason: "a" },
      { file: "test.ts", search: "NOT_FOUND", replace: "x", reason: "fail" },
    ]);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(rollbackSnapshots.has("test.ts")).toBe(true);
    expect(rollbackSnapshots.get("test.ts")).toBe("const a = 1;\nconst b = 2;\n");
  });
});

describe("rollbackEdits", () => {
  let cwd: string;

  beforeEach(async () => { cwd = await makeTmpDir(); });
  afterEach(() => { try { rmSync(cwd, { recursive: true }); } catch {} });

  test("restores files from snapshots", async () => {
    await writeFile(join(cwd, "test.ts"), "const a = 1;\n", "utf8");
    await applySourceEdit(cwd, { file: "test.ts", search: "const a = 1;", replace: "const a = 99;", reason: "change" });

    const snapshots = new Map<string, string>();
    snapshots.set("test.ts", "const a = 1;\n");
    await rollbackEdits(cwd, snapshots);

    expect(await readFile(join(cwd, "test.ts"), "utf8")).toBe("const a = 1;\n");
  });
});

describe("editResultToMarkdown", () => {
  test("formats success and failure", () => {
    const md = editResultToMarkdown([
      { success: true, file: "a.ts", message: "ok", diff: { linesRemoved: 2, linesAdded: 3, charDelta: 5 } },
      { success: false, file: "b.ts", message: "not found" },
    ]);
    expect(md).toContain("Succeeded: 1");
    expect(md).toContain("Failed: 1");
    expect(md).toContain("a.ts");
    expect(md).toContain("b.ts");
    expect(md).toContain("not found");
  });
});

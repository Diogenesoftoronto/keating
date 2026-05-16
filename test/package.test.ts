import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { configPath } from "../src/core/config.js";
import { detectAiRuntime } from "../src/runtime/pi.js";

test("npm package manifest includes only the CLI launcher from bin", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));

  expect(pkg.files).toContain("bin/keating.js");
  expect(pkg.files).not.toContain("bin/");
});

test("runtime discovery finds Keating's bundled pi coding agent", async () => {
  const packageRoot = await mkdtemp(join(tmpdir(), "keating-package-root-"));
  const workdir = await mkdtemp(join(tmpdir(), "keating-runtime-cwd-"));
  const cliPath = join(packageRoot, "node_modules", "@mariozechner", "pi-coding-agent", "dist", "cli.js");

  await mkdir(join(cliPath, ".."), { recursive: true });
  await writeFile(cliPath, "console.log('fake pi');\n", "utf8");
  await writeFile(configPath(workdir), JSON.stringify({ pi: { runtimePreference: "embedded-only" } }), "utf8");

  const previous = process.env.KEATING_PACKAGE_ROOT_OVERRIDE;
  process.env.KEATING_PACKAGE_ROOT_OVERRIDE = packageRoot;
  try {
    const report = await detectAiRuntime(workdir);
    expect(report.selected?.kind).toBe("embedded-keating");
    expect(report.selected?.cliPath).toBe(cliPath);
  } finally {
    if (previous === undefined) delete process.env.KEATING_PACKAGE_ROOT_OVERRIDE;
    else process.env.KEATING_PACKAGE_ROOT_OVERRIDE = previous;
    await rm(packageRoot, { recursive: true, force: true });
    await rm(workdir, { recursive: true, force: true });
  }
});

test("dotenv startup output is quiet unless Keating debug is enabled", () => {
  const result = spawnSync("bun", ["--eval", "import './src/core/verification.ts';"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      DEBUG: "",
      KEATING_DEBUG: "",
    },
  });

  expect(result.status).toBe(0);
  expect(result.stdout).not.toContain("injected env");
  expect(result.stderr).not.toContain("injected env");
});

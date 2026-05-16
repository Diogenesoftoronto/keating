import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { configPath } from "../src/core/config.js";
import { detectAiRuntime, launchShell } from "../src/runtime/pi.js";

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

test.serial("shell falls back from unauthenticated Google default to configured OpenAI credentials", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "keating-auth-cwd-"));
  const bindir = await mkdtemp(join(tmpdir(), "keating-auth-bin-"));
  const capturePath = join(workdir, "args.json");
  const piPath = join(bindir, "pi");

  await writeFile(piPath, `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "1.0.0"
  exit 0
fi
node -e "require('node:fs').writeFileSync(process.argv[1], JSON.stringify({ args: process.argv.slice(2), openai: process.env.OPENAI_API_KEY || '', gemini: process.env.GEMINI_API_KEY || '' }))" "${capturePath}" "$@"
`, "utf8");
  await chmod(piPath, 0o755);
  await writeFile(configPath(workdir), JSON.stringify({
    pi: {
      runtimePreference: "standalone-only",
      defaultProvider: "google",
      defaultModel: "gemini-3.1-pro-preview",
      defaultThinking: "medium"
    }
  }), "utf8");

  const previous = {
    PATH: process.env.PATH,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_OAUTH_TOKEN: process.env.ANTHROPIC_OAUTH_TOKEN
  };
  process.env.PATH = `${bindir}:${process.env.PATH ?? ""}`;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  process.env.OPENAI_API_KEY = "openai-test-key";
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_OAUTH_TOKEN;

  try {
    const code = await launchShell(workdir, ["hello"]);
    const captured = JSON.parse(await readFile(capturePath, "utf8"));
    expect(code).toBe(0);
    expect(captured.args).toContain("--provider");
    expect(captured.args[captured.args.indexOf("--provider") + 1]).toBe("openai");
    expect(captured.args[captured.args.indexOf("--model") + 1]).toBe("gpt-5.2");
    expect(captured.openai).toBe("openai-test-key");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(workdir, { recursive: true, force: true });
    await rm(bindir, { recursive: true, force: true });
  }
});

test.serial("shell reports actionable credential setup when no supported provider is configured", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "keating-auth-missing-cwd-"));
  const bindir = await mkdtemp(join(tmpdir(), "keating-auth-missing-bin-"));
  const piPath = join(bindir, "pi");

  await writeFile(piPath, `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "1.0.0"
  exit 0
fi
exit 0
`, "utf8");
  await chmod(piPath, 0o755);
  await writeFile(configPath(workdir), JSON.stringify({
    pi: {
      runtimePreference: "standalone-only",
      defaultProvider: "google",
      defaultModel: "gemini-3.1-pro-preview"
    }
  }), "utf8");

  const previous = {
    PATH: process.env.PATH,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_OAUTH_TOKEN: process.env.ANTHROPIC_OAUTH_TOKEN
  };
  process.env.PATH = `${bindir}:${process.env.PATH ?? ""}`;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_OAUTH_TOKEN;

  try {
    let message = "";
    try {
      await launchShell(workdir, ["hello"]);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("export GEMINI_API_KEY=your_google_ai_studio_key");
    expect(message).toContain("OPENAI_API_KEY");
    expect(message).toContain("keating setup");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(workdir, { recursive: true, force: true });
    await rm(bindir, { recursive: true, force: true });
  }
});

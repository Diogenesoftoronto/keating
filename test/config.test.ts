import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  DEFAULT_KEATING_CONFIG,
  configPath,
  ensureConfig,
  loadKeatingConfig,
  mergePiDefaults
} from "../src/core/config.js";

test("ensureConfig creates the default config and loadKeatingConfig reads it", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "keating-config-"));
  await ensureConfig(workdir);
  const config = await loadKeatingConfig(workdir);
  const saved = JSON.parse(await readFile(configPath(workdir), "utf8"));

  assert.deepEqual(config, DEFAULT_KEATING_CONFIG);
  assert.deepEqual(saved, DEFAULT_KEATING_CONFIG);
});

test("mergePiDefaults injects model defaults but preserves explicit user overrides", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "keating-config-override-"));
  await writeFile(
    configPath(workdir),
    JSON.stringify(
      {
        pi: {
          runtimePreference: "prefer-standalone",
          defaultProvider: "anthropic",
          defaultModel: "anthropic/claude-sonnet-4-5",
          defaultThinking: "high"
        }
      },
      null,
      2
    ),
    "utf8"
  );
  const config = await loadKeatingConfig(workdir);

  assert.deepEqual(mergePiDefaults(config, ["hello"]), [
    "--thinking",
    "high",
    "--model",
    "anthropic/claude-sonnet-4-5",
    "--provider",
    "anthropic",
    "hello"
  ]);

  assert.deepEqual(
    mergePiDefaults(config, ["--model", "openai/gpt-5", "--provider", "openai", "--thinking", "low", "hello"]),
    ["--model", "openai/gpt-5", "--provider", "openai", "--thinking", "low", "hello"]
  );
});

import { test, expect } from "bun:test";
import * as fc from "fast-check";
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

// ─── Config loading properties ─────────────────────────────────────────────

test("ALWAYS: loadKeatingConfig with missing file returns DEFAULT_KEATING_CONFIG", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "keating-cfg-"));
  const config = await loadKeatingConfig(workdir);
  expect(config).toEqual(DEFAULT_KEATING_CONFIG);
});

test("ALWAYS: loadKeatingConfig with invalid JSON returns DEFAULT_KEATING_CONFIG", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "keating-cfg-"));
  await writeFile(configPath(workdir), "not json at all {{{}}}", "utf8");
  const config = await loadKeatingConfig(workdir);
  expect(config).toEqual(DEFAULT_KEATING_CONFIG);
});

test("ALWAYS: ensureConfig creates the default config and loadKeatingConfig reads it", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "keating-cfg-"));
  await ensureConfig(workdir);
  const config = await loadKeatingConfig(workdir);
  const saved = JSON.parse(await readFile(configPath(workdir), "utf8"));
  expect(config).toEqual(DEFAULT_KEATING_CONFIG);
  expect(saved).toEqual(DEFAULT_KEATING_CONFIG);
});

test("ALWAYS: loadKeatingConfig preserves valid overrides, defaults missing fields", async () => {
  await fc.assert(fc.asyncProperty(
    fc.record({
      runtimePreference: fc.constantFrom("standalone-only", "prefer-standalone", "embedded-only"),
      defaultProvider: fc.option(fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0), { nil: undefined }),
      defaultModel: fc.option(fc.string({ minLength: 1, maxLength: 40 }).filter(s => s.trim().length > 0), { nil: undefined }),
      defaultThinking: fc.option(fc.constantFrom("low", "medium", "high"), { nil: undefined }),
      persistTraces: fc.boolean(),
      traceTopLearners: fc.integer({ min: 1, max: 10 }),
      consoleSummary: fc.boolean(),
    }),
    async (overrides) => {
      const workdir = await mkdtemp(join(tmpdir(), "keating-cfg-"));
      const partial = {
        pi: {
          runtimePreference: overrides.runtimePreference,
          ...(overrides.defaultProvider ? { defaultProvider: overrides.defaultProvider } : {}),
          ...(overrides.defaultModel ? { defaultModel: overrides.defaultModel } : {}),
          ...(overrides.defaultThinking ? { defaultThinking: overrides.defaultThinking } : {}),
        },
        debug: {
          persistTraces: overrides.persistTraces,
          traceTopLearners: overrides.traceTopLearners,
          consoleSummary: overrides.consoleSummary,
        }
      };
      await writeFile(configPath(workdir), JSON.stringify(partial), "utf8");
      const config = await loadKeatingConfig(workdir);

      expect(config.pi.runtimePreference).toBe(overrides.runtimePreference);
      expect(config.debug.persistTraces).toBe(overrides.persistTraces);
      expect(config.debug.traceTopLearners).toBe(overrides.traceTopLearners);
      expect(config.debug.consoleSummary).toBe(overrides.consoleSummary);

      if (overrides.defaultProvider) expect(config.pi.defaultProvider).toBe(overrides.defaultProvider.trim());
      else expect(config.pi.defaultProvider).toBe(DEFAULT_KEATING_CONFIG.pi.defaultProvider);

      if (overrides.defaultModel) expect(config.pi.defaultModel).toBe(overrides.defaultModel.trim());
      else expect(config.pi.defaultModel).toBe(DEFAULT_KEATING_CONFIG.pi.defaultModel);

      if (overrides.defaultThinking) expect(config.pi.defaultThinking).toBe(overrides.defaultThinking.trim());
      else expect(config.pi.defaultThinking).toBe(DEFAULT_KEATING_CONFIG.pi.defaultThinking);
    }
  ));
});

test("ALWAYS: loadKeatingConfig sanitizes invalid runtimePreference to default", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "keating-cfg-"));
  await writeFile(configPath(workdir), JSON.stringify({
    pi: { runtimePreference: "totally-invalid" }
  }), "utf8");
  const config = await loadKeatingConfig(workdir);
  expect(config.pi.runtimePreference).toBe(DEFAULT_KEATING_CONFIG.pi.runtimePreference);
});

test("ALWAYS: loadKeatingConfig sanitizes non-positive traceTopLearners to default", async () => {
  await fc.assert(fc.asyncProperty(
    fc.integer({ min: -100, max: 0 }),
    async (badValue) => {
      const workdir = await mkdtemp(join(tmpdir(), "keating-cfg-"));
      await writeFile(configPath(workdir), JSON.stringify({
        debug: { traceTopLearners: badValue }
      }), "utf8");
      const config = await loadKeatingConfig(workdir);
      expect(config.debug.traceTopLearners).toBe(DEFAULT_KEATING_CONFIG.debug.traceTopLearners);
    }
  ));
});

// ─── mergePiDefaults properties ─────────────────────────────────────────────

test("ALWAYS: mergePiDefaults with empty args injects all defaults", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "keating-cfg-"));
  await ensureConfig(workdir);
  const config = await loadKeatingConfig(workdir);
  const merged = mergePiDefaults(config, []);

  expect(merged).toContain("--provider");
  expect(merged).toContain("--model");
  expect(merged).toContain("--thinking");
  expect(merged.length).toBe(6);
});

test("ALWAYS: mergePiDefaults preserves explicit user overrides", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "keating-cfg-override-"));
  await writeFile(
    configPath(workdir),
    JSON.stringify({
      pi: {
        runtimePreference: "prefer-standalone",
        defaultProvider: "anthropic",
        defaultModel: "anthropic/claude-sonnet-4-5",
        defaultThinking: "high"
      }
    }, null, 2),
    "utf8"
  );
  const config = await loadKeatingConfig(workdir);

  expect(mergePiDefaults(config, ["hello"])).toEqual([
    "--thinking", "high",
    "--model", "anthropic/claude-sonnet-4-5",
    "--provider", "anthropic",
    "hello"
  ]);

  expect(
    mergePiDefaults(config, ["--model", "openai/gpt-5", "--provider", "openai", "--thinking", "low", "hello"])
  ).toEqual(
    ["--model", "openai/gpt-5", "--provider", "openai", "--thinking", "low", "hello"]
  );
});

test("ALWAYS: mergePiDefaults never duplicates flags", () => {
  fc.assert(fc.property(
    fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 10 }),
    (args) => {
      const merged = mergePiDefaults(DEFAULT_KEATING_CONFIG, args);
      const flagCounts = new Map<string, number>();
      for (const item of merged) {
        if (item.startsWith("--")) {
          flagCounts.set(item, (flagCounts.get(item) ?? 0) + 1);
        }
      }
      for (const [flag, count] of flagCounts) {
        expect(count).toBe(1);
      }
    }
  ));
});

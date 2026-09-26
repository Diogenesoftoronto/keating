import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { classifyDomainField } from "../src/retrieval/needle-domain.js";
import type { NeedleRuntimeInput } from "../src/retrieval/needle-runtime.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function directory() {
  const cwd = await mkdtemp(join(tmpdir(), "needle-domain-test-")); directories.push(cwd); return cwd;
}

test("a calibrated local classification becomes a field decision", async () => {
  const cwd = await directory();
  const result = await classifyDomainField(cwd, "quantum mechanics", {
    runtime: { model: "needle-test-v1", call: async (input: NeedleRuntimeInput) => ({
      model: "needle-test-v1", vectors: input.texts.map(() => [1, 0, 0]), selections: [],
      classifications: input.classify?.map(() => ({ field: "physics", confidence: 0.9 })) ?? [],
    }) },
  });
  expect(result).toMatchObject({ source: "local-model", field: "physics", reason: "classified", confidence: 0.9, model: "needle-test-v1" });
});

test("low confidence, unknown fields and unavailable runtimes abstain", async () => {
  const cwd = await directory();
  const runtime = (classifications: Array<{ field: string; confidence: number | null }>) => ({
    model: "needle-test-v1", call: async (input: NeedleRuntimeInput) => ({
      model: "needle-test-v1", vectors: input.texts.map(() => [1, 0, 0]), selections: [],
      classifications: input.classify?.map((_, index) => classifications[index]!) ?? [],
    }),
  });
  expect(await classifyDomainField(cwd, "topic", { runtime: runtime([{ field: "physics", confidence: 0.3 }]) })).toMatchObject({ field: null, reason: "below-confidence" });
  expect(await classifyDomainField(cwd, "topic", { runtime: runtime([{ field: "magic", confidence: 0.9 }]) })).toMatchObject({ field: null, reason: "abstained" });
  expect(await classifyDomainField(cwd, "topic", { runtime: { model: "needle-test-v1", call: async () => null } })).toBeNull();
  expect(await classifyDomainField(cwd, "topic", { runtime: { model: "needle-test-v1", call: async (input: NeedleRuntimeInput) => ({ model: "needle-test-v1", vectors: input.texts.map(() => [1, 0, 0]), selections: [] }) } })).toMatchObject({ field: null, reason: "abstained" });
});

import { test, expect } from "bun:test";
import * as fc from "fast-check";

import { policySignature, clampPolicy, DEFAULT_POLICY, loadPolicy } from "../src/core/policy.js";
import type { TeacherPolicy } from "../src/core/types.js";
import { arbPolicy, arbUnboundedPolicy, policyIsBounded } from "./helpers.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ─── policySignature properties ─────────────────────────────────────────────

test("ALWAYS: policySignature is deterministic", () => {
  fc.assert(fc.property(arbPolicy, (policy) => {
    const p = clampPolicy(policy);
    expect(policySignature(p)).toBe(policySignature(p));
  }));
});

test("ALWAYS: same policy produces same signature", () => {
  fc.assert(fc.property(arbPolicy, (policy) => {
    const p = clampPolicy(policy);
    const a = policySignature(p);
    const b = policySignature({ ...p });
    expect(a).toBe(b);
  }));
});

test("ALWAYS: different policies produce different signatures (with high probability)", () => {
  let sameSigCount = 0;
  const total = 100;
  fc.assert(fc.property(arbPolicy, arbPolicy, (a, b) => {
    const pa = clampPolicy(a);
    const pb = clampPolicy(b);
    if (policySignature(pa) === policySignature(pb)) sameSigCount++;
  }), { numRuns: total });
  expect(sameSigCount).toBeLessThan(total * 0.5);
});

test("ALWAYS: policySignature contains pipe separators", () => {
  fc.assert(fc.property(arbPolicy, (policy) => {
    const p = clampPolicy(policy);
    const sig = policySignature(p);
    expect(sig.includes("|")).toBe(true);
  }));
});

// ─── loadPolicy properties ──────────────────────────────────────────────────

test("ALWAYS: loadPolicy with missing file returns DEFAULT_POLICY", async () => {
  const dir = await mkdtemp(join(tmpdir(), "keating-policy-"));
  const policy = await loadPolicy(join(dir, "nonexistent.json"));
  expect(policy).toEqual(DEFAULT_POLICY);
});

test("ALWAYS: loadPolicy with invalid JSON returns DEFAULT_POLICY", async () => {
  const dir = await mkdtemp(join(tmpdir(), "keating-policy-"));
  const path = join(dir, "policy.json");
  await writeFile(path, "not json {{{}}}", "utf8");
  const policy = await loadPolicy(path);
  expect(policy).toEqual(DEFAULT_POLICY);
});

test("ALWAYS: loadPolicy with valid JSON returns bounded policy", async () => {
  const dir = await mkdtemp(join(tmpdir(), "keating-policy-"));
  const path = join(dir, "policy.json");
  await writeFile(path, JSON.stringify({
    name: "test",
    analogyDensity: 0.5,
    socraticRatio: 0.6,
    formalism: 0.7,
    retrievalPractice: 0.8,
    exerciseCount: 3,
    diagramBias: 0.4,
    reflectionBias: 0.3,
    interdisciplinaryBias: 0.5,
    challengeRate: 0.6
  }), "utf8");
  const policy = await loadPolicy(path);
  expect(policyIsBounded(policy)).toBe(true);
});

test("ALWAYS: loadPolicy clamps out-of-range values", async () => {
  const dir = await mkdtemp(join(tmpdir(), "keating-policy-"));
  const path = join(dir, "policy.json");
  await writeFile(path, JSON.stringify({
    name: "test",
    analogyDensity: 5,
    socraticRatio: -3,
    formalism: 0.7,
    retrievalPractice: 0.8,
    exerciseCount: 100,
    diagramBias: 0.4,
    reflectionBias: 0.3,
    interdisciplinaryBias: 0.5,
    challengeRate: 0.6
  }), "utf8");
  const policy = await loadPolicy(path);
  expect(policyIsBounded(policy)).toBe(true);
});

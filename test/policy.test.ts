import { test, expect } from "bun:test";
import * as fc from "fast-check";

import { policySignature, clampPolicy, DEFAULT_POLICY, loadPolicy } from "../src/core/policy.js";
import type { TeacherPolicy } from "../src/core/types.js";
import { arbPolicy } from "./helpers.js";
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

test("policySignature responds to a meaningful change in every signed field", () => {
  const policy = { ...DEFAULT_POLICY };
  const alternatives: TeacherPolicy[] = [
    { ...policy, analogyDensity: 0.81 },
    { ...policy, socraticRatio: 0.75 },
    { ...policy, formalism: 0.73 },
    { ...policy, retrievalPractice: 0.83 },
    { ...policy, exerciseCount: 4 },
    { ...policy, diagramBias: 0.79 },
    { ...policy, reflectionBias: 0.77 },
    { ...policy, interdisciplinaryBias: 0.71 },
    { ...policy, challengeRate: 0.67 },
  ];
  const signature = policySignature(policy);
  for (const changed of alternatives) expect(policySignature(changed)).not.toBe(signature);
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
  expect(policy).toEqual({
    name: "test",
    analogyDensity: 0.5,
    socraticRatio: 0.6,
    formalism: 0.7,
    retrievalPractice: 0.8,
    exerciseCount: 3,
    diagramBias: 0.4,
    reflectionBias: 0.3,
    interdisciplinaryBias: 0.5,
    challengeRate: 0.6,
  });
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
  expect(policy).toEqual({
    name: "test",
    analogyDensity: 1,
    socraticRatio: 0,
    formalism: 0.7,
    retrievalPractice: 0.8,
    exerciseCount: 5,
    diagramBias: 0.4,
    reflectionBias: 0.3,
    interdisciplinaryBias: 0.5,
    challengeRate: 0.6,
  });
});

test("clampPolicy rounds exercise counts at fractional boundaries while preserving in-range values", () => {
  for (const [raw, expected] of [[1.49, 1], [1.5, 2], [2.49, 2], [2.5, 3], [4.49, 4], [4.5, 5]] as const) {
    const policy = clampPolicy({ ...DEFAULT_POLICY, exerciseCount: raw });
    expect(policy.exerciseCount).toBe(expected);
    expect(policy.name).toBe(DEFAULT_POLICY.name);
    expect(policy.analogyDensity).toBe(DEFAULT_POLICY.analogyDensity);
  }
});

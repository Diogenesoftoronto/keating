import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compactDiagnosticPlan, writeCompactDiagnosticPlan } from "../scripts/context-window/compact-plan.js";
import { digest, makeTrial, SUITE_VERSION } from "../scripts/context-window/cases.js";
import { hardContextCases } from "../scripts/context-window/hard-cases.js";
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
function originalPlan() {
  const body = { version: SUITE_VERSION, createdAt: "2026-09-24T00:00:00Z", profile: "pilot", selection: "original frozen selection", trials: hardContextCases().filter(row => !row.id.startsWith("hard-trick-")).filter((_, i) => i % 2 === 0).map(c => makeTrial(c, 0.25, "pinned", "full")), providers: [{ id: "one", model: "unchanged-one" }, { id: "two", model: "unchanged-two" }, { id: "three", model: "unchanged-three" }], repetitions: 1, maxCalls: 108, maxEstimatedInputTokens: 1200000, excluded: [] };
  return { ...body, sha256: digest(body) };
}
test("paired compact diagnostic changes only conversation and derived plan metrics", () => {
  const original = originalPlan(), snapshot = JSON.stringify(original), compact = compactDiagnosticPlan(original);
  expect(JSON.stringify(original)).toBe(snapshot);
  expect(compact.trials).toHaveLength(18);
  expect(compact.providers).toEqual(original.providers);
  expect(compact.parentPlanSha256).toBe(original.sha256);
  expect(compact.maxCalls).toBe(54); expect(compact.maxEstimatedInputTokens).toBe(150000);
  expect(compact.selection).toContain("Post-hoc paired diagnostic");
  for (let i = 0; i < compact.trials.length; i++) {
    const before = original.trials[i]!, after = compact.trials[i]!;
    const prior = before.request.state as { turn: Record<string, unknown> }, next = after.request.state as { turn: Record<string, unknown> };
    expect(next.turn).toEqual({ ...prior.turn, conversation: [] });
    expect(after.request.questions).toEqual(before.request.questions);
    expect(after.expected).toEqual(before.expected); expect(after.fullExpected).toEqual(before.fullExpected);
    expect(after.id).toBe(`${before.id}/compact`);
    expect(after.requestSha256).toBe(digest(after.request)); expect(after.fullRequestSha256).toBe(after.requestSha256);
    expect(after.before).toEqual(after.after); expect(after.targetFill).toBe(after.after.fillRatio!);
    expect(after.after.estimatedRequestTokens).toBeLessThan(before.after.estimatedRequestTokens);
  }
  const { sha256, ...body } = compact; expect(sha256).toBe(digest(body));
});
test("rejects modified labels without valid frozen-plan integrity", () => {
  const original = originalPlan(); original.trials[0]!.expected.evidence_verdict = "tampered";
  expect(() => compactDiagnosticPlan(original)).toThrow("plan-integrity-failed");
});
test("writes private exclusively-created plan and leaves source untouched", async () => {
  const dir = await mkdtemp(join(tmpdir(), "keating-compact-plan-")); dirs.push(dir);
  const input = join(dir, "source.json"), raw = JSON.stringify(originalPlan()); await writeFile(input, raw);
  const output = await writeCompactDiagnosticPlan(input, join(dir, "diagnostic"));
  expect((await stat(output)).mode & 0o777).toBe(0o600);
  expect(await readFile(input, "utf8")).toBe(raw);
  await expect(writeCompactDiagnosticPlan(input, join(dir, "diagnostic"))).rejects.toThrow();
});

test("expanded diagnostic keeps every one of the 50 questions and scales the reservation", () => {
  const { sha256: _, ...source } = originalPlan();
  const body = { ...source, trials: hardContextCases().map(row => makeTrial(row, .25, "pinned", "full")) };
  const original = { ...body, sha256: digest(body) }, result = compactDiagnosticPlan(original);
  expect(result.trials).toHaveLength(50);
  expect(new Set(result.trials.map(row => row.family)).size).toBe(32);
  expect(result.maxCalls).toBe(150);
  expect(result.maxEstimatedInputTokens).toBe(400000);
  expect(result.trials.map(row => row.expected)).toEqual(original.trials.map(row => row.expected));
  expect(result.selection).toContain("original 50 hard claims");
});

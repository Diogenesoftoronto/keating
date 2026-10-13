import { afterEach, beforeEach, expect, test } from "bun:test";
import type { TeachingDraftSnapshot } from "@keating/learner-contracts";
import { clearTeachingDraftStatuses, clearTeachingDraftTally, getTeachingDraftTally, publishTeachingDraftStatus } from "../keating/judgement/draft-status";
import { clearDiagnostics, getDiagnosticsSnapshot } from "../lib/diagnostics";

const snapshot = (count: number, overrides: Partial<TeachingDraftSnapshot> = {}): TeachingDraftSnapshot => ({
  phase: "released", attempt: count, maxAttempts: 10, reasoning: "low", standard: "concise", elapsedMs: 1,
  judgeModel: "jev-1.13.0", selectedAttempt: count || null, reason: null,
  attempts: Array.from({ length: count }, (_, index) => ({ attempt: index + 1, reasoning: "low", standard: "concise",
    generationMs: 1, judgementMs: 1, status: "pass", checks: [], variant: "default" })),
  ...overrides,
});

beforeEach(() => { clearTeachingDraftStatuses(); clearTeachingDraftTally(); clearDiagnostics(); });
afterEach(() => { clearTeachingDraftStatuses(); clearTeachingDraftTally(); clearDiagnostics(); });

test("attempt distribution excludes turns ending before generation and uses observed nearest ranks", () => {
  publishTeachingDraftStatus("unavailable", snapshot(0, { phase: "withheld", attempt: 1, reason: "review-unavailable" }));
  expect(getTeachingDraftTally()).toMatchObject({ turns: 1, noDraftTurns: 1, draftedTurns: 0,
    oneOrTwoAttemptShare: null, overThreeAttemptShare: null, attemptPercentiles: { p50: null, p95: null, p99: null } });
  for (const count of [1, 2, 3, 10]) publishTeachingDraftStatus(`draft-${count}`, snapshot(count));
  expect(getTeachingDraftTally()).toMatchObject({ turns: 5, released: 4, noDraftTurns: 1, draftedTurns: 4,
    attemptHistogram: [1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1], oneOrTwoAttemptShare: .5,
    overThreeAttemptShare: .25, attemptPercentiles: { p50: 2, p95: 10, p99: 10 } });
});

test("counts terminal turns once, ignores cancellation, and recognizes another turn in the same session", () => {
  publishTeachingDraftStatus("session", snapshot(0, { phase: "planning" }));
  publishTeachingDraftStatus("session", snapshot(1, { phase: "checking" }));
  publishTeachingDraftStatus("session", snapshot(1));
  publishTeachingDraftStatus("session", snapshot(1));
  publishTeachingDraftStatus("session", snapshot(1, { phase: "withheld" }));
  publishTeachingDraftStatus("cancelled", snapshot(2, { phase: "cancelled" }));
  expect(getTeachingDraftTally().turns).toBe(1);
  publishTeachingDraftStatus("session", snapshot(0, { phase: "planning" }));
  publishTeachingDraftStatus("session", snapshot(0, { phase: "planning" }));
  publishTeachingDraftStatus("session", snapshot(2, { reason: "best-effort-draft" }));
  expect(getTeachingDraftTally()).toMatchObject({ turns: 2, draftedTurns: 2, oneOrTwoAttemptShare: 1, bestEffortReleases: 1 });
  expect(getDiagnosticsSnapshot().filter(entry => entry.source === "teaching-drafts")).toHaveLength(2);
});

test("generation failures count as attempts while malformed numbers cannot distort the bounded histogram", () => {
  const attempt = snapshot(1).attempts[0]!;
  publishTeachingDraftStatus("recovery", snapshot(1, { attempt: 4, attempts: [
    { ...attempt, status: "generation-error" }, { ...attempt, attempt: 2 },
    { ...attempt, attempt: 2 }, { ...attempt, attempt: 1.5 }, { ...attempt, attempt: -1 },
    { ...attempt, attempt: NaN }, { ...attempt, attempt: Infinity },
  ] }));
  publishTeachingDraftStatus("legacy", snapshot(1, { attempts: [{ ...attempt, attempt: 50 }] }));
  expect(getTeachingDraftTally().attemptHistogram).toEqual([0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
  expect(getTeachingDraftTally().draftedTurns).toBe(2);
});

test("returned histograms are immutable snapshots and cannot corrupt later observations", () => {
  publishTeachingDraftStatus("first", snapshot(1));
  const first = getTeachingDraftTally();
  expect(Object.isFrozen(first.attemptHistogram)).toBe(true);
  expect(() => { (first.attemptHistogram as number[])[1] = 999; }).toThrow();
  expect(() => { (first.attemptPercentiles as { p50: number }).p50 = 999; }).toThrow();
  publishTeachingDraftStatus("second", snapshot(2));
  expect(first.draftedTurns).toBe(1);
  expect(first.attemptHistogram[2]).toBe(0);
  expect(getTeachingDraftTally().attemptHistogram.slice(0, 3)).toEqual([0, 1, 1]);
});

test("turn diagnostics retain only attempt count and the best-effort flag, never arbitrary reasons or draft text", () => {
  publishTeachingDraftStatus("PRIVATE_SESSION", snapshot(2, { reason: "best-effort-draft" }));
  publishTeachingDraftStatus("second", { ...snapshot(1), reason: "PRIVATE_REASON", text: "PRIVATE_DRAFT" } as unknown as TeachingDraftSnapshot);
  publishTeachingDraftStatus("withheld", snapshot(1, { phase: "withheld", reason: "best-effort-draft" }));
  const entries = getDiagnosticsSnapshot().filter(entry => entry.source === "teaching-drafts");
  expect(entries.map(entry => ({ attempts: entry.metadata?.attempts, bestEffort: entry.metadata?.bestEffort }))).toEqual([
    { attempts: 2, bestEffort: true }, { attempts: 1, bestEffort: false }, { attempts: 1, bestEffort: false },
  ]);
  expect(getTeachingDraftTally().bestEffortReleases).toBe(1);
  expect(JSON.stringify(entries)).not.toContain("PRIVATE_");
  expect(JSON.stringify(getTeachingDraftTally())).not.toContain("PRIVATE_");
});

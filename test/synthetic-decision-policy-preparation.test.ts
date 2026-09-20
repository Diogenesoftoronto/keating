import { expect, test } from "bun:test";
import { prepareSyntheticDecisionPolicies } from "../scripts/training/prepare-synthetic-decision-policies.js";

test("harness preparation excludes future answers, preserves source provenance and keeps family variants together", () => {
  const source = { id: "case-a", family: "family-a", actor: { opening_message: "I got stuck on fractions" }, learner: { assumptions: [] },
    source: { dataset: "mathdial", revision: "pinned-source", license: "CC-BY-4.0" }, evaluation_only: { original: { conversation: "FUTURE_ANSWER_SENTINEL" } } };
  const rows = prepareSyntheticDecisionPolicies([source, { ...source, id: "case-b" }], "scenarios.json", "a".repeat(64));
  expect(rows).toHaveLength(8);
  expect(new Set(rows.map(row => row.split)).size).toBe(1);
  expect(prepareSyntheticDecisionPolicies([source, { ...source, id: "case-b" }], "scenarios.json", "a".repeat(64))).toEqual(rows);
  for (const row of rows) {
    expect(row.requestText).not.toContain("FUTURE_ANSWER_SENTINEL");
    expect(row.original.text).toContain("CC-BY-4.0");
    expect(JSON.parse(row.requestText).state.snapshot).toBe(JSON.stringify(row.snapshot));
    expect(JSON.parse(row.requestText).state.simulation).toBe(JSON.stringify(row.state));
    expect(row.state.kind).toBe("simulated-harness");
    const card = row.snapshot.cards[0]!;
    expect(card.nextDueAt).toBe(card.lastReviewedAt + card.intervalDays * 86400000);
    expect(card.nextDueAt).toBeLessThanOrEqual(row.snapshot.asOf);
    expect(card.recallRate + card.lapseRate).toBeLessThanOrEqual(1);
  }
});

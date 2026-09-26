import { expect, test } from "bun:test";
import { trickContextCases } from "../scripts/context-window/trick-cases.js";
import { estimatedStateQuestionTokens } from "../packages/learner-contracts/src/judgement/state-metrics.js";
import { teachingPolicyState } from "../packages/learner-contracts/src/judgement/teaching-policy.js";
const cases = trickContextCases();
function row(name: string) { return cases.find(x => x.id === `hard-trick-${name}`)!; }
function record(name: string) { return JSON.parse(row(name).evidence).records; }
function check(name: string, truth: boolean) { expect(row(name).expected.evidence_verdict).toBe(truth ? "supported" : "contradicted"); }

test("fourteen new independent families have the declared frozen label distribution", () => {
  expect(cases).toHaveLength(14);
  expect(new Set(cases.map(x => x.family)).size).toBe(14);
  expect(cases.every(x => x.id.startsWith("hard-trick-") && x.family === x.id)).toBe(true);
  for (const [split, counts] of [["development", [3, 2, 2]], ["holdout", [2, 3, 2]]] as const) {
    const partition = cases.filter(x => x.split === split);
    expect(partition).toHaveLength(7);
    expect(["supported", "contradicted", "insufficient_context"].map(label => partition.filter(x => x.expected.evidence_verdict === label).length)).toEqual([...counts]);
  }
  expect(trickContextCases()).toEqual(cases);
});

test("base rates, Simpson weighting and percentage changes follow independent arithmetic", () => {
  const base = record("conditional-reversal-base-rate");
  expect(base.diseasedPositive / (base.diseasedPositive + base.diseasedNegative)).toBe(0.8);
  expect(base.diseasedPositive / (base.diseasedPositive + base.healthyPositive)).toBeLessThan(0.5);
  check("conditional-reversal-base-rate", false);
  const strata = record("simpson-aggregation") as Array<{ A: { successes: number; total: number }; B: { successes: number; total: number } }>;
  expect(strata.every(x => x.A.successes / x.A.total > x.B.successes / x.B.total)).toBe(true);
  const [a, b] = (["A", "B"] as const).map(arm => strata.reduce((n, x) => n + x[arm].successes, 0) / strata.reduce((n, x) => n + x[arm].total, 0));
  expect(a).toBeCloseTo(0.78); expect(b).toBeCloseTo(289 / 350); check("simpson-aggregation", b! > a!);
  const price = record("asymmetric-percent-reversal");
  const afterDrop = price.initialPrice + price.initialPrice * price.firstChangePercent / 100;
  const afterRise = afterDrop + afterDrop * price.secondChangePercent / 100;
  expect(afterRise).toBe(100); check("asymmetric-percent-reversal", afterRise === price.initialPrice);
});

test("rollback, UTC conversion, formal quantification and a question premise do not create facts", () => {
  const tx = record("atomic-rollback-local-success");
  expect(tx.firstOperation).toBe("succeeded"); expect(tx.transaction).toBe("rolled_back");
  check("atomic-rollback-local-success", tx.openingBalance === 70);
  const time = record("utc-calendar-boundary"); expect(time.offset).toBe("+05:30");
  // Independent minute arithmetic: 00:15 - 05:30 = previous day 18:45.
  expect(15 - (5 * 60 + 30)).toBe(-315);
  expect(24 * 60 - 315).toBe(18 * 60 + 45);
  expect(time.localTimestamp).toBe("2026-03-01 00:15"); check("utc-calendar-boundary", true);
  const proofs = record("empty-domain-universal").submittedProofs;
  expect(proofs).toHaveLength(0); check("empty-domain-universal", proofs.filter((p: { passed: boolean }) => !p.passed).length === 0);
  const valves = record("question-false-premise").measurements;
  check("question-false-premise", valves.filter((v: { measuredLeak: number }) => v.measuredLeak > 0).length > 0);
});

test("cohort denominator, replacement policy and speaker attribution substantiate their labels", () => {
  const cohort = record("survivor-sample-to-cohort");
  expect(cohort.completedAssessment + cohort.withdrewWithoutAssessment).toBe(cohort.enrolled);
  expect(cohort.passedAssessment / cohort.completedAssessment).toBe(1);
  expect(cohort.passedAssessment / cohort.enrolled).toBe(0.2); check("survivor-sample-to-cohort", false);
  const policy = record("versioned-negation-policy");
  const latest = policy.versions.filter((v: { accepted: boolean }) => v.accepted).sort((a: { revision: number }, b: { revision: number }) => b.revision - a.revision)[0];
  expect(latest.approveIf).toBe("not (suspended or expired)");
  expect(policy.applicant.member).toBe(false);
  check("versioned-negation-policy", policy.applicant.suspended || policy.applicant.expired);
  const quote = record("quotation-versus-endorsement");
  expect(quote.passage).toContain('Mira wrote, "The audit is complete."');
  const own = quote.narratorAssertions;
  check("quotation-versus-endorsement", !own.endorsesQuotedClaim && own.completedChecks < own.requiredChecks);
});

test("each insufficient case has two compatible completions with opposite truth values", () => {
  const sensor = record("copied-sources-not-independent");
  expect([sensor.dashboard, sensor.email, sensor.report].every(x => x.copiedFrom === sensor.sensor.id)).toBe(true);
  expect(sensor.possibleBias.map((bias: number) => sensor.sensor.reading - bias > 38)).toEqual([true, false]);
  const causal = record("selection-versus-causal-effect");
  const worlds = [{ healthierControl: 0.2, healthierTreatment: 0.8, sickerControl: 0.2, sickerTreatment: 0.8 }, { healthierControl: 0.8, healthierTreatment: 0.8, sickerControl: 0.2, sickerTreatment: 0.2 }];
  for (const world of worlds) {
    expect(world.healthierTreatment).toBe(causal.healthier.recoveryRate);
    expect(world.sickerControl).toBe(causal.sicker.recoveryRate);
  }
  expect(worlds.map(w => (w.healthierTreatment - w.healthierControl + w.sickerTreatment - w.sickerControl) / 2 > 0)).toEqual([true, false]);
  const batch = record("missing-population-denominator");
  expect(batch.possibleBatchSizes.map((n: number) => batch.passed / n > 0.5)).toEqual([true, false]);
  const mentors = record("quantifier-order-mentor");
  const assignments = [{ a: "m1", b: "m1" }, { a: "m1", b: "m2" }];
  expect(assignments.every(w => Object.keys(w).length === mentors.students.length && Object.values(w).every(m => mentors.mentors.includes(m)))).toBe(true);
  expect(assignments.map(w => new Set(Object.values(w)).size === 1)).toEqual([true, false]);
  for (const name of ["copied-sources-not-independent", "selection-versus-causal-effect", "missing-population-denominator", "quantifier-order-mentor"]) expect(row(name).expected.evidence_verdict).toBe("insufficient_context");
});

test("base requests remain small and omit oracle labels and private completion witnesses", () => {
  for (const fixture of cases) {
    const request = { state: teachingPolicyState({ ...fixture.turn, learnerEvidence: [{ kind: "observed-record", content: fixture.evidence }] }), questions: fixture.request.questions };
    expect(estimatedStateQuestionTokens(request)).toBeLessThan(2000);
    const serialized = JSON.stringify(request);
    for (const key of ["expected", "possibilities", "truths", "labelSource"]) expect(serialized).not.toContain(`"${key}"`);
    expect(fixture.turn.learnerEvidence).toEqual([]);
    expect(fixture.turn.conversation).toEqual([]);
    expect(Object.keys(fixture.request.questions)).toEqual(["evidence_verdict"]);
  }
});

import { expect, test } from "bun:test";
import { buildKeatingTrials, keatingScenarios } from "../scripts/context-window/keating-suite.js";
import { teachingPolicyDecisionRequest } from "../packages/learner-contracts/src/judgement/teaching-policy.js";
import { digest, type Trial } from "../scripts/context-window/cases.js";
import { summarize, type Receipt } from "../scripts/context-window/benchmark.js";
import { htmlReport, markdownReport, reportData } from "../scripts/context-window/report.js";
import type { ProviderResult } from "../scripts/context-window/providers.js";

const trials = await buildKeatingTrials();
const receipt = (trial: Trial, values: Record<string, boolean | number | string | null> | null): Receipt => {
  const outcome: ProviderResult = values === null ? { status: "error", error: "timeout", latencyMs: 1 } : { status: "ok", returnedModel: "fixture", answers: Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { value, confidence: null, probabilities: null }])), latencyMs: 1, usage: null, raw: {} };
  return { version: 1, trialId: trial.id, providerId: "fixture", providerKind: "system-one", requestedModel: "fixture", requestSha256: trial.requestSha256, repetition: 0, status: outcome.status === "ok" ? "completed" : "provider-error", outcome };
};

test("fifty production batches retain natural state and keep gold and rationale outside requests", () => {
  const scenarios = keatingScenarios();
  expect(trials).toHaveLength(50);
  expect(new Set(trials.map(row => row.family)).size).toBe(25);
  expect(trials.filter(row => row.stage === "planning")).toHaveLength(20);
  expect(trials.filter(row => row.stage === "adherence")).toHaveLength(20);
  expect(trials.filter(row => row.stage === "grading")).toHaveLength(10);
  expect(trials.reduce((n, row) => n + Object.keys(row.expected).length, 0)).toBe(162);
  expect(trials.reduce((n, row) => n + Object.keys(row.request.questions).length, 0)).toBe(1522);
  for (const trial of trials) {
    expect(trial.id).toEndWith("/native");
    expect(trial.turnsDropped).toBe(0);
    expect(trial.requestSha256).toBe(digest(trial.request));
    expect(trial.contractSha256).toBe(digest(trial.request.questions));
    expect(trial.labelSource).toBe("authored-proxy");
    for (const rationale of Object.values(trial.rationale!)) expect(JSON.stringify(trial.request)).not.toContain(rationale);
    const scenario = scenarios.find(row => trial.caseId.startsWith(row.id + "/"))!;
    if (trial.stage === "planning") {
      const production = teachingPolicyDecisionRequest(scenario.turn);
      expect(trial.request.state).toEqual(production.state);
      for (const [key, question] of Object.entries(production.questions)) expect(trial.request.questions[key]).toEqual(question);
      expect(trial.request.questions).toHaveProperty("draft_standard");
      expect(Object.keys(trial.request.questions).length).toBeGreaterThan(Object.keys(trial.expected).length);
    }
    if (trial.stage === "grading") expect(trial.request).toEqual(scenario.request!);
  }
});

test("only explicit gold is scored and whole-batch accuracy exposes a single consequential mistake", () => {
  const trial = trials.find(row => row.stage === "planning")!;
  const extra = Object.keys(trial.request.questions).find(key => !Object.hasOwn(trial.expected, key))!;
  const correct = { ...trial.expected, [extra]: true };
  const summary = summarize([trial], [receipt(trial, correct)]).models.fixture!;
  expect(summary.correct).toBe(Object.keys(trial.expected).length);
  expect(summary.requestedQuestions).toBe(Object.keys(trial.request.questions).length);
  expect(summary.labelCoverage).toBeLessThan(0.2);
  expect(summary.exactLabelledBatchAccuracy).toBe(1);
  const key = Object.keys(trial.expected)[0]!;
  const wrong = summarize([trial], [receipt(trial, { ...correct, [key]: !correct[key] })]).models.fixture!;
  expect(wrong.exactLabelledBatchAccuracy).toBe(0);
  expect(wrong.correct).toBe(summary.correct - 1);
  expect(wrong.falsePositive + wrong.falseNegative).toBe(1);
});

test("an explicit abstention can match unknown gold; a missing answer or failed call cannot", () => {
  const base = trials[0]!;
  const trial: Trial = { ...base, expected: { unknown: null, known: true }, fullExpected: { unknown: null, known: true } };
  const summary = summarize([trial], [receipt(trial, { unknown: null, known: true })]).models.fixture!;
  expect(summary.correct).toBe(2);
  expect(summary.accuracyAnswered).toBe(1);
  expect(summary.correctAbstentions).toBe(1);
  expect(summary.abstentionRecall).toBe(1);
  for (const values of [{ known: true }, null]) {
    const result = summarize([trial], [receipt(trial, values)]);
    expect(result.models.fixture!.correctAbstentions).toBe(0);
    expect(result.models.fixture!.exactLabelledBatchAccuracy).toBe(0);
    expect(result.disagreements.some(row => row.question === "unknown")).toBe(true);
  }
});

test("public reports hide learner text carried in grading choice keys and show partial label coverage", () => {
  const trial = trials.find(row => row.stage === "grading")!;
  const expected = trial.expected.evidence as string;
  const rows = [receipt(trial, { score: 4, evidence: "PRIVATE_WRONG_LEARNER_SENTENCE" })];
  const data = reportData([trial], rows);
  const serialized = JSON.stringify(data);
  expect(serialized).not.toContain(expected);
  expect(serialized).not.toContain("PRIVATE_WRONG_LEARNER_SENTENCE");
  expect(serialized).toContain("option-sha256:");
  const html = htmlReport([trial], rows);
  expect(html).not.toContain(expected);
  expect(html).toContain("Keating production judgement batches");
  expect(html).toContain("Entire labelled batch");
  expect(markdownReport([trial], rows)).toContain("Unlabelled questions have no accuracy claim");
});

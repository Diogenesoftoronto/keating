import { judgementRequestProblem } from "../../packages/learner-contracts/src/judgement/contracts.js";
import { digest, trialFromRolloutCase, type BenchmarkCase, type Trial } from "./cases.js";
import { captureKeatingRequests } from "./keating-capture.js";
import { planningScenarios } from "./keating-planning-cases.js";
import { adherenceScenarios } from "./keating-adherence-cases.js";
import { gradingScenarios } from "./keating-grading-cases.js";
import type { KeatingScenario } from "./keating-types.js";

export const KEATING_SUITE_VERSION = "keating-production-judgements/v1";
export function keatingScenarios(): KeatingScenario[] {
  const scenarios = [...planningScenarios(), ...adherenceScenarios(), ...gradingScenarios()];
  if (scenarios.length !== 50 || new Set(scenarios.map(row => row.id)).size !== 50) throw Error("expected-50-distinct-episode-cases");
  for (const family of new Set(scenarios.map(row => row.family))) {
    const rows = scenarios.filter(row => row.family === family);
    if (rows.length !== 2 || new Set(rows.map(row => row.split)).size !== 1) throw Error(`invalid-paired-family:${family}`);
    if (!Object.entries(rows[0]!.expected).some(([key, value]) => Object.hasOwn(rows[1]!.expected, key) && rows[1]!.expected[key] !== value)) throw Error(`no-label-flip:${family}`);
  }
  return scenarios;
}

export async function buildKeatingTrials(): Promise<Trial[]> {
  const trials: Trial[] = [];
  for (const scenario of keatingScenarios()) {
    if (!Object.keys(scenario.expected).length || Object.keys(scenario.expected).some(id => !scenario.rationale[id])) throw Error(`label-rationale-required:${scenario.id}`);
    const batches = await captureKeatingRequests(scenario);
    for (const [index, request] of batches.entries()) {
      const problem = judgementRequestProblem(request);
      if (problem) throw Error(`invalid-production-request:${scenario.id}:${problem}`);
      const expected = Object.fromEntries(Object.entries(scenario.expected).filter(([key]) => Object.hasOwn(request.questions, key)));
      for (const [key, value] of Object.entries(expected)) {
        const question = request.questions[key]!;
        const valid = question.type === "noul" ? value === null || typeof value === "boolean" : question.type === "choice" ? typeof value === "string" && Object.hasOwn(question.criteria, value) : typeof value === "number" && Number.isInteger(value) && value >= 0 && value < question.criteria.length;
        if (!valid) throw Error(`invalid-production-gold:${scenario.id}:${key}`);
      }
      const fixture: BenchmarkCase = { id: `${scenario.id}/batch-${index + 1}`, family: scenario.family, split: scenario.split,
        kind: scenario.stage, labelSource: Object.keys(expected).length ? "authored-proxy" : "unlabelled", turn: scenario.turn,
        request, expected, evidence: "" };
      const trial = trialFromRolloutCase(fixture);
      trials.push({ ...trial, id: trial.id.replace(/\/recorded$/, "/native"), stage: scenario.stage, title: scenario.title, contractSha256: digest(request.questions),
        rationale: Object.fromEntries(Object.keys(expected).map(key => [key, scenario.rationale[key]!])) });
    }
  }
  return trials;
}

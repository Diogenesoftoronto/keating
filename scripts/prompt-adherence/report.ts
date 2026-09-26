import { TEACHING_POLICY_RULES, TEACHING_POLICY_VERSION } from "../../packages/learner-contracts/src/judgement/teaching-policy-catalog.js";
import type { BenchmarkReceipt, DecisionLabelReceipt, JudgeFixtureReceipt } from "./benchmark.js";
import { BENCHMARK_ARMS } from "./prompts.js";

const mean = (values: readonly number[]): number | null => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
export function quantile(values: readonly number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)]!;
}
function counts(values: readonly ("pass" | "fail" | "unknown")[]) {
  const pass = values.filter(value => value === "pass").length;
  const fail = values.filter(value => value === "fail").length;
  const unknown = values.length - pass - fail;
  return { total: values.length, pass, fail, unknown, passRateAll: values.length ? pass / values.length : null,
    resolvedCoverage: values.length ? (pass + fail) / values.length : null };
}

export function summarizeBenchmark(receipts: readonly BenchmarkReceipt[]) {
  const groups = [...new Set(receipts.map(row => `${row.model.id}|${row.arm}|${row.split}`))].map(key => {
    const rows = receipts.filter(row => `${row.model.id}|${row.arm}|${row.split}` === key);
    const first = rows[0]!;
    const judgeCalls = rows.flatMap(row => [...(row.draft ? row.draft.judgments : row.preJudge ? [row.preJudge] : []), ...(row.postJudge ? [row.postJudge] : [])]);
    const generations = rows.flatMap(row => row.draft ? row.draft.generations.map(attempt => attempt.result) : [row.generation]);
    return { model: first.model.id, arm: first.arm, split: first.split, ...counts(rows.map(row => row.status)),
      generationErrors: generations.filter(row => row.error !== null).length,
      generationAttempts: generations.length,
      draftedWithheld: rows.filter(row => row.draft && row.draft.status !== "released").length,
      truncatedGenerations: generations.filter(row => row.finishReason === "length").length,
      judgeErrors: judgeCalls.filter(row => !row.outcome.ok).length,
      held: rows.filter(row => row.release === "would-hold").length,
      meanPromptCharacters: mean(rows.map(row => row.systemPromptCharacters)),
      timing: Object.fromEntries((["generationMs", "preJudgeMs", "postJudgeMs", "draftJudgeMs", "endToEndMs"] as const).map(field => [field, {
        samples: rows.length, p50: quantile(rows.map(row => row.timing[field]), .5), p95: quantile(rows.map(row => row.timing[field]), .95),
      }])),
      firstOutputMs: { samples: rows.filter(row => row.generation.firstOutputMs !== null).length,
        p50: quantile(rows.flatMap(row => row.generation.firstOutputMs === null ? [] : [row.generation.firstOutputMs]), .5) },
      usage: {
        generationAvailable: generations.filter(row => row.usage.source !== "unavailable").length,
        generationMissing: generations.filter(row => row.usage.source === "unavailable").length,
        knownInputTokens: generations.reduce((sum, row) => sum + (row.usage.inputTokens ?? 0), 0),
        knownOutputTokens: generations.reduce((sum, row) => sum + (row.usage.outputTokens ?? 0), 0),
        knownCacheReadTokens: generations.reduce((sum, row) => sum + (row.usage.cacheReadTokens ?? 0), 0),
        knownCacheWriteTokens: generations.reduce((sum, row) => sum + (row.usage.cacheWriteTokens ?? 0), 0),
        judgeUsageAvailable: judgeCalls.filter(row => row.outcome.ok && row.outcome.response.usage).length,
        judgeUsageMissing: judgeCalls.filter(row => !row.outcome.ok || !row.outcome.response.usage).length,
        knownJudgeInputTokens: judgeCalls.reduce((sum, row) => sum + (row.outcome.ok ? row.outcome.response.usage?.inputTokens ?? 0 : 0), 0),
        knownJudgeOutputTokens: judgeCalls.reduce((sum, row) => sum + (row.outcome.ok ? row.outcome.response.usage?.outputTokens ?? 0 : 0), 0),
        actualCostUsd: null,
        estimatedGenerationCostUsd: generations.length && generations.every(row => row.usage.estimatedCostUsd !== null)
          ? generations.reduce((sum, row) => sum + row.usage.estimatedCostUsd!, 0) : null,
      },
    };
  });
  const models = [...new Set(receipts.map(row => row.model.id))];
  const rules = [...new Set([...TEACHING_POLICY_RULES.map(rule => rule.id), ...receipts.flatMap(row => row.assessment.checks.map(check => check.id))])];
  const coverage = models.flatMap(model => BENCHMARK_ARMS.flatMap(arm => rules.map(ruleId => {
    const rows = receipts.filter(row => row.model.id === model && row.arm === arm);
    const checks = rows.flatMap(row => row.assessment.checks.filter(check => check.id === ruleId));
    return { model, arm, ruleId, ...counts(checks.map(check => check.status)),
      cases: new Set(rows.filter(row => row.assessment.checks.some(check => check.id === ruleId)).map(row => row.caseId)).size };
  })));
  const pairs = models.flatMap(model => (["compact", "governed", "drafted"] as const).map(arm => {
    const baseline = receipts.filter(row => row.model.id === model && row.arm === "full");
    const joined = baseline.flatMap(full => {
      const candidate = receipts.find(row => row.model.id === model && row.arm === arm && row.caseId === full.caseId && row.repetition === full.repetition);
      return candidate ? [{ full, candidate }] : [];
    });
    const complete = joined.filter(pair => !pair.full.generation.error && !pair.candidate.generation.error
      && pair.full.postJudge?.outcome.ok && pair.candidate.postJudge?.outcome.ok
      && (arm === "compact" || pair.candidate.preJudge?.outcome.ok)
      && (!pair.candidate.draft || pair.candidate.draft.judgments.every(row => row.outcome.ok)));
    return { model, arm, scheduledBaseline: baseline.length, paired: joined.length, serviceCompletePairs: complete.length,
      passDeltaAllPairs: mean(joined.map(pair => Number(pair.candidate.status === "pass") - Number(pair.full.status === "pass"))),
      unknownBaseline: joined.filter(pair => pair.full.status === "unknown").length,
      unknownCandidate: joined.filter(pair => pair.candidate.status === "unknown").length,
      generationMsDeltaMedianAllPairs: quantile(joined.map(pair => pair.candidate.timing.generationMs - pair.full.timing.generationMs), .5),
      endToEndMsDeltaMedianAllPairs: quantile(joined.map(pair => pair.candidate.timing.endToEndMs - pair.full.timing.endToEndMs), .5),
      generationMsDeltaMedianComplete: quantile(complete.map(pair => pair.candidate.timing.generationMs - pair.full.timing.generationMs), .5),
      endToEndMsDeltaMedianComplete: quantile(complete.map(pair => pair.candidate.timing.endToEndMs - pair.full.timing.endToEndMs), .5),
      endToEndRatioMedianComplete: quantile(complete.flatMap(pair => pair.full.timing.endToEndMs > 0 ? [pair.candidate.timing.endToEndMs / pair.full.timing.endToEndMs] : []), .5),
    };
  }));
  return { policyVersion: TEACHING_POLICY_VERSION, groups, coverage, pairs,
    untestedRules: rules.filter(id => !receipts.some(row => row.assessment.checks.some(check => check.id === id))) };
}

export interface LabelObservation { readonly expected: boolean; readonly probability: number | null; readonly predicted: boolean | null }
export function labelMetrics(observations: readonly LabelObservation[]) {
  const scored = observations.filter(row => row.probability !== null);
  const resolved = observations.filter(row => row.predicted !== null);
  const tp = observations.filter(row => row.expected && row.predicted === true).length;
  const tn = observations.filter(row => !row.expected && row.predicted === false).length;
  const fp = observations.filter(row => !row.expected && row.predicted === true).length;
  const fn = observations.filter(row => row.expected && row.predicted === false).length;
  return { labels: observations.length, tp, tn, fp, fn, unknown: observations.length - resolved.length,
    resolvedCoverage: observations.length ? resolved.length / observations.length : null,
    accuracyResolved: resolved.length ? (tp + tn) / resolved.length : null,
    correctRateAll: observations.length ? (tp + tn) / observations.length : null,
    brier: mean(scored.map(row => (row.probability! - Number(row.expected)) ** 2)), brierSamples: scored.length };
}

export function summarizeJudgeFixtures(receipts: readonly JudgeFixtureReceipt[]) {
  const observations = receipts.flatMap(row => Object.entries(row.labels).map(([ruleId, expected]) => {
    const check = row.assessment.checks.find(check => check.id === ruleId);
    return { ruleId, split: row.split, family: row.family, expected, probability: check?.probability ?? null,
      predicted: check?.status === "pass" ? false : check?.status === "fail" ? true : null };
  }));
  return { kind: "authored-proxy-label-validation", thresholdFit: "none", thresholds: "predeclared-uncalibrated",
    fixtureCount: receipts.length,
    splits: (["development", "holdout"] as const).map(split => ({ split, ...labelMetrics(observations.filter(row => row.split === split)) })),
    rules: [...new Set(observations.map(row => row.ruleId))].flatMap(ruleId => (["development", "holdout"] as const).map(split => ({ ruleId, split,
      ...labelMetrics(observations.filter(row => row.ruleId === ruleId && row.split === split)) }))),
    uncoveredRules: TEACHING_POLICY_RULES.filter(rule => !observations.some(row => row.ruleId === rule.id)).map(rule => rule.id),
  };
}

export function summarizeDecisions(receipts: readonly BenchmarkReceipt[]) {
  const observations = receipts.filter(row => row.arm === "governed" || row.arm === "drafted").flatMap(row => Object.entries(row.decisionLabels).map(([decisionId, expected]) => {
    const answer = row.preJudge?.outcome.ok ? row.preJudge.outcome.response.answers[decisionId] : undefined;
    return { decisionId, split: row.split, expected, probability: answer?.type === "noul" ? answer.noul : null,
      predicted: row.plan?.decisions[decisionId] ?? null };
  }));
  return (["development", "holdout"] as const).map(split => ({ split, ...labelMetrics(observations.filter(row => row.split === split)) }));
}

/**
 * Per-label precision and recall for planning questions, plus the share of
 * overuse traps that the affordance map turned into no activity.
 */
export function summarizeDecisionLabels(receipts: readonly DecisionLabelReceipt[], traps: readonly string[] = []) {
  const observations = receipts.flatMap(row => Object.entries(row.labels).map(([labelId, expected]) => ({ labelId, split: row.split, expected,
    probability: row.probabilities[labelId] ?? null, predicted: row.predicted[labelId] ?? null })));
  const ratio = (numerator: number, denominator: number) => denominator ? numerator / denominator : null;
  const trapRows = receipts.filter(row => traps.includes(row.id));
  return { kind: "authored-planning-label-validation", thresholdFit: "none", caseCount: receipts.length,
    labels: [...new Set(observations.map(row => row.labelId))].flatMap(labelId => (["development", "holdout"] as const).map(split => {
      const metrics = labelMetrics(observations.filter(row => row.labelId === labelId && row.split === split));
      return { labelId, split, ...metrics, precision: ratio(metrics.tp, metrics.tp + metrics.fp), recall: ratio(metrics.tp, metrics.tp + metrics.fn) };
    })),
    overuseTraps: { total: trapRows.length, none: trapRows.filter(row => row.interaction === "none").length,
      noneRate: ratio(trapRows.filter(row => row.interaction === "none").length, trapRows.length) },
    interactionActions: Object.fromEntries(["none", "create", "continue", "grade-first"].map(action => [action, receipts.filter(row => row.interaction === action).length])),
  };
}

export function renderBenchmarkReport(input: {
  readonly mode: string; readonly manifest: Readonly<Record<string, unknown>>;
  readonly receipts: readonly BenchmarkReceipt[]; readonly fixtures: readonly JudgeFixtureReceipt[];
  readonly decisionLabels?: readonly DecisionLabelReceipt[]; readonly overuseTraps?: readonly string[];
}): string {
  const benchmark = summarizeBenchmark(input.receipts);
  const fixtures = summarizeJudgeFixtures(input.fixtures);
  const planning = summarizeDecisionLabels(input.decisionLabels ?? [], input.overuseTraps);
  const pct = (value: number | null): string => value === null ? "unavailable" : value.toFixed(2);
  const fmt = (value: number | null): string => value === null ? "unavailable" : value.toFixed(1);
  const lines = ["# Keating prompt adherence experiment", "", `Mode: ${input.mode}. Policy: ${TEACHING_POLICY_VERSION}.`, "",
    "This is a single-turn teaching-policy proxy benchmark with proposed native tool calls. No tools execute, no teaching revision activates, and no human learning outcome is measured.", "",
    "All arms use the same OpenUI grammar, native tool schemas, observed scenario state, common CLI domain supplement, and blind final Jev evaluator. Governed adds one pre-decision call. Drafted uses bounded private attempts, semantic repair feedback, adaptive response depth/reasoning effort, hard invariant checks, and Jev selection among acceptable candidates; every attempt and judgment remains in the receipt. Rejected text is not treated as a released answer. Timings include failed attempts; no hidden transport retries or local response cache. Provider automatic caching may still occur; reported cache tokens are retained.", "",
    "End-to-end covers pre-judgment, every private generation/check/selection when applicable, blind final judgment, and local checks; excludes one-time export/initialization and receipt writes. Generation includes credential resolution. The three single-generation arms use the SDK/provider's default reasoning setting. Drafted forwards its selected nonzero effort when the model declares support; receipts distinguish requested and forwarded effort, which is not proof the provider honored it. An off choice omits the SDK effort option rather than proving hidden reasoning was disabled. Costs derived by the provider SDK from catalog prices are estimates; actual billed cost remains unavailable.", "",
    "## Model results", "", "| Model | Arm | Split | N | Pass | Fail | Unknown | Gen errors | Gen p50 ms | End-to-end p50 ms |", "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...benchmark.groups.map(row => `| ${row.model} | ${row.arm} | ${row.split} | ${row.total} | ${row.pass} | ${row.fail} | ${row.unknown} | ${row.generationErrors} | ${fmt(row.timing.generationMs!.p50)} | ${fmt(row.timing.endToEndMs!.p50)} |`), "",
    "## Paired comparisons with full", "", "A pair is the same model, case, and repetition. All-pair latency and pass deltas retain errors, timeouts, held drafts, and abstentions. Service-complete latency is separately disclosed and excludes unavailable released answers; it can be selection-biased. Negative milliseconds mean the candidate was faster. Small samples do not establish a speed advantage.", "",
    "| Model | Candidate | All pairs | Complete pairs | Pass delta | End-to-end delta, all ms | End-to-end delta, complete ms |", "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ...benchmark.pairs.map(row => `| ${row.model} | ${row.arm} | ${row.paired} | ${row.serviceCompletePairs} | ${fmt(row.passDeltaAllPairs)} | ${fmt(row.endToEndMsDeltaMedianAllPairs)} | ${fmt(row.endToEndMsDeltaMedianComplete)} |`), "",
    "## Judge validation", "", "Labels are authored positive/negative proxy fixtures. No thresholds are fitted. Development and holdout families remain separate; the 0.2/0.8 operating points are uncalibrated. Unknowns and service errors remain in the total. Brier scores use only available probabilities and disclose their sample count.", "",
    "| Split | Labels | TP | TN | FP | FN | Unknown | Brier | Brier N |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...fixtures.splits.map(row => `| ${row.split} | ${row.labels} | ${row.tp} | ${row.tn} | ${row.fp} | ${row.fn} | ${row.unknown} | ${row.brier === null ? "unavailable" : row.brier.toFixed(4)} | ${row.brierSamples} |`), "",
    "## Planning labels", "", "Interaction features, plan-review questions and teaching decisions share the one input request. Precision and recall count only resolved answers; unknowns stay in the total. The overuse-trap rate is the share of trap cases where the affordance map offered no activity.", "",
    "| Label | Split | Labels | Precision | Recall | Unknown |", "| --- | --- | ---: | ---: | ---: | ---: |",
    ...planning.labels.filter(row => row.labels).map(row => `| ${row.labelId} | ${row.split} | ${row.labels} | ${pct(row.precision)} | ${pct(row.recall)} | ${row.unknown} |`), "",
    `Overuse traps with no activity: ${planning.overuseTraps.none}/${planning.overuseTraps.total}.`, "",
    `Untested response rules: ${benchmark.untestedRules.length ? benchmark.untestedRules.join(", ") : "none"}.`, "",
    `Rules without labeled judge fixtures: ${fixtures.uncoveredRules.length ? fixtures.uncoveredRules.join(", ") : "none"}.`, "",
    "Per-rule/model/arm coverage, usage availability, decision-label metrics, raw output, judgments, prompt hashes, corpus hashes, and source provenance are retained in summary.json, manifest.json, and the receipt files. A passing proxy judgment is not proof of accuracy or teaching effectiveness.", "",
  ];
  if (input.mode === "smoke") lines.splice(4, 0, "Offline smoke: all actor and judge outputs are injected fixtures. Passes and timings below validate harness plumbing only and are not model adherence, judge accuracy, or inference-speed measurements.", "");
  if (input.receipts.length === 0) lines.splice(4, 0, "No actor adherence or speed result is claimed in this mode.", "");
  return lines.join("\n");
}

#!/usr/bin/env bun
/** Development-only paired comparison. Sends numerical features, never source prose. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { predictTree } from "../../packages/learner-contracts/src/judgement/boosting.js";
import { predictBoostingProbability } from "../../packages/learner-contracts/src/judgement/boosting-artifact.js";
import { verifyDecisionPolicyText } from "../../packages/learner-contracts/src/judgement/decision-policy-fit.js";
import {
  DECISION_POLICY_TARGETS, compareDecisionPolicyUrgency, compareDecisionPolicyWebUrgency,
  type DecisionPolicyRow, type DecisionPolicyTarget,
} from "../../packages/learner-contracts/src/judgement/decision-policy-data.js";

const digest = async (text: string) => createHash("sha256").update(text).digest("hex");
const average = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
type Predict = (row: DecisionPolicyRow, index: number) => number;
type Compare = (left: DecisionPolicyRow, right: DecisionPolicyRow) => number;
function macro(values: readonly { group: string; loss: number }[]): number {
  const groups = new Map<string, number[]>();
  for (const value of values) {
    const rows = groups.get(value.group) ?? [];
    rows.push(value.loss); groups.set(value.group, rows);
  }
  if (!groups.size) throw new Error("benchmark_no_comparable_groups");
  return average([...groups.values()].map(average));
}

/** Independently computes the saved run's group-macro target loss. */
export function scoreTabularPolicy(target: DecisionPolicyTarget, rows: readonly DecisionPolicyRow[], predict?: Predict, compare?: Compare) {
  if (!rows.length) throw new Error("benchmark_no_validation_rows");
  const probabilities = predict ? rows.map(predict) : null;
  if (probabilities?.some(value => !Number.isFinite(value) || value < 0 || value > 1)) throw new Error("benchmark_invalid_probability");
  const squaredProbabilityError = probabilities ? macro(rows.map((row, index) => ({ group: row.groupId, loss: (probabilities[index] - row.label) ** 2 }))) : null;
  if (target !== "urgency") {
    if (!probabilities) throw new Error("benchmark_missing_predictions");
    return { loss: macro(rows.map((row, index) => ({ group: row.groupId,
      loss: target === "mastery" ? probabilities[index] >= 0.5 ? 1 - row.label : row.label : (probabilities[index] - row.label) ** 2,
    }))), squaredProbabilityError, pairs: 0, cohorts: 0 };
  }
  const cohorts = new Map<string, { row: DecisionPolicyRow; index: number }[]>();
  rows.forEach((row, index) => {
    if (!row.cohortId) throw new Error("benchmark_missing_cohort");
    const values = cohorts.get(row.cohortId) ?? [];
    values.push({ row, index }); cohorts.set(row.cohortId, values);
  });
  let pairs = 0;
  const losses: { group: string; loss: number }[] = [];
  for (const cohort of cohorts.values()) {
    let total = 0, weightSum = 0;
    for (let a = 0; a < cohort.length; a++) for (let b = a + 1; b < cohort.length; b++) {
      const left = cohort[a], right = cohort[b];
      if (left.row.groupId !== right.row.groupId || left.row.learnerId !== right.row.learnerId) throw new Error("benchmark_invalid_cohort");
      const weight = Math.abs(left.row.label - right.row.label);
      if (weight === 0) continue;
      const expected = left.row.label > right.row.label ? -1 : 1;
      const order = compare ? Math.sign(compare(left.row, right.row)) : Math.sign(probabilities![right.index] - probabilities![left.index]);
      total += weight * (order === 0 ? 0.5 : Number(order !== expected));
      weightSum += weight; pairs++;
    }
    if (weightSum) losses.push({ group: cohort[0].row.groupId, loss: total / weightSum });
  }
  return { loss: macro(losses), squaredProbabilityError, pairs, cohorts: losses.length };
}

interface BenchmarkClient {
  estimateCost(input: { trainRows: number; testRows: number; columns: number }): Promise<{ estimatedTokens: number; pricingVersion: string }>;
  fitPredict(input: { task: "regression"; columns: string[]; rows: (number | null)[][]; targets: number[]; testRows: (number | null)[][] }): Promise<{
    task: string; predictions: number[] | number[][]; modelPath: string;
    metadata: { modelVersion: string; packageVersion?: string; nEstimators?: number };
  }>;
}

export async function benchmarkTabularPolicies(options: { sourceRoot: string; output: string; client?: BenchmarkClient }) {
  await mkdir(dirname(options.output), { recursive: true, mode: 0o700 });
  await mkdir(options.output, { mode: 0o700 });
  const results = [];
  for (const target of DECISION_POLICY_TARGETS) {
    const artifactPath = join(options.sourceRoot, `.keating/datasets/decision-policies/harness-jev-v1-final-${target}/decision-policy.json`);
    const contents = await readFile(artifactPath, "utf8");
    const fileSha256 = await digest(contents);
    // Rebuild source rows, CART, CatBoost metrics, hashes, and original selection.
    const verified = await verifyDecisionPolicyText(contents, fileSha256, digest);
    const artifact = verified.artifact, dataset = artifact.dataset;
    if (dataset.labelKind !== "judgement-probability") throw new Error("benchmark_wrong_label_kind");
    const fit = dataset.rows.filter(row => row.split === "fit");
    const validation = dataset.rows.filter(row => row.split === "validation");
    const fitGroups = new Set(fit.map(row => row.groupId));
    const validationGroups = new Set(validation.map(row => row.groupId));
    if ([...validationGroups].some(group => fitGroups.has(group))) throw new Error("benchmark_group_overlap");
    const ordering = (surface: "mobile" | "web"): Compare => (left, right) => {
      if (left.baseline.kind !== "ordering" || right.baseline.kind !== "ordering") throw new Error("benchmark_invalid_baseline");
      return surface === "web" ? compareDecisionPolicyWebUrgency(left.baseline, right.baseline) : compareDecisionPolicyUrgency(left.baseline, right.baseline);
    };
    const baseline = (row: DecisionPolicyRow) => {
      if (row.baseline.kind === "classification") return row.baseline.predicted;
      if (row.baseline.kind === "probability") return row.baseline.value;
      throw new Error("benchmark_invalid_baseline");
    };
    const incumbent = scoreTabularPolicy(target, validation, target === "urgency" ? undefined : baseline, target === "urgency" ? ordering("mobile") : undefined);
    const webIncumbent = target === "urgency" ? scoreTabularPolicy(target, validation, undefined, ordering("web")) : null;
    const shallow = scoreTabularPolicy(target, validation, row => predictTree(artifact.shallow.tree, row.features));
    const rawCatBoost = artifact.boosting ? scoreTabularPolicy(target, validation, row => predictBoostingProbability(artifact.boosting!.artifact.model, row.features)) : null;
    const equal = (left: number, right: number | null | undefined) => right !== null && right !== undefined && Math.abs(left - right) < 1e-12;
    if (!equal(shallow.loss, artifact.shallow.metrics.candidateLoss) || !equal(incumbent.loss, artifact.shallow.metrics.baselineLoss)
      || webIncumbent && !equal(webIncumbent.loss, artifact.shallow.metrics.webBaselineLoss)
      || rawCatBoost && !equal(rawCatBoost.loss, artifact.boosting?.evaluation.metrics.candidateLoss)) throw new Error("benchmark_metric_reconstruction_failed");
    const previousMechanism = artifact.selected === "boosting" ? rawCatBoost! : artifact.selected === "shallow-tree" ? shallow : incumbent;
    const columns = [...dataset.features];
    const numeric = (rows: readonly DecisionPolicyRow[]) => rows.map(row => columns.map(column => Object.hasOwn(row.features, column) ? row.features[column] : null));
    const trainRows = numeric(fit), testRows = numeric(validation);
    // No group IDs, learner IDs, questions, answers, or source text enter this call.
    const quote = options.client ? await options.client.estimateCost({ trainRows: fit.length, testRows: validation.length, columns: columns.length }) : null;
    const began = performance.now();
    const prediction = options.client ? await options.client.fitPredict({ task: "regression", columns, rows: trainRows, targets: fit.map(row => row.label), testRows }) : null;
    const elapsedMs = options.client ? performance.now() - began : null;
    if (prediction && (prediction.task !== "regression" || prediction.modelPath !== "v3.5_default" || prediction.metadata.modelVersion !== "v3.5"
      || prediction.predictions.length !== validation.length || prediction.predictions.some(value => typeof value !== "number" || !Number.isFinite(value)))) throw new Error("benchmark_invalid_tabpfn_result");
    const rawProbabilities = prediction?.predictions as number[] | undefined;
    const probabilities = rawProbabilities?.map(clamp);
    const tabpfn = probabilities ? scoreTabularPolicy(target, validation, (_, index) => probabilities[index]) : null;
    const groups = [...validationGroups];
    const result = {
      target, labelKind: dataset.labelKind, metric: artifact.shallow.metrics.metric,
      artifactFileSha256: fileSha256, artifactFitSha256: artifact.fitSha256,
      features: columns, missingFeatureCells: [...trainRows, ...testRows].flat().filter(value => value === null).length,
      fitRows: fit.length, validationRows: validation.length, fitGroups: fitGroups.size, validationGroups: validationGroups.size,
      incumbent, webIncumbent, shallow, rawCatBoost,
      previousMechanism: { selected: artifact.selected ?? "incumbent", ...previousMechanism },
      tabpfn: tabpfn ? { ...tabpfn, modelPath: prediction!.modelPath, metadata: prediction!.metadata,
        latencyMs: elapsedMs, estimatedTokens: quote!.estimatedTokens, tokenPricingVersion: quote!.pricingVersion,
        actualChargedTokens: null, currencyCost: null, clampedPredictions: rawProbabilities!.filter(value => value < 0 || value > 1).length,
        lossDifferenceFromPrevious: tabpfn.loss - previousMechanism.loss,
        relativeLossReductionPercent: previousMechanism.loss ? 100 * (previousMechanism.loss - tabpfn.loss) / previousMechanism.loss : null,
      } : null,
      validation: validation.map((row, index) => ({ index, group: groups.indexOf(row.groupId), target: row.label,
        shallow: predictTree(artifact.shallow.tree, row.features),
        catboost: artifact.boosting ? predictBoostingProbability(artifact.boosting.artifact.model, row.features) : null,
        tabpfn: probabilities?.[index] ?? null,
      })),
    };
    await writeFile(join(options.output, `${target}.json`), JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    results.push(result);
    process.stdout.write(JSON.stringify({ target, previousLoss: previousMechanism.loss, tabpfnLoss: tabpfn?.loss ?? null, estimatedTokens: quote?.estimatedTokens ?? null, latencyMs: elapsedMs }) + "\n");
  }
  const summary = { schemaVersion: 1, createdAt: new Date().toISOString(), experiment: "same-saved-splits-tabpfn-v3.5-vs-previous-policy-v1",
    providerInvoked: !!options.client, nEstimators: 1, seed: 0, task: "regression", untouchedTestSet: false,
    measuredHumanOutcomes: false, causalEvidence: false, results: results.map(({ validation: _, ...result }) => result) };
  await writeFile(join(options.output, "summary.json"), JSON.stringify(summary, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return summary;
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
  const output = option("--output"), sdkPath = option("--sdk-path"), dryRun = args.includes("--dry-run");
  if (!output || !dryRun && !sdkPath) throw new Error("Usage: bun scripts/training/benchmark-tabular-policies.ts --output NEW-directory [--dry-run | --sdk-path /absolute/path/to/sdk/src/index.ts]");
  let client: BenchmarkClient | undefined;
  if (!dryRun) {
    const imported = await import(pathToFileURL(resolve(sdkPath!)).href);
    if (typeof imported.TabPfnClient !== "function") throw new Error("benchmark_missing_sdk");
    let apiKey = process.env.TABPFN_TOKEN?.trim();
    if (!apiKey) {
      const stored = Bun.spawnSync(["skate", "get", "priorlabs_api_key"], { stdout: "pipe", stderr: "ignore" });
      if (stored.exitCode !== 0) throw new Error("benchmark_missing_credential");
      apiKey = stored.stdout.toString().trim();
    }
    client = new imported.TabPfnClient({ apiKey, timeoutMs: 120_000 }) as BenchmarkClient;
  }
  await benchmarkTabularPolicies({ sourceRoot: process.cwd(), output: resolve(output), client });
}
if (import.meta.main) main().catch(error => {
  // Do not echo provider exceptions: they may include URLs or private payloads.
  process.stderr.write(error instanceof Error && error.message.startsWith("Usage:") ? `${error.message}\n` : "Tabular benchmark failed; completed target reports remain in the requested directory.\n");
  process.exitCode = 1;
});

/** Measured target-specific policy comparisons, rebuilt from exact portable source exports. */
import { fitDecisionTree, predictTree, type DecisionTree } from "./boosting.js";
import { predictBoostingProbability, type BoostingModel, type BoostingFramework, type BoostingDataset,
  type BoostingReliabilityBin } from "./boosting-artifact.js";
import { verifyDecisionPolicySourceArtifact, compareDecisionPolicyUrgency, compareDecisionPolicyWebUrgency, DECISION_POLICY_TARGETS,
  type DecisionPolicySourceArtifact, type DecisionPolicyDataset, type DecisionPolicyRow, type DecisionPolicyTarget } from "./decision-policy-data.js";

export const MAX_DECISION_POLICY_FIT_BYTES = 16 * 1024 * 1024;
export const MAX_DECISION_POLICY_FIT_ROWS = 2000;
export const DECISION_POLICY_FIT_METHOD = "source-bound-cart-then-catboost-v1";
export const DECISION_POLICY_FIT_POLICY = Object.freeze({ minFitRows: 40, minFitGroups: 8, minValidationRows: 20,
  minValidationGroups: 6, maxValidationEce: 0.15, maxTreeDepth: 3, minimumSamplesPerLeaf: 8 });
type Digest = (text: string) => Promise<string>;
type Status = "validated" | "insufficient" | "failed-validation";
function fail(): never { throw new Error("decision_policy_fit_invalid"); }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
export function decisionPolicyCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(decisionPolicyCanonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${decisionPolicyCanonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
const mean = (values: readonly number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
function macro(values: readonly { group: string; loss: number }[]): number | null {
  const groups = new Map<string, number[]>();
  for (const value of values) { const rows = groups.get(value.group) ?? []; rows.push(value.loss); groups.set(value.group, rows); }
  return mean([...groups.values()].map(rows => mean(rows)!));
}
export interface DecisionPolicyMetrics {
  metric: "classification-error" | "brier" | "discordant-cohort-ranking-error"
    | "teacher-expected-classification-error" | "teacher-probability-squared-error" | "teacher-weighted-cohort-ranking-error";
  /** Mean independent-group loss, rather than treating repeated learner rows as independent learners. */
  candidateLoss: number | null; baselineLoss: number | null; webBaselineLoss: number | null; beatsBaseline: boolean;
  validationRows: number; validationGroups: number; comparableGroups: number; comparablePairs: number; comparableCohorts: number;
  brier: number | null; ece: number | null; reliability: readonly BoostingReliabilityBin[];
}
export interface DecisionPolicyEvaluation {
  status: Status; reasons: readonly string[];
  counts: { fitRows: number; fitGroups: number; validationRows: number; validationGroups: number; fitComparableGroups: number };
  metrics: DecisionPolicyMetrics;
}
export interface DecisionPolicyFitArtifact {
  schemaVersion: 1; method: typeof DECISION_POLICY_FIT_METHOD; target: DecisionPolicyTarget; domain: string; featureSchema: string;
  policy: typeof DECISION_POLICY_FIT_POLICY; source: DecisionPolicySourceArtifact; dataset: DecisionPolicyDataset;
  shallow: DecisionPolicyEvaluation & { method: "cart-gini-v1" | "cart-soft-squared-error-v1"; tree: DecisionTree };
  boosting: { artifact: DecisionPolicyEnsemble; evaluation: DecisionPolicyEvaluation } | null;
  selected: "shallow-tree" | "boosting" | null; status: Status; fitSha256: string;
}
export interface DecisionPolicyTrainingDataset extends Omit<BoostingDataset, "observations"> {
  labelKind: DecisionPolicyDataset["labelKind"];
  observations: readonly { rowId: string; groupId: string; split: "fit" | "validation"; label: number;
    features: Readonly<Record<string, number>>; baseline?: number }[];
}
export interface DecisionPolicyEnsemble {
  method: "catboost-probability-v1"; framework: BoostingFramework; model: BoostingModel; modelSha256: string;
}

/** CART regression keeps probability targets as numbers; no synthetic binary observations are introduced. */
function softTree(rows: readonly DecisionPolicyRow[]): DecisionTree {
  const variance = (values: readonly DecisionPolicyRow[]) => {
    if (!values.length) return 0;
    const average = mean(values.map(row => row.label))!;
    return values.reduce((sum, row) => sum + (row.label - average) ** 2, 0);
  };
  const build = (values: readonly DecisionPolicyRow[], depth: number): DecisionTree => {
    const leaf: DecisionTree = { kind: "leaf", probability: mean(values.map(row => row.label)) ?? 0, sampleSize: values.length };
    if (depth >= 3 || values.length < 16) return leaf;
    let best: { feature: string; threshold: number; loss: number; left: DecisionPolicyRow[]; right: DecisionPolicyRow[] } | null = null;
    for (const feature of [...new Set(values.flatMap(row => Object.keys(row.features)))].sort()) {
      // A missing optional feature does not become zero or silently remove training rows from a split.
      if (values.some(row => !Number.isFinite(row.features[feature]))) continue;
      const unique = [...new Set(values.map(row => row.features[feature]))].sort((a, b) => a - b);
      for (let index = 1; index < unique.length; index++) {
        const threshold = (unique[index - 1] + unique[index]) / 2;
        const left = values.filter(row => row.features[feature] <= threshold), right = values.filter(row => row.features[feature] > threshold);
        if (left.length < 8 || right.length < 8) continue;
        const loss = variance(left) + variance(right);
        if (loss < (best?.loss ?? variance(values)) - 1e-12) best = { feature, threshold, loss, left, right };
      }
    }
    return best ? { kind: "split", feature: best.feature, threshold: best.threshold, sampleSize: values.length,
      left: build(best.left, depth + 1), right: build(best.right, depth + 1) } : leaf;
  };
  return build(rows.filter(row => row.split === "fit"), 0);
}

function pairLoss(rows: readonly DecisionPolicyRow[], predict: (row: DecisionPolicyRow) => number) {
  const cohorts = new Map<string, DecisionPolicyRow[]>();
  for (const row of rows) { if (!row.cohortId || row.baseline.kind !== "ordering") fail();
    const cohort = cohorts.get(row.cohortId) ?? []; cohort.push(row); cohorts.set(row.cohortId, cohort); }
  const candidate: { group: string; loss: number }[] = [], baseline: typeof candidate = [], webBaseline: typeof candidate = [];
  let pairs = 0;
  for (const cohort of cohorts.values()) {
    const candidateErrors: number[] = [], baselineErrors: number[] = [], webErrors: number[] = [], weights: number[] = [];
    for (let a = 0; a < cohort.length; a++) for (let b = a + 1; b < cohort.length; b++) {
      const left = cohort[a], right = cohort[b];
      if (left.groupId !== right.groupId || left.learnerId !== right.learnerId) fail();
      if (left.label === right.label) continue;
      if (left.baseline.kind !== "ordering" || right.baseline.kind !== "ordering") fail();
      const expected = left.label > right.label ? -1 : 1;
      const order = Math.sign(predict(right) - predict(left));
      const incumbent = Math.sign(compareDecisionPolicyUrgency(left.baseline, right.baseline));
      const webIncumbent = Math.sign(compareDecisionPolicyWebUrgency(left.baseline, right.baseline));
      const weight = Math.abs(left.label - right.label);
      candidateErrors.push(weight * (order === 0 ? 0.5 : Number(order !== expected)));
      baselineErrors.push(weight * (incumbent === 0 ? 0.5 : Number(incumbent !== expected)));
      webErrors.push(weight * (webIncumbent === 0 ? 0.5 : Number(webIncumbent !== expected)));
      weights.push(weight);
      pairs++;
    }
    if (candidateErrors.length) {
      const weight = weights.reduce((sum, value) => sum + value, 0);
      candidate.push({ group: cohort[0].groupId, loss: candidateErrors.reduce((sum, value) => sum + value, 0) / weight });
      baseline.push({ group: cohort[0].groupId, loss: baselineErrors.reduce((sum, value) => sum + value, 0) / weight });
      webBaseline.push({ group: cohort[0].groupId, loss: webErrors.reduce((sum, value) => sum + value, 0) / weight });
    }
  }
  return { candidateLoss: macro(candidate), baselineLoss: macro(baseline), webBaselineLoss: macro(webBaseline), pairs, cohorts: candidate.length,
    groups: new Set(candidate.map(row => row.group)).size };
}
function evaluate(dataset: DecisionPolicyDataset, predict: (row: DecisionPolicyRow) => number): DecisionPolicyEvaluation {
  const fit = dataset.rows.filter(row => row.split === "fit"), validation = dataset.rows.filter(row => row.split === "validation");
  const scores = validation.map(row => ({ row, probability: predict(row) }));
  if (scores.some(({ probability }) => !Number.isFinite(probability) || probability < 0 || probability > 1)) fail();
  const reliability = Array.from({ length: 10 }, (_, index) => {
    const selected = scores.filter(row => Math.min(9, Math.floor(row.probability * 10)) === index);
    return { lower: index / 10, upper: (index + 1) / 10, count: selected.length,
      meanProbability: mean(selected.map(row => row.probability)), observedFrequency: mean(selected.map(row => row.row.label)) };
  });
  const ece = validation.length ? reliability.reduce((sum, bin) => sum + bin.count * Math.abs((bin.meanProbability ?? 0) - (bin.observedFrequency ?? 0)), 0) / validation.length : null;
  const brier = macro(scores.map(({ row, probability }) => ({ group: row.groupId, loss: (probability - row.label) ** 2 })));
  let candidateLoss: number | null, baselineLoss: number | null, webBaselineLoss: number | null = null, comparableGroups: number, comparablePairs = 0, comparableCohorts = 0;
  let fitComparableGroups = new Set(fit.map(row => row.groupId)).size;
  if (dataset.target === "urgency") {
    const comparison = pairLoss(validation, predict);
    ({ candidateLoss, baselineLoss, webBaselineLoss, groups: comparableGroups, pairs: comparablePairs, cohorts: comparableCohorts } = comparison);
    fitComparableGroups = pairLoss(fit, () => 0).groups;
  } else {
    candidateLoss = macro(scores.map(({ row, probability }) => ({ group: row.groupId,
      loss: dataset.target === "mastery" ? (probability >= 0.5 ? 1 - row.label : row.label) : (probability - row.label) ** 2 })));
    baselineLoss = macro(validation.map(row => {
      if (dataset.target === "mastery" && row.baseline.kind === "classification") return { group: row.groupId, loss: row.baseline.predicted === 1 ? 1 - row.label : row.label };
      if (dataset.target === "retention" && row.baseline.kind === "probability") return { group: row.groupId, loss: (row.baseline.value - row.label) ** 2 };
      return fail();
    }));
    comparableGroups = new Set(validation.map(row => row.groupId)).size;
  }
  const counts = { fitRows: fit.length, fitGroups: new Set(fit.map(row => row.groupId)).size,
    validationRows: validation.length, validationGroups: new Set(validation.map(row => row.groupId)).size, fitComparableGroups };
  const reasons: string[] = [];
  const policy = DECISION_POLICY_FIT_POLICY;
  if (counts.fitRows < policy.minFitRows) reasons.push("insufficient-fit-rows");
  if (counts.fitGroups < policy.minFitGroups || fitComparableGroups < policy.minFitGroups) reasons.push("insufficient-independent-fit-groups");
  if (counts.validationRows < policy.minValidationRows) reasons.push("insufficient-validation-rows");
  if (counts.validationGroups < policy.minValidationGroups || comparableGroups < policy.minValidationGroups) reasons.push("insufficient-independent-validation-groups");
  if (new Set(fit.map(row => row.label)).size < 2 || new Set(validation.map(row => row.label)).size < 2) reasons.push("missing-target-variation");
  const enough = reasons.length === 0;
  const beatsBaseline = candidateLoss !== null && baselineLoss !== null && candidateLoss < baselineLoss - 1e-12
    && (dataset.target !== "urgency" || webBaselineLoss !== null && candidateLoss < webBaselineLoss - 1e-12);
  if (enough && !beatsBaseline) reasons.push("does-not-beat-incumbent");
  if (enough && dataset.target === "retention" && dataset.labelKind === "observed-binary" && (ece === null || ece > policy.maxValidationEce)) reasons.push("retention-calibration-gate-failed");
  return { status: !enough ? "insufficient" : reasons.length ? "failed-validation" : "validated", reasons, counts,
    metrics: { metric: dataset.labelKind === "judgement-probability"
      ? dataset.target === "mastery" ? "teacher-expected-classification-error" : dataset.target === "retention" ? "teacher-probability-squared-error" : "teacher-weighted-cohort-ranking-error"
      : dataset.target === "mastery" ? "classification-error" : dataset.target === "retention" ? "brier" : "discordant-cohort-ranking-error",
      candidateLoss, baselineLoss, webBaselineLoss, beatsBaseline, validationRows: counts.validationRows, validationGroups: counts.validationGroups,
      comparableGroups, comparablePairs, comparableCohorts, brier: dataset.labelKind === "observed-binary" ? brier : null,
      ece: dataset.labelKind === "observed-binary" ? ece : null, reliability: dataset.labelKind === "observed-binary" ? reliability : [] } };
}
function trainerDataset(dataset: DecisionPolicyDataset): DecisionPolicyTrainingDataset {
  const { minimumSamplesPerLeaf: _, ...policy } = DECISION_POLICY_FIT_POLICY;
  const groups = [...new Set(dataset.rows.map(value => value.groupId))];
  return { schemaVersion: 1, policy, features: dataset.features, labelKind: dataset.labelKind,
    observations: dataset.rows.map((row, index) => ({ rowId: `row-${index}`, groupId: `group-${groups.indexOf(row.groupId)}`,
      split: row.split, label: row.label, features: row.features,
      // Classification and ordering are not incumbent probabilities.
      ...(row.baseline.kind === "probability" ? { baseline: row.baseline.value } : {}) })) };
}
function finite(value: unknown, maximum = 1e6): value is number { return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= maximum; }
function frameworkOf(value: unknown, dataset: DecisionPolicyDataset): BoostingFramework {
  if (!object(value) || value.name !== "catboost" || value.version !== "1.2.10" || !object(value.parameters)) fail();
  const parameters = value.parameters;
  if (Object.keys(parameters).length > 32 || Object.values(parameters).some(value => !(typeof value === "string" && value.length <= 128)
    && typeof value !== "boolean" && !finite(value))) fail();
  if (parameters.depth !== 3 || parameters.iterations !== 300 || parameters.boosting_type !== "Plain" || parameters.thread_count !== 1
    || parameters.loss_function !== (dataset.labelKind === "judgement-probability" ? "CrossEntropy" : "Logloss")) fail();
  return { name: "catboost", version: "1.2.10", parameters: structuredClone(parameters) as BoostingFramework["parameters"] };
}
/** Strict numeric-only depth-three CatBoost codec; the shared walker handles float32 splits and sigmoid. */
function modelOf(value: unknown, features: readonly string[], stored: boolean): BoostingModel {
  if (!object(value)) fail();
  let nanMode: "min" | "max" = "min", scale: number, bias: number, rawTrees: unknown[];
  if (stored) {
    if (Object.keys(value).sort().join(",") !== "bias,nanMode,scale,trees" || value.nanMode !== "min" && value.nanMode !== "max"
      || !finite(value.scale) || !finite(value.bias) || !Array.isArray(value.trees)) fail();
    ({ nanMode, scale, bias } = value as unknown as BoostingModel); rawTrees = value.trees;
  } else {
    const info = value.features_info;
    if (!object(info) || !Array.isArray(info.float_features) || info.float_features.length !== features.length
      || info.categorical_features !== undefined && (!Array.isArray(info.categorical_features) || info.categorical_features.length !== 0)
      || info.ctrs !== undefined && (!Array.isArray(info.ctrs) || info.ctrs.length !== 0)
      || !Array.isArray(value.scale_and_bias) || value.scale_and_bias.length !== 2 || !Array.isArray(value.oblivious_trees)) fail();
    const scalar = (v: unknown): number => { const number = Array.isArray(v) && v.length === 1 ? v[0] : v; return finite(number) ? number : fail(); };
    scale = scalar(value.scale_and_bias[0]); bias = scalar(value.scale_and_bias[1]); rawTrees = value.oblivious_trees;
    if (object(value.model_info) && object(value.model_info.params)) {
      const params = value.model_info.params;
      const data = object(params.data_processing_options) ? params.data_processing_options : {};
      const bin = object(data.float_features_binarization) ? data.float_features_binarization : {};
      const declared = object(params.flat_params) ? params.flat_params.nan_mode ?? bin.nan_mode : bin.nan_mode;
      if (declared !== undefined && declared !== "Min" && declared !== "Max") fail();
      nanMode = declared === "Max" ? "max" : "min";
    }
  }
  if (!rawTrees.length || rawTrees.length > 300) fail();
  const trees: BoostingModel["trees"][number][] = [];
  for (const tree of rawTrees) {
    if (!object(tree)) fail();
    const rawSplits = tree.splits === null && !stored ? [] : tree.splits;
    const leaves = stored ? tree.leafValues : tree.leaf_values;
    if (!Array.isArray(rawSplits) || rawSplits.length > 3 || !Array.isArray(leaves)
      || leaves.length !== 2 ** rawSplits.length || leaves.some(value => !finite(value))) fail();
    const splits: { feature: string; border: number }[] = [];
    for (const split of rawSplits) {
      if (!object(split) || !finite(split.border, 3.4028234663852886e38)) fail();
      if (stored) {
        if (typeof split.feature !== "string" || !features.includes(split.feature)) fail();
        splits.push({ feature: split.feature, border: split.border });
      } else {
        if (split.split_type !== "FloatFeature" || !Number.isInteger(split.float_feature_index)) fail();
        const feature = features[split.float_feature_index as number];
        if (!feature) fail();
        splits.push({ feature, border: split.border });
      }
    }
    trees.push({ splits, leafValues: [...leaves] as number[] });
  }
  return { nanMode, scale, bias, trees };
}
async function ensembleOf(value: unknown, dataset: DecisionPolicyDataset, digest: Digest, stored: boolean): Promise<DecisionPolicyEnsemble> {
  if (!object(value)) fail();
  const framework = frameworkOf(value.framework, dataset), model = modelOf(value.model, dataset.features, stored);
  const body = { method: "catboost-probability-v1" as const, framework, model };
  const result = { ...body, modelSha256: await digest(decisionPolicyCanonical(body)) };
  if (!hash(result.modelSha256) || stored && decisionPolicyCanonical(result) !== decisionPolicyCanonical(value)) fail();
  return result;
}
async function derive(sourceValue: unknown, target: DecisionPolicyTarget, digest: Digest,
  ensemble: unknown, train?: (dataset: DecisionPolicyTrainingDataset) => Promise<unknown>): Promise<DecisionPolicyFitArtifact> {
  if (!DECISION_POLICY_TARGETS.includes(target)) fail();
  const { artifact: source, datasets } = await verifyDecisionPolicySourceArtifact(sourceValue, digest);
  const dataset = datasets[target];
  if (dataset.rows.length > MAX_DECISION_POLICY_FIT_ROWS) fail();
  const soft = dataset.labelKind === "judgement-probability";
  const tree = soft ? softTree(dataset.rows) : fitDecisionTree(dataset.rows.map(row => ({ features: row.features, label: row.label === 1, heldOut: row.split === "validation" })),
    { maxDepth: 3, minimumSamplesPerLeaf: 8 });
  const shallow: DecisionPolicyFitArtifact["shallow"] = { method: soft ? "cart-soft-squared-error-v1" : "cart-gini-v1", tree,
    ...evaluate(dataset, row => predictTree(tree, row.features)) };
  if (ensemble && shallow.status !== "validated") fail();
  const training = trainerDataset(dataset);
  if (train && shallow.status === "validated") {
    const raw = await train(structuredClone(training));
    ensemble = await ensembleOf(raw, dataset, digest, false);
  }
  let boosting: DecisionPolicyFitArtifact["boosting"] = null;
  if (ensemble) {
    const verified = await ensembleOf(ensemble, dataset, digest, true);
    boosting = { artifact: verified, evaluation: evaluate(dataset, row => predictBoostingProbability(verified.model, row.features)) };
  }
  const selected = shallow.status !== "validated" ? null : boosting?.evaluation.status === "validated"
    && boosting.evaluation.metrics.candidateLoss! < shallow.metrics.candidateLoss! - 1e-12 ? "boosting" : "shallow-tree";
  const body: Omit<DecisionPolicyFitArtifact, "fitSha256"> = { schemaVersion: 1 as const, method: DECISION_POLICY_FIT_METHOD, target, domain: dataset.domain, featureSchema: dataset.featureSchema,
    policy: { ...DECISION_POLICY_FIT_POLICY }, source, dataset, shallow, boosting, selected,
    status: selected ? "validated" as const : shallow.status };
  const fitSha256 = await digest(decisionPolicyCanonical(body));
  if (!hash(fitSha256)) fail();
  const result = { ...body, fitSha256 };
  serializeDecisionPolicyFit(result);
  return result;
}
/** Never silently invokes a trainer; callers may explicitly provide the pinned offline trainer. */
export async function fitDecisionPolicy(source: unknown, target: DecisionPolicyTarget, digest: Digest,
  options: { train?: (dataset: DecisionPolicyTrainingDataset) => Promise<unknown> } = {}): Promise<DecisionPolicyFitArtifact> {
  try { return await derive(source, target, digest, null, options.train); } catch { return fail(); }
}
export function serializeDecisionPolicyFit(artifact: DecisionPolicyFitArtifact): string {
  const contents = decisionPolicyCanonical(artifact) + "\n";
  if (contents.length > MAX_DECISION_POLICY_FIT_BYTES || new TextEncoder().encode(contents).byteLength > MAX_DECISION_POLICY_FIT_BYTES) fail();
  return contents;
}
const verifiedPolicies = new WeakSet<object>();
export interface VerifiedDecisionPolicy {
  readonly artifact: DecisionPolicyFitArtifact; readonly sha256: string;
  predict(features: Readonly<Record<string, number>>): number | null;
}
export function isVerifiedDecisionPolicy(value: unknown): value is VerifiedDecisionPolicy {
  return !!value && typeof value === "object" && verifiedPolicies.has(value);
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function validFeatures(artifact: DecisionPolicyFitArtifact, features: Readonly<Record<string, number>>): boolean {
  if (!object(features) || Object.keys(features).length === 0) return false;
  if (Object.entries(features).some(([key, value]) => !artifact.dataset.features.includes(key) || typeof value !== "number"
    || !Number.isFinite(value) || value < 0 || value > 1e9
    || ["objectiveMean", "objectiveLast", "recallRate", "lapseRate", "lastRating"].includes(key) && value > 1
    || ["objectiveCount", "priorReviewCount", "dueCount", "overdueCount", "knownCardCount"].includes(key) && !Number.isSafeInteger(value))) return false;
  if (artifact.dataset.features.some(key => !Object.hasOwn(features, key)
    && !(artifact.target === "retention" && ["objectiveCount", "objectiveMean"].includes(key)))) return false;
  return artifact.target !== "retention" || Object.hasOwn(features, "objectiveCount") === Object.hasOwn(features, "objectiveMean");
}
/** Exact file pin, source reconstruction, model walk, all metrics and selection are checked on every import. */
export async function verifyDecisionPolicyText(contents: string, expectedSha256: string, digest: Digest): Promise<VerifiedDecisionPolicy> {
  try {
    if (typeof contents !== "string" || !contents || contents.length > MAX_DECISION_POLICY_FIT_BYTES
      || new TextEncoder().encode(contents).byteLength > MAX_DECISION_POLICY_FIT_BYTES || !hash(expectedSha256)) fail();
    const sha256 = await digest(contents);
    if (sha256 !== expectedSha256) fail();
    const value: unknown = JSON.parse(contents);
    if (!object(value) || !DECISION_POLICY_TARGETS.includes(value.target as DecisionPolicyTarget)) fail();
    const ensemble = object(value.boosting) ? value.boosting.artifact : null;
    const artifact = freeze(await derive(value.source, value.target as DecisionPolicyTarget, digest, ensemble));
    if (decisionPolicyCanonical(value) !== decisionPolicyCanonical(artifact)) fail();
    const policy: VerifiedDecisionPolicy = Object.freeze({ artifact, sha256,
      predict(features: Readonly<Record<string, number>>) {
        if (!artifact.selected || !validFeatures(artifact, features)) return null;
        return artifact.selected === "shallow-tree" ? predictTree(artifact.shallow.tree, features)
          : predictBoostingProbability(artifact.boosting!.artifact.model, features);
      } });
    verifiedPolicies.add(policy);
    return policy;
  } catch { return fail(); }
}

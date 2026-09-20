/**
 * Portable boosting artifact: validation, exact evaluation and pinned evidence.
 *
 * CatBoost trains the ensemble; this module is what makes the result usable and
 * checkable. It normalizes the exported model, walks the trees with the same
 * arithmetic CatBoost uses, and derives every reported number from the stored
 * rows instead of trusting the trainer's summary. Thresholds and models are
 * never shared across backends, so the fitted identity is one digest over the
 * exact dataset, the fit policy and the model.
 *
 * The ensemble is a held-out-scored candidate, never an observation. A caller
 * may reorder work with a validated model; only a real run promotes anything.
 */
import type { TrainingRow } from "./boosting.js";

export const MAX_BOOSTING_BYTES = 5 * 1024 * 1024;
export const MAX_BOOSTING_OBSERVATIONS = 20_000;
const INVALID = "Invalid boosting artifact";
const BOOSTING_METHOD = "catboost-oblivious-logloss-v1" as const;
const MAX_FEATURES = 512;
const MAX_TREES = 4_000;
const MAX_TREE_DEPTH = 12;
const RELIABILITY_BINS = 10;
const MIN_FEATURE_LENGTH = 1;
/** CatBoost emits -FLT_MAX (or FLT_MAX) as the split border that isolates NaNs. */
const MAX_FLOAT32 = 3.4028234663852886e38;

export type BoostingNanMode = "min" | "max";
export type BoostingSplit = "fit" | "validation";
export type BoostingStatus = "validated" | "insufficient" | "failed-validation";

export interface BoostingObservation {
  readonly rowId: string;
  readonly groupId: string;
  readonly split: BoostingSplit;
  readonly label: 0 | 1;
  /** A missing feature is absent, not zero. The model receives it as NaN. */
  readonly features: Readonly<Record<string, number>>;
  /**
   * The incumbent's number for this row when one exists. It is never a model
   * input; it exists so a fitted model can be scored against the constants it
   * would replace on exactly the same rows.
   */
  readonly baseline?: number | null;
}

export interface BoostingPolicy {
  readonly minFitRows: number;
  readonly minFitGroups: number;
  readonly minValidationRows: number;
  readonly minValidationGroups: number;
  readonly maxValidationEce: number;
  readonly maxTreeDepth: number;
}

export interface BoostingFramework {
  readonly name: "catboost";
  readonly version: string;
  readonly parameters: Readonly<Record<string, string | number | boolean>>;
}

export interface BoostingTree {
  readonly splits: readonly { readonly feature: string; readonly border: number }[];
  readonly leafValues: readonly number[];
}

export interface BoostingModel {
  readonly nanMode: BoostingNanMode;
  readonly scale: number;
  readonly bias: number;
  readonly trees: readonly BoostingTree[];
}

export interface BoostingDatasetSummary {
  readonly rowCount: number;
  readonly groupCount: number;
  readonly fitRows: number;
  readonly fitGroups: number;
  readonly validationRows: number;
  readonly validationGroups: number;
  readonly positives: number;
}

export interface BoostingReliabilityBin {
  readonly lower: number;
  readonly upper: number;
  readonly count: number;
  readonly meanProbability: number | null;
  readonly observedFrequency: number | null;
}

export interface BoostingMetrics {
  readonly validationRows: number;
  readonly validationGroups: number;
  readonly brier: number;
  readonly logLoss: number;
  readonly ece: number;
  readonly auc: number | null;
  readonly baselineBrier: number | null;
  readonly beatsBaseline: boolean | null;
}

/** What a fitter is allowed to receive: policy, feature order and labelled rows. */
export interface BoostingDataset {
  readonly schemaVersion: 1;
  readonly policy: BoostingPolicy;
  readonly features: readonly string[];
  readonly observations: readonly BoostingObservation[];
}

export interface BoostingInput extends BoostingDataset {
  readonly framework: BoostingFramework;
  readonly dataset: BoostingDatasetSummary;
}

export interface BoostingArtifact {
  readonly schemaVersion: 1;
  readonly method: typeof BOOSTING_METHOD;
  readonly boostingSha256: string;
  readonly status: BoostingStatus;
  readonly input: BoostingInput;
  readonly model: BoostingModel;
  readonly metrics: BoostingMetrics;
  readonly reliability: readonly BoostingReliabilityBin[];
}

interface Derived {
  readonly input: BoostingInput;
  readonly model: BoostingModel;
  readonly metrics: BoostingMetrics;
  readonly reliability: readonly BoostingReliabilityBin[];
  readonly status: BoostingStatus;
}

const DEFAULT_POLICY: BoostingPolicy = {
  minFitRows: 40,
  minFitGroups: 8,
  minValidationRows: 20,
  minValidationGroups: 6,
  maxValidationEce: 0.15,
  maxTreeDepth: 6,
};

function fail(): never { throw new Error(INVALID); }
function stableJson(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
    : item !== null && typeof item === "object" ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, canonical(child)])) : item;
  return JSON.stringify(canonical(value));
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function keys(value: Record<string, unknown>, expected: readonly string[]): void {
  if (Object.keys(value).sort().join("|") !== [...expected].sort().join("|")) fail();
}
function text(value: unknown, max = 128): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
}
function finite(value: unknown, magnitude = 1e9): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= magnitude;
}
function probability(value: unknown): value is number { return finite(value, 1) && value >= 0 && value <= 1; }
function count(value: unknown, max: number): value is number { return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max; }

function validatePolicy(value: unknown): BoostingPolicy {
  if (!object(value)) fail();
  keys(value, ["minFitRows", "minFitGroups", "minValidationRows", "minValidationGroups", "maxValidationEce", "maxTreeDepth"]);
  if (!count(value.minFitRows, MAX_BOOSTING_OBSERVATIONS) || !count(value.minFitGroups, MAX_BOOSTING_OBSERVATIONS)
    || !count(value.minValidationRows, MAX_BOOSTING_OBSERVATIONS) || !count(value.minValidationGroups, MAX_BOOSTING_OBSERVATIONS)
    || !probability(value.maxValidationEce) || !Number.isInteger(value.maxTreeDepth)
    || (value.maxTreeDepth as number) < 1 || (value.maxTreeDepth as number) > MAX_TREE_DEPTH) fail();
  return { minFitRows: value.minFitRows, minFitGroups: value.minFitGroups, minValidationRows: value.minValidationRows,
    minValidationGroups: value.minValidationGroups, maxValidationEce: value.maxValidationEce, maxTreeDepth: value.maxTreeDepth } as BoostingPolicy;
}

function validateFeatures(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < MIN_FEATURE_LENGTH || value.length > MAX_FEATURES) fail();
  const names = value.map((name) => text(name, 64) ? name : fail());
  if (new Set(names).size !== names.length) fail();
  return names;
}

function validateFramework(value: unknown): BoostingFramework {
  if (!object(value)) fail();
  keys(value, ["name", "version", "parameters"]);
  if (value.name !== "catboost" || !text(value.version, 32) || !object(value.parameters)) fail();
  if (Object.keys(value.parameters).length > 64) fail();
  for (const [key, parameter] of Object.entries(value.parameters)) {
    if (!text(key, 64)) fail();
    if (!finite(parameter) && typeof parameter !== "string" && typeof parameter !== "boolean") fail();
    if (typeof parameter === "string" && parameter.length > 200) fail();
  }
  return { name: "catboost", version: value.version, parameters: { ...value.parameters } } as BoostingFramework;
}

function validateObservations(value: unknown, features: readonly string[]): BoostingObservation[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BOOSTING_OBSERVATIONS) fail();
  const declared = new Set(features);
  const ids = new Set<string>();
  const splits = new Map<string, BoostingSplit>();
  const observations: BoostingObservation[] = [];
  for (const row of value) {
    if (!object(row)) fail();
    keys(row, row.baseline === undefined ? ["rowId", "groupId", "split", "label", "features"] : ["rowId", "groupId", "split", "label", "features", "baseline"]);
    if (!text(row.rowId) || !text(row.groupId) || (row.split !== "fit" && row.split !== "validation") || (row.label !== 0 && row.label !== 1) || !object(row.features)) fail();
    if (ids.has(row.rowId)) fail();
    if (splits.has(row.groupId) && splits.get(row.groupId) !== row.split) fail();
    if (row.baseline !== undefined && row.baseline !== null && !probability(row.baseline)) fail();
    const entries = Object.entries(row.features);
    if (entries.length === 0) fail();
    for (const [name, featureValue] of entries) if (!declared.has(name) || !finite(featureValue)) fail();
    ids.add(row.rowId);
    splits.set(row.groupId, row.split);
    observations.push({ rowId: row.rowId, groupId: row.groupId, split: row.split, label: row.label,
      features: { ...row.features } as Record<string, number>, ...(row.baseline === undefined ? {} : { baseline: row.baseline }) });
  }
  return observations;
}

function rawFloatFeatureCount(featuresInfo: Record<string, unknown>): number {
  if (featuresInfo.categorical_features !== undefined) {
    if (!Array.isArray(featuresInfo.categorical_features)) fail();
    if (featuresInfo.categorical_features.length !== 0) fail();
  }
  if (featuresInfo.ctrs !== undefined && Array.isArray(featuresInfo.ctrs) && featuresInfo.ctrs.length !== 0) fail();
  if (!Array.isArray(featuresInfo.float_features)) fail();
  return featuresInfo.float_features.length;
}

function normalizeModel(value: unknown, features: readonly string[], maxTreeDepth: number): BoostingModel {
  if (!object(value) || !object(value.features_info) || !Array.isArray(value.oblivious_trees) || !Array.isArray(value.scale_and_bias)) fail();
  if (rawFloatFeatureCount(value.features_info) !== features.length) fail();
  if (value.oblivious_trees.length === 0 || value.oblivious_trees.length > MAX_TREES) fail();
  if (value.scale_and_bias.length !== 2) fail();
  const { scale, bias } = readScaleAndBias(value.scale_and_bias);
  // CatBoost applies the loss-specific transform after scale and bias; Logloss is a sigmoid.
  const nanMode = readNanMode(value.model_info);
  const trees: BoostingTree[] = [];
  for (const tree of value.oblivious_trees) {
    if (!object(tree) || !Array.isArray(tree.splits) || !Array.isArray(tree.leaf_values)) fail();
    if (tree.leaf_values.length !== 2 ** tree.splits.length || tree.splits.length === 0 || tree.splits.length > maxTreeDepth) fail();
    const splits: { feature: string; border: number }[] = [];
    for (const split of tree.splits) {
      if (!object(split) || split.split_type !== "FloatFeature" || !Number.isInteger(split.float_feature_index) || !finite(split.border, MAX_FLOAT32)) fail();
      const index = split.float_feature_index as number;
      if (index < 0 || index >= features.length) fail();
      splits.push({ feature: features[index]!, border: split.border as number });
    }
    const leafValues = tree.leaf_values.map((leaf) => finite(leaf, 1e6) ? leaf : fail());
    trees.push({ splits, leafValues });
  }
  return { nanMode, scale, bias, trees };
}

/** CatBoost exports `[scale, [bias]]`; both entries are accepted bare or wrapped. */
function readScaleAndBias(value: unknown[]): { scale: number; bias: number } {
  const single = (entry: unknown): number => Array.isArray(entry)
    ? (entry.length === 1 && finite(entry[0], 1e6) ? entry[0] as number : fail())
    : (finite(entry, 1e6) ? entry : fail());
  return { scale: single(value[0]), bias: single(value[1]) };
}

function readNanMode(modelInfo: unknown): BoostingNanMode {
  if (!object(modelInfo) || !object(modelInfo.params)) return "min";
  const params = modelInfo.params;
  const binarization = object(params.data_processing_options) && object(params.data_processing_options.float_features_binarization)
    ? params.data_processing_options.float_features_binarization : {};
  const declared = (object(params.flat_params) ? params.flat_params.nan_mode : undefined) ?? binarization.nan_mode;
  if (declared === undefined) return "min";
  if (declared === "Min" || declared === "min") return "min";
  if (declared === "Max" || declared === "max") return "max";
  return fail();
}

function validateStoredModel(value: unknown, features: readonly string[], maxTreeDepth: number): BoostingModel {
  if (!object(value)) fail();
  keys(value, ["nanMode", "scale", "bias", "trees"]);
  if (value.nanMode !== "min" && value.nanMode !== "max") fail();
  if (!finite(value.scale, 1e6) || !finite(value.bias, 1e6) || !Array.isArray(value.trees) || value.trees.length === 0 || value.trees.length > MAX_TREES) fail();
  const trees: BoostingTree[] = [];
  for (const tree of value.trees) {
    if (!object(tree)) fail();
    keys(tree, ["splits", "leafValues"]);
    if (!Array.isArray(tree.splits) || !Array.isArray(tree.leafValues)) fail();
    if (tree.splits.length === 0 || tree.splits.length > maxTreeDepth || tree.leafValues.length !== 2 ** tree.splits.length) fail();
    const splits: { feature: string; border: number }[] = [];
    for (const split of tree.splits) {
      if (!object(split)) fail();
      keys(split, ["feature", "border"]);
      if (!text(split.feature, 64) || !features.includes(split.feature) || !finite(split.border, MAX_FLOAT32)) fail();
      splits.push({ feature: split.feature, border: split.border as number });
    }
    const leafValues = tree.leafValues.map((leaf) => finite(leaf, 1e6) ? leaf : fail());
    trees.push({ splits, leafValues });
  }
  return { nanMode: value.nanMode, scale: value.scale, bias: value.bias, trees };
}

/**
 * CatBoost passes NaN to the left child under its default Min mode.
 *
 * Binarization compares float32 values, so the comparison is rounded to float32
 * on both sides. Comparing in float64 picks the wrong child for a value that
 * sits exactly on a border, which is a real and reproducible disagreement.
 */
function goesRight(value: number, border: number, nanMode: BoostingNanMode): boolean {
  return Number.isFinite(value) ? Math.fround(value) > Math.fround(border) : nanMode === "max";
}

export function predictBoostingLogit(model: BoostingModel, features: Readonly<Record<string, number>>): number {
  let total = 0;
  for (const tree of model.trees) {
    let index = 0;
    for (let depth = 0; depth < tree.splits.length; depth += 1) {
      const split = tree.splits[depth]!;
      const value = features[split.feature];
      if (goesRight(typeof value === "number" ? value : Number.NaN, split.border, model.nanMode)) index |= 1 << depth;
    }
    total += tree.leafValues[index]!;
  }
  return model.scale * total + model.bias;
}

export function predictBoostingProbability(model: BoostingModel, features: Readonly<Record<string, number>>): number {
  const logit = predictBoostingLogit(model, features);
  if (logit >= 0) return 1 / (1 + Math.exp(-logit));
  const exponent = Math.exp(logit);
  return exponent / (1 + exponent);
}

/** Fitted rows for the shared held-out comparison in `boosting.ts`. */
export function boostingTrainingRows(artifact: BoostingArtifact): TrainingRow[] {
  return artifact.input.observations.map((row) => ({ features: { ...row.features }, label: row.label === 1, heldOut: row.split === "validation" }));
}

function summarize(observations: readonly BoostingObservation[]): BoostingDatasetSummary {
  const fit = observations.filter((row) => row.split === "fit");
  const validation = observations.filter((row) => row.split === "validation");
  return { rowCount: observations.length, groupCount: new Set(observations.map((row) => row.groupId)).size,
    fitRows: fit.length, fitGroups: new Set(fit.map((row) => row.groupId)).size,
    validationRows: validation.length, validationGroups: new Set(validation.map((row) => row.groupId)).size,
    positives: observations.filter((row) => row.label === 1).length };
}

function reliability(validation: readonly { probability: number; label: 0 | 1 }[]): BoostingReliabilityBin[] {
  return Array.from({ length: RELIABILITY_BINS }, (_, index): BoostingReliabilityBin => {
    const found = validation.filter((row) => Math.min(RELIABILITY_BINS - 1, Math.floor(row.probability * RELIABILITY_BINS)) === index);
    return { lower: index / RELIABILITY_BINS, upper: (index + 1) / RELIABILITY_BINS, count: found.length,
      meanProbability: found.length ? found.reduce((sum, row) => sum + row.probability, 0) / found.length : null,
      observedFrequency: found.length ? found.reduce((sum, row) => sum + row.label, 0) / found.length : null };
  });
}

function auc(rows: readonly { probability: number; label: 0 | 1 }[]): number | null {
  const positives = rows.filter((row) => row.label === 1).length;
  const negatives = rows.length - positives;
  if (positives === 0 || negatives === 0) return null;
  const ranked = [...rows].sort((left, right) => left.probability - right.probability);
  let positiveRankSum = 0;
  let index = 0;
  while (index < ranked.length) {
    let end = index;
    while (end + 1 < ranked.length && ranked[end + 1]!.probability === ranked[index]!.probability) end += 1;
    const averageRank = (index + end) / 2 + 1;
    for (let position = index; position <= end; position += 1) if (ranked[position]!.label === 1) positiveRankSum += averageRank;
    index = end + 1;
  }
  return (positiveRankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

function score(validation: readonly { probability: number; label: 0 | 1; baseline: number | null }[], dataset: BoostingDatasetSummary): { metrics: BoostingMetrics; reliability: readonly BoostingReliabilityBin[] } {
  if (validation.length === 0) fail();
  const clamp = (value: number): number => Math.min(1 - 1e-12, Math.max(1e-12, value));
  const brier = validation.reduce((sum, row) => sum + (row.probability - row.label) ** 2, 0) / validation.length;
  const logLoss = -validation.reduce((sum, row) => sum + (row.label === 1 ? Math.log(clamp(row.probability)) : Math.log(clamp(1 - row.probability))), 0) / validation.length;
  const bins = reliability(validation);
  const ece = bins.reduce((sum, bin) => sum + bin.count * Math.abs((bin.meanProbability ?? 0) - (bin.observedFrequency ?? 0)), 0) / validation.length;
  const withBaseline = validation.filter((row) => row.baseline !== null);
  const baselineBrier = withBaseline.length === validation.length
    ? validation.reduce((sum, row) => sum + (row.baseline! - row.label) ** 2, 0) / validation.length : null;
  return { metrics: { validationRows: validation.length, validationGroups: dataset.validationGroups, brier, logLoss, ece, auc: auc(validation),
      baselineBrier, beatsBaseline: baselineBrier === null ? null : brier < baselineBrier }, reliability: bins };
}

function statusOf(policy: BoostingPolicy, dataset: BoostingDatasetSummary, metrics: BoostingMetrics): BoostingStatus {
  if (dataset.fitRows < policy.minFitRows || dataset.fitGroups < policy.minFitGroups
    || dataset.validationRows < policy.minValidationRows || dataset.validationGroups < policy.minValidationGroups) return "insufficient";
  if (metrics.ece > policy.maxValidationEce) return "failed-validation";
  if (metrics.beatsBaseline === false) return "failed-validation";
  return "validated";
}

function derive(input: { policy: BoostingPolicy; features: readonly string[]; framework: BoostingFramework; observations: readonly BoostingObservation[] }, model: BoostingModel): Derived {
  const dataset = summarize(input.observations);
  const validation = input.observations.filter((row) => row.split === "validation").map((row) => ({
    probability: predictBoostingProbability(model, row.features), label: row.label, baseline: row.baseline ?? null }));
  const scored = score(validation, dataset);
  return { input: { schemaVersion: 1, policy: input.policy, features: [...input.features], framework: input.framework,
      observations: input.observations.map((row) => ({ ...row, features: { ...row.features } })), dataset },
    model, metrics: scored.metrics, reliability: scored.reliability, status: statusOf(input.policy, dataset, scored.metrics) };
}

function identityText(derived: Derived): string {
  return stableJson({ method: BOOSTING_METHOD, schemaVersion: 1, input: derived.input, model: derived.model });
}

function complete(derived: Derived) {
  const identityInput = identityText(derived);
  return { identityInput, complete(boostingSha256: string): BoostingArtifact {
    if (!/^[a-f0-9]{64}$/u.test(boostingSha256)) fail();
    return { schemaVersion: 1, method: BOOSTING_METHOD, boostingSha256, status: derived.status, input: derived.input,
      model: derived.model, metrics: derived.metrics, reliability: derived.reliability };
  } };
}

/** Validate labelled rows before any fitter sees them. */
export function validateBoostingDataset(value: unknown): BoostingDataset {
  if (!object(value)) fail();
  keys(value, ["schemaVersion", "policy", "features", "observations"]);
  if (value.schemaVersion !== 1) fail();
  const policy = validatePolicy(value.policy);
  const features = validateFeatures(value.features);
  const observations = validateObservations(value.observations, features);
  return { schemaVersion: 1, policy, features, observations };
}

/** Canonical dataset text for the trainer handoff and for dataset digests. */
export function serializeBoostingDataset(dataset: BoostingDataset): string { return stableJson(dataset) + "\n"; }

/**
 * Adopt a trainer's export, or refuse it.
 *
 * The raw CatBoost JSON is accepted here and nowhere else. Every number in the
 * returned artifact is recomputed from the stored rows, so a trainer cannot
 * report a friendlier score than the model earns on the held-out groups.
 */
export function prepareBoostingArtifact(value: unknown): { identityInput: string; complete: (boostingSha256: string) => BoostingArtifact } {
  if (!object(value)) fail();
  keys(value, ["schemaVersion", "policy", "features", "framework", "observations", "model"]);
  const dataset = validateBoostingDataset({ schemaVersion: value.schemaVersion, policy: value.policy, features: value.features, observations: value.observations });
  const framework = validateFramework(value.framework);
  const model = normalizeModel(value.model, dataset.features, dataset.policy.maxTreeDepth);
  return complete(derive({ ...dataset, framework }, model));
}

/**
 * Re-derive a stored artifact from its own inputs.
 *
 * Metrics, reliability, the dataset summary and the status are recomputed, so a
 * loader that rebuilds and compares accepts only self-consistent evidence.
 */
export function validateBoostingArtifact(value: unknown): { identityInput: string; complete: (boostingSha256: string) => BoostingArtifact } {
  if (!object(value)) fail();
  keys(value, ["schemaVersion", "method", "boostingSha256", "status", "input", "model", "metrics", "reliability"]);
  if (value.schemaVersion !== 1 || value.method !== BOOSTING_METHOD || !/^[a-f0-9]{64}$/u.test(String(value.boostingSha256)) || !object(value.input)) fail();
  keys(value.input, ["schemaVersion", "policy", "features", "framework", "observations", "dataset"]);
  if (value.input.schemaVersion !== 1) fail();
  const policy = validatePolicy(value.input.policy);
  const features = validateFeatures(value.input.features);
  const framework = validateFramework(value.input.framework);
  const observations = validateObservations(value.input.observations, features);
  const model = validateStoredModel(value.model, features, policy.maxTreeDepth);
  if (!object(value.metrics) || !Array.isArray(value.reliability) || !["validated", "insufficient", "failed-validation"].includes(String(value.status))) fail();
  return complete(derive({ policy, features, framework, observations }, model));
}

export function serializeBoostingArtifact(artifact: BoostingArtifact): string { return stableJson(artifact) + "\n"; }

/** Verify exact UTF-8 text bytes and rebuild all evidence before exposing a model. */
export async function verifyBoostingText(
  contents: string, expectedSha256: string, digest: (text: string) => Promise<string>,
): Promise<{ artifact: BoostingArtifact; sha256: string }> {
  try {
    if (typeof contents !== "string" || contents.length === 0 || contents.length > MAX_BOOSTING_BYTES
      || new TextEncoder().encode(contents).byteLength > MAX_BOOSTING_BYTES || !/^[a-f0-9]{64}$/u.test(expectedSha256)) fail();
    const sha256 = await digest(contents);
    if (sha256 !== expectedSha256) fail();
    const value: unknown = JSON.parse(contents);
    if (!object(value)) fail();
    const prepared = validateBoostingArtifact(value);
    const artifact = prepared.complete(await digest(prepared.identityInput));
    if (stableJson(value) !== stableJson(artifact)) fail();
    return { artifact, sha256 };
  } catch { fail(); }
}

export const DEFAULT_BOOSTING_POLICY = DEFAULT_POLICY;
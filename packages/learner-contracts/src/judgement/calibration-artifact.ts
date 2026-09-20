/** Portable fitting and exact artifact verification; no network, storage or Node dependencies. */
import { judgementRequestProblem, questionDigest, type JudgementBackendKey, type JudgementQuestion } from "./contracts.js";
import { thresholdKey, type CalibrationTable } from "./projections.js";

export const MAX_CALIBRATION_BYTES = 5 * 1024 * 1024;
const INVALID = "Invalid judgement calibration artifact";
const CALIBRATION_METHOD = "wilson-95-upper-frozen-threshold-v1" as const;
type MetricKind = "noul-probability" | "choice-confidence" | "score-confidence";
export interface CalibrationObservation {
  observationId: string; sourceId: string; groupId: string;
  split: "fit" | "validation"; evidence: "observed";
  backend: JudgementBackendKey; question: JudgementQuestion; metricKind: MetricKind;
  /** Noul: P(yes) and observed yes/no. Choice/Score: confidence and independently observed selected-answer correctness. */
  value: number; label: 0 | 1;
}
export interface CalibrationInput {
  schemaVersion: 1;
  policy: { maxFalsePositiveRate: number; maxActionErrorRate: number; minSamples: number; minActions: number; minNegatives: number };
  observations: CalibrationObservation[];
}
interface ReliabilityBin { lower: number; upper: number; count: number; meanProbability: number | null; observedFrequency: number | null }
interface ThresholdEvidence { samples: number; actions: number; errors: number; negatives: number; falsePositives: number; actionErrorUpper: number; falsePositiveUpper: number }
interface GroupResult {
  key: string; backend: JudgementBackendKey; sourceBackend: JudgementBackendKey; questionDigest: string; metricKind: MetricKind;
  threshold: number | null; status: "validated" | "insufficient-fit" | "failed-validation";
  fit: ThresholdEvidence | null; validation: ThresholdEvidence | null;
  reliability: { brier: number; ece: number; bins: ReliabilityBin[] } | null;
}
export interface JudgementCalibrationArtifact { schemaVersion: 1; method: "wilson-95-upper-frozen-threshold-v1"; calibrationSha256: string; input: CalibrationInput; groups: GroupResult[]; table: CalibrationTable }

function fail(): never { throw new Error(INVALID); }
function stableJson(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
    : item !== null && typeof item === "object" ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, canonical(child)])) : item;
  return JSON.stringify(canonical(value));
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function keys(value: Record<string, unknown>, expected: string[]) { if (Object.keys(value).sort().join("|") !== expected.sort().join("|")) fail(); }
function text(value: unknown, max = 256, multiline = false): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max
    && !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u : /[\u0000-\u001f]/u).test(value);
}
function probability(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1; }
function validateInput(value: unknown): CalibrationInput {
  if (!object(value)) fail();
  keys(value, ["schemaVersion", "policy", "observations"]);
  if (value.schemaVersion !== 1 || !object(value.policy) || !Array.isArray(value.observations) || value.observations.length > 10_000) fail();
  keys(value.policy, ["maxFalsePositiveRate", "maxActionErrorRate", "minSamples", "minActions", "minNegatives"]);
  for (const name of ["maxFalsePositiveRate", "maxActionErrorRate"]) if (!probability(value.policy[name]) || value.policy[name] > 0.5) fail();
  for (const name of ["minSamples", "minActions", "minNegatives"]) if (!Number.isInteger(value.policy[name]) || (value.policy[name] as number) < 20 || (value.policy[name] as number) > 10_000) fail();
  const ids = new Set<string>(), sources = new Set<string>(), splits = new Map<string, string>();
  const metricKeys = new Map<string, string>(), independentUnits = new Set<string>();
  const sourceCalibrations = new Map<string, string | null>();
  for (const row of value.observations) {
    if (!object(row)) fail();
    keys(row, ["observationId", "sourceId", "groupId", "split", "evidence", "backend", "question", "metricKind", "value", "label"]);
    if (!text(row.observationId) || !text(row.sourceId) || !text(row.groupId) || !["fit", "validation"].includes(String(row.split)) || row.evidence !== "observed" || !probability(row.value) || (row.label !== 0 && row.label !== 1)) fail();
    if (ids.has(row.observationId) || sources.has(row.sourceId) || (splits.has(row.groupId) && splits.get(row.groupId) !== row.split)) fail();
    ids.add(row.observationId); sources.add(row.sourceId); splits.set(row.groupId, row.split as string);
    if (!object(row.backend)) fail();
    keys(row.backend, ["backend", "model", "calibrationSha256"]);
    if (!["local", "system-one"].includes(String(row.backend.backend)) || !text(row.backend.model) || /(?:latest|^judgement$)/iu.test(row.backend.model)
      || (row.backend.calibrationSha256 !== null && (typeof row.backend.calibrationSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(row.backend.calibrationSha256)))) fail();
    if (!object(row.question) || !text(row.question.instructions, 32_000, true)) fail();
    const q = row.question;
    if (q.type === "noul") {
      keys(q, q.criteria === undefined ? ["type", "instructions"] : ["type", "instructions", "criteria"]);
      if (q.criteria !== undefined) { if (!object(q.criteria)) fail(); keys(q.criteria, ["true", "false"]); if (!text(q.criteria.true, 16_000, true) || !text(q.criteria.false, 16_000, true)) fail(); }
    } else if (q.type === "choice") {
      keys(q, ["type", "instructions", "criteria"]);
      if (!object(q.criteria) || Object.entries(q.criteria).some(([key, v]) => !text(key) || (v !== null && !text(v, 16_000, true)))) fail();
    } else if (q.type === "score") {
      keys(q, ["type", "instructions", "criteria"]);
      if (!Array.isArray(q.criteria) || q.criteria.length > 255 || q.criteria.some(v => !text(v, 16_000, true)) || new Set(q.criteria).size !== q.criteria.length) fail();
    } else fail();
    const question = q as unknown as JudgementQuestion;
    if (judgementRequestProblem({ state: "", questions: { check: question } })) fail();
    const expectedKind = q.type === "noul" ? "noul-probability" : `${q.type}-confidence`;
    if (row.metricKind !== expectedKind) fail();
    const key = thresholdKey(row.backend as unknown as JudgementBackendKey, questionDigest(question));
    const sourceKey = JSON.stringify([row.backend.backend, row.backend.model, questionDigest(question)]);
    const sourceCalibration = row.backend.calibrationSha256 as string | null;
    if (sourceCalibrations.has(sourceKey) && sourceCalibrations.get(sourceKey) !== sourceCalibration) fail();
    sourceCalibrations.set(sourceKey, sourceCalibration);
    const independentUnit = JSON.stringify([key, row.groupId]);
    if (independentUnits.has(independentUnit)) fail();
    independentUnits.add(independentUnit);
    if (metricKeys.has(key) && metricKeys.get(key) !== row.metricKind) fail();
    metricKeys.set(key, row.metricKind);
  }
  // Copy inputs: caller mutation cannot alter a fitted artifact after validation.
  return JSON.parse(JSON.stringify(value)) as CalibrationInput;
}

function wilsonUpper(errors: number, n: number): number {
  if (!n) return 1;
  const z = 1.959963984540054, p = errors / n, zz = z * z;
  return (p + zz / (2 * n) + z * Math.sqrt(p * (1 - p) / n + zz / (4 * n * n))) / (1 + zz / n);
}
function evidence(rows: CalibrationObservation[], threshold: number): ThresholdEvidence {
  const actions = rows.filter(row => row.value >= threshold);
  const errors = actions.filter(row => row.label === 0).length;
  const negatives = rows.filter(row => row.label === 0).length;
  return { samples: rows.length, actions: actions.length, errors, negatives, falsePositives: errors,
    actionErrorUpper: wilsonUpper(errors, actions.length), falsePositiveUpper: wilsonUpper(errors, negatives) };
}
function passes(e: ThresholdEvidence, metric: MetricKind, policy: CalibrationInput["policy"]): boolean {
  return e.samples >= policy.minSamples && e.actions >= policy.minActions && e.actionErrorUpper <= policy.maxActionErrorRate
    && (metric !== "noul-probability" || (e.negatives >= policy.minNegatives && e.negatives < e.samples && e.falsePositiveUpper <= policy.maxFalsePositiveRate));
}
function reliability(rows: CalibrationObservation[]): GroupResult["reliability"] {
  if (!rows.length) return null;
  const bins = Array.from({ length: 10 }, (_, i): ReliabilityBin => {
    const found = rows.filter(row => Math.min(9, Math.floor(row.value * 10)) === i);
    return { lower: i / 10, upper: (i + 1) / 10, count: found.length,
      meanProbability: found.length ? found.reduce((sum, row) => sum + row.value, 0) / found.length : null,
      observedFrequency: found.length ? found.reduce((sum, row) => sum + row.label, 0) / found.length : null };
  });
  return { brier: rows.reduce((sum, row) => sum + (row.value - row.label) ** 2, 0) / rows.length,
    ece: bins.reduce((sum, bin) => sum + bin.count * Math.abs((bin.meanProbability ?? 0) - (bin.observedFrequency ?? 0)), 0) / rows.length, bins };
}
export function prepareJudgementCalibrationArtifact(value: unknown): { identityInput: string; complete: (calibrationSha256: string) => JudgementCalibrationArtifact } {
  const input = validateInput(value);
  // The newly fitted identity binds the exact observed dataset and fit policy.
  // Source rows retain their original identity, including null on first fit.
  const identityInput = stableJson({ method: CALIBRATION_METHOD, schemaVersion: 1, input });
  return { identityInput, complete(calibrationSha256) {
    if (!/^[a-f0-9]{64}$/u.test(calibrationSha256)) fail();
    const grouped = new Map<string, CalibrationObservation[]>();
    for (const row of input.observations) { const key = thresholdKey(row.backend, questionDigest(row.question)); const rows = grouped.get(key) ?? []; rows.push(row); grouped.set(key, rows); }
    const entries: Record<string, { deferBelow: number; actAtOrAbove: number }> = {};
    const groups = [...grouped.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, rows]): GroupResult => {
      const first = rows[0]!, fit = rows.filter(row => row.split === "fit"), heldout = rows.filter(row => row.split === "validation");
      const backend: JudgementBackendKey = { ...first.backend, calibrationSha256 };
      const key = thresholdKey(backend, questionDigest(first.question));
      // Lowest passing observed fit value maximizes eligible actions. Validation never participates in selection.
      const candidates = [...new Set(fit.map(row => row.value))].sort((a, b) => a - b);
      const threshold = candidates.find(value => passes(evidence(fit, value), first.metricKind, input.policy));
      const fitted = threshold === undefined ? null : evidence(fit, threshold);
      const validation = threshold === undefined ? null : evidence(heldout, threshold);
      const accepted = validation !== null && passes(validation, first.metricKind, input.policy);
      if (accepted) entries[key] = { deferBelow: threshold!, actAtOrAbove: threshold! };
      return { key, backend, sourceBackend: first.backend, questionDigest: questionDigest(first.question), metricKind: first.metricKind,
        threshold: threshold ?? null, status: threshold === undefined ? "insufficient-fit" : accepted ? "validated" : "failed-validation",
        fit: fitted, validation, reliability: first.metricKind === "noul-probability" ? reliability(heldout) : null };
    });
    return { schemaVersion: 1, method: CALIBRATION_METHOD, calibrationSha256, input: structuredClone(input), groups: structuredClone(groups), table: { entries } };
  } };
}
export function serializeJudgementCalibrationArtifact(artifact: JudgementCalibrationArtifact): string { return stableJson(artifact) + "\n"; }

/** Verify exact UTF-8 text bytes and rebuild all evidence before exposing thresholds.
 * The digest adapter is supplied by the platform, never by the imported artifact.
 */
export async function verifyJudgementCalibrationText(
  contents: string, expectedSha256: string, digest: (text: string) => Promise<string>,
): Promise<{ artifact: JudgementCalibrationArtifact; sha256: string }> {
  try {
    if (typeof contents !== "string" || contents.length === 0 || contents.length > MAX_CALIBRATION_BYTES
      || new TextEncoder().encode(contents).byteLength > MAX_CALIBRATION_BYTES || !/^[a-f0-9]{64}$/u.test(expectedSha256)) fail();
    const sha256 = await digest(contents);
    if (sha256 !== expectedSha256) fail();
    const value: unknown = JSON.parse(contents);
    if (!object(value)) fail();
    const prepared = prepareJudgementCalibrationArtifact(value.input);
    const artifact = prepared.complete(await digest(prepared.identityInput));
    if (stableJson(value) !== stableJson(artifact)) fail();
    return { artifact, sha256 };
  } catch { fail(); }
}

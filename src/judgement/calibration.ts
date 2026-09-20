/**
 * Assembling a calibration table for the CLI.
 *
 * Thresholds are filed per backend *and* per question, and this module never
 * invents one: it only turns measured values into the key shape
 * `resolveThresholds` looks up. A missing entry stays missing, which the router
 * reads as "skip this tier", not as "borrow whatever is closest".
 */
import {
  type JudgementBackendKey,
  type JudgementQuestion,
  questionDigest,
} from "../../packages/learner-contracts/src/judgement/contracts.js";
import {
  type CalibrationTable,
  type JudgementThresholds,
  thresholdKey,
} from "../../packages/learner-contracts/src/judgement/projections.js";

export const EMPTY_CALIBRATION: CalibrationTable = { entries: {} };

export interface CalibrationEntry {
  readonly backend: JudgementBackendKey;
  readonly question: JudgementQuestion;
  /** Fitted against this backend's own measured data; never ported from another. */
  readonly thresholds: JudgementThresholds;
}

/**
 * Later entries win, so a freshly fitted table can be layered over a shipped
 * default without mutating either.
 */
export function judgementCalibrationTable(
  entries: readonly CalibrationEntry[],
): CalibrationTable {
  const table: Record<string, JudgementThresholds> = {};
  for (const entry of entries) {
    table[thresholdKey(entry.backend, questionDigest(entry.question))] = entry.thresholds;
  }
  return { entries: table };
}

/** Merge in order; a later table overrides an earlier one key by key. */
export function mergeCalibrationTables(
  ...tables: readonly CalibrationTable[]
): CalibrationTable {
  return {
    entries: Object.assign({}, ...tables.map((table) => table.entries)) as Record<string, JudgementThresholds>,
  };
}

/**
 * True when this backend has a fitted entry for this exact question.
 *
 * Edit the instructions or the criteria and the digest changes — which is
 * exactly when the old thresholds stop applying, so this returns false.
 */
export function hasCalibration(
  table: CalibrationTable,
  backend: JudgementBackendKey,
  question: JudgementQuestion,
): boolean {
  if (backend.calibrationSha256 === null) return false;
  return Object.hasOwn(table.entries, thresholdKey(backend, questionDigest(question)));
}

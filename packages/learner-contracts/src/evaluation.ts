import { MergeConflictError } from "./envelope.js";
import {
  codePointCompare,
  compareContractTimestamps,
  hasOnlyKeys,
  isBoundedArray,
  isBoundedString,
  isContractId,
  isContractTimestamp,
} from "./validation.js";

/** Immutable evidence that a benchmark was actually run, not a projected learner score. */
export interface BenchmarkHistoryRecord {
  id: string;
  createdAt: string;
  score: number;
  report: string;
  trace?: string;
  /** Present only when the producing surface supplied the run topic. */
  topic?: string;
  /** Present only when the producing surface supplied an exported session link. */
  sessionId?: string;
  provenance: "benchmark-run";
}

/** Immutable evidence that a policy-evolution run was actually completed. */
export interface EvolutionHistoryRecord {
  id: string;
  createdAt: string;
  bestScore: number;
  policy: string;
  report: string;
  trace?: string;
  /** Present only when the producing surface supplied the run topic. */
  topic?: string;
  /** Present only when the producing surface supplied an exported session link. */
  sessionId?: string;
  provenance: "evolution-run";
}

const BENCHMARK_HISTORY_KEYS = new Set([
  "id", "createdAt", "score", "report", "trace", "topic", "sessionId", "provenance",
]);
const EVOLUTION_HISTORY_KEYS = new Set([
  "id", "createdAt", "bestScore", "policy", "report", "trace", "topic", "sessionId", "provenance",
]);
const MAX_HISTORY_TEXT_LENGTH = 1_048_576;
const MAX_TOPIC_LENGTH = 512;
const MAX_HISTORY_RECORDS = 10_000;

function isScore(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function hasRunMetadata(record: {
  id?: unknown;
  createdAt?: unknown;
  report?: unknown;
  trace?: unknown;
  topic?: unknown;
  sessionId?: unknown;
}): boolean {
  return isContractId(record.id)
    && isContractTimestamp(record.createdAt)
    && isBoundedString(record.report, MAX_HISTORY_TEXT_LENGTH)
    && (record.trace === undefined || isBoundedString(record.trace, MAX_HISTORY_TEXT_LENGTH))
    && (record.topic === undefined || isBoundedString(record.topic, MAX_TOPIC_LENGTH, false))
    && (record.sessionId === undefined || isContractId(record.sessionId));
}

export function validateBenchmarkHistoryRecord(value: unknown): value is BenchmarkHistoryRecord {
  if (!hasOnlyKeys(value, BENCHMARK_HISTORY_KEYS)) return false;
  const record = value as Partial<BenchmarkHistoryRecord>;
  return hasRunMetadata(record) && isScore(record.score) && record.provenance === "benchmark-run";
}

export function validateEvolutionHistoryRecord(value: unknown): value is EvolutionHistoryRecord {
  if (!hasOnlyKeys(value, EVOLUTION_HISTORY_KEYS)) return false;
  const record = value as Partial<EvolutionHistoryRecord>;
  return hasRunMetadata(record)
    && isScore(record.bestScore)
    && isBoundedString(record.policy, MAX_HISTORY_TEXT_LENGTH)
    && record.provenance === "evolution-run";
}

function stableJson(value: unknown): string {
  const sort = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(sort);
    if (!entry || typeof entry !== "object") return entry;
    return Object.fromEntries(Object.entries(entry as Record<string, unknown>)
      .sort((left, right) => codePointCompare(left[0], right[0]))
      .map(([key, child]) => [key, sort(child)]));
  };
  return JSON.stringify(sort(value));
}

function mergeImmutableHistory<T extends { id: string; createdAt: string }>(
  validator: (value: unknown) => value is T,
  ...lists: ReadonlyArray<ReadonlyArray<T>>
): T[] {
  const records = new Map<string, T>();
  for (const list of lists) {
    if (!isBoundedArray(list, MAX_HISTORY_RECORDS)) {
      throw new MergeConflictError("Cannot merge an oversized evaluation history.");
    }
    for (const candidate of list) {
      if (!validator(candidate)) throw new MergeConflictError("Cannot merge malformed evaluation history.");
      const current = records.get(candidate.id);
      if (current && stableJson(current) !== stableJson(candidate)) {
        throw new MergeConflictError(`Immutable evaluation history conflicts for ${candidate.id}.`);
      }
      if (!current) records.set(candidate.id, structuredClone(candidate));
    }
  }
  return [...records.values()].sort((left, right) =>
    compareContractTimestamps(left.createdAt, right.createdAt) || codePointCompare(left.id, right.id));
}

/** Run IDs are immutable: differing records with the same ID fail rather than silently replacing history. */
export function mergeBenchmarkHistory(...lists: ReadonlyArray<ReadonlyArray<BenchmarkHistoryRecord>>): BenchmarkHistoryRecord[] {
  return mergeImmutableHistory(validateBenchmarkHistoryRecord, ...lists);
}

/** Run IDs are immutable: differing records with the same ID fail rather than silently replacing history. */
export function mergeEvolutionHistory(...lists: ReadonlyArray<ReadonlyArray<EvolutionHistoryRecord>>): EvolutionHistoryRecord[] {
  return mergeImmutableHistory(validateEvolutionHistoryRecord, ...lists);
}

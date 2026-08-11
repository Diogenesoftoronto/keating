/** Dependency-free envelope used at every cross-surface persistence boundary. */
import { hasOnlyKeys, isRecord } from "./validation.js";

export interface VersionedEnvelope<T> {
  kind: string;
  schemaVersion: number;
  payload: T;
}

export const LEARNER_CONTRACT_VERSION = 3 as const;
export const LEGACY_LEARNER_CONTRACT_VERSION = 1 as const;
/** The immediately preceding portable-data schema, retained for lossless import. */
export const PREVIOUS_LEARNER_CONTRACT_VERSION = 2 as const;
export const PORTABLE_LEARNER_DATA_KIND = "keating-portable-learner-data" as const;
const ENVELOPE_KEYS = new Set(["kind", "schemaVersion", "payload"]);

export class ContractValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractValidationError";
  }
}

/** A merge cannot safely choose between two incompatible portable records. */
export class MergeConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MergeConflictError";
  }
}

export function assertVersionedEnvelope<T>(
  value: unknown,
  kind: string,
  schemaVersion: number,
): asserts value is VersionedEnvelope<T> {
  if (!isRecord(value)) {
    throw new ContractValidationError("Contract envelope must be an object.");
  }
  if (!hasOnlyKeys(value, ENVELOPE_KEYS)) {
    throw new ContractValidationError("Contract envelope contains unknown fields.");
  }
  const envelope = value as Partial<VersionedEnvelope<T>>;
  if (envelope.kind !== kind) {
    throw new ContractValidationError(`Unsupported contract kind: ${String(envelope.kind)}.`);
  }
  if (envelope.schemaVersion !== schemaVersion) {
    throw new ContractValidationError(
      `Unsupported ${kind} schema version: ${String(envelope.schemaVersion)}.`,
    );
  }
  if (!("payload" in envelope)) {
    throw new ContractValidationError("Contract envelope has no payload.");
  }
}

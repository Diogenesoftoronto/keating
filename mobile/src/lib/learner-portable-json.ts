import {
  ContractValidationError,
  parsePortableLearnerEnvelope,
  type PortableLearnerData,
  type PortableLearnerEnvelope,
} from "@keating/learner-contracts";

/**
 * The SQLite learner repository has a 64 MiB data quota.  One additional MiB
 * permits the versioned envelope and normal JSON syntax, while still refusing
 * an import before JSON.parse can allocate an unbounded object graph.
 */
export const MAX_PORTABLE_LEARNER_JSON_BYTES = 65 * 1024 * 1024;

export type PortableLearnerJsonErrorCode =
  | "too-large"
  | "malformed-json"
  | "invalid-contract"
  | "unsafe-contract"
  | "unsupported-contract";

/** A safe import/export error: its message intentionally never includes imported text. */
export class PortableLearnerJsonError extends Error {
  constructor(
    public readonly code: PortableLearnerJsonErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PortableLearnerJsonError";
  }
}

export interface PortableLearnerJsonParseOptions {
  /** A lower per-call limit is useful for previews and tests; callers cannot raise the repository limit. */
  maximumBytes?: number;
}

export interface PortableLearnerCountSummary {
  sessions: number;
  messages: number;
  artifacts: number;
  goals: number;
  assessments: number;
  decks: number;
  reviews: number;
  priorities: number;
  feedback: number;
  usage: number;
  topicEvidence: number;
  benchmarks: number;
  evolutions: number;
}

const IMPORT_MESSAGES: Record<PortableLearnerJsonErrorCode, string> = {
  "too-large": "This learner export is too large to import on this device.",
  "malformed-json": "This file is not valid JSON.",
  "invalid-contract": "This file is not a valid Keating learner export.",
  "unsafe-contract": "This learner export contains data that cannot be imported safely.",
  "unsupported-contract": "This learner export uses an unsupported Keating format or version.",
};

function importError(code: PortableLearnerJsonErrorCode): PortableLearnerJsonError {
  return new PortableLearnerJsonError(code, IMPORT_MESSAGES[code]);
}

/** Exact UTF-8 byte size without allocating a second full-size encoded buffer. */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff
      && index + 1 < text.length
      && text.charCodeAt(index + 1) >= 0xdc00
      && text.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else {
      // Lone UTF-16 surrogates are encoded as U+FFFD by JSON/TextEncoder.
      bytes += 3;
    }
  }
  return bytes;
}

function maximumBytes(options: PortableLearnerJsonParseOptions | undefined): number {
  const requested = options?.maximumBytes;
  if (requested === undefined) return MAX_PORTABLE_LEARNER_JSON_BYTES;
  if (!Number.isSafeInteger(requested) || requested < 1) return MAX_PORTABLE_LEARNER_JSON_BYTES;
  return Math.min(requested, MAX_PORTABLE_LEARNER_JSON_BYTES);
}

function contractErrorCode(error: unknown): PortableLearnerJsonErrorCode {
  if (!(error instanceof ContractValidationError)) return "invalid-contract";
  const message = error.message.toLowerCase();
  // Missing envelope fields are malformed contracts, whereas a supplied but
  // different kind/version is genuinely an unsupported format.
  if (message.startsWith("unsupported ") && !message.endsWith("undefined.")) return "unsupported-contract";
  if (message.includes("credential-like") || message.includes("may not contain")) return "unsafe-contract";
  return "invalid-contract";
}

/**
 * Parses an on-disk export without exposing payload content in errors. The
 * UTF-8 bound is intentionally checked before JSON.parse.
 */
export function parsePortableLearnerJson(
  text: unknown,
  options?: PortableLearnerJsonParseOptions,
): PortableLearnerEnvelope {
  if (typeof text !== "string") throw importError("malformed-json");
  if (utf8ByteLength(text) > maximumBytes(options)) throw importError("too-large");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw importError("malformed-json");
  }

  try {
    return parsePortableLearnerEnvelope(parsed);
  } catch (error) {
    throw importError(contractErrorCode(error));
  }
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => [key, sortJson((value as Record<string, unknown>)[key])]));
}

/** Validates then writes a stable, compact JSON document suitable for export. */
export function serializePortableLearnerJson(value: unknown): string {
  let envelope: PortableLearnerEnvelope;
  try {
    envelope = parsePortableLearnerEnvelope(value);
  } catch (error) {
    throw importError(contractErrorCode(error));
  }
  const serialized = `${JSON.stringify(sortJson(envelope))}\n`;
  if (utf8ByteLength(serialized) > MAX_PORTABLE_LEARNER_JSON_BYTES) throw importError("too-large");
  return serialized;
}

/** Counts actual portable records; it deliberately does not infer learning or mastery. */
export function summarizePortableLearnerData(data: PortableLearnerData): PortableLearnerCountSummary {
  return {
    sessions: data.sessions.length,
    messages: data.sessions.reduce((total, session) => total + session.messages.length, 0),
    artifacts: data.artifacts.length,
    goals: data.goals.length,
    assessments: data.questionChecks.length + data.quizResults.length,
    decks: data.decks.length,
    reviews: data.cardReviews.length,
    priorities: data.studyPriorities.length,
    feedback: data.feedbackEvents.length,
    usage: data.usageEvents.length,
    topicEvidence: data.topicEvidence.length,
    benchmarks: data.benchmarks.length,
    evolutions: data.evolutions.length,
  };
}

/** Compact copy suitable for an import/export confirmation sheet. */
export function formatPortableLearnerCountSummary(summary: PortableLearnerCountSummary): string {
  return [
    `${summary.sessions} sessions`, `${summary.messages} messages`, `${summary.artifacts} artifacts`,
    `${summary.goals} goals`, `${summary.assessments} assessments`, `${summary.decks} decks`,
    `${summary.reviews} reviews`, `${summary.priorities} study priorities`,
    `${summary.feedback} feedback`, `${summary.usage} usage records`,
    `${summary.topicEvidence} topic evidence records`,
    `${summary.benchmarks} benchmarks`, `${summary.evolutions} evolutions`,
  ].join(" · ");
}

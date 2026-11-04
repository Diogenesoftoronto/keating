/** Native extraction receipts, using the same pure contract as the web teacher.
 * The caller owns authorization, account scope, rate limits and dispatch. This
 * adapter never retries, reads credentials, or writes learner/web memory state.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AssistantMessage as PiAssistantMessage } from "@earendil-works/pi-ai";
import {
  fieldsFor, LEARNING_EXTRACTION_MAX_SOURCE_CHARS, LEARNING_EXTRACTION_NULL_THRESHOLD,
  MAX_RESPONSE_BYTES, validRequest, validateEnvelope,
  type ExtractionOutcome, type ExtractionRequest,
} from "../../packages/learner-contracts/src/learning-extraction-contract.js";
import {
  groundLearningExtractions, learningSourceHash,
  type GroundedLearningExtraction, type LearningEvidenceSource, type LearningExtractionKind,
} from "../../packages/learner-contracts/src/learning-intelligence.js";

export interface NativeLearningExtractionContext {
  systemPrompt: string;
  messages: readonly unknown[];
  tools?: readonly unknown[];
}
export interface NativeLearningExtractorOptions {
  sessionId: string;
  /** Stable identity supplied by the authorized transport; never a bearer token. */
  scope?: string;
  request?: (body: string, scope: string, signal?: AbortSignal) => Promise<Response>;
  /** Can shorten, but cannot increase, the production provider's 8-second cap. */
  timeoutMs?: number;
  now?: () => number;
}
export type NativeLearningExtractionStatus = "completed" | "abstained" | "partial" | "unavailable" | "failed" | "blocked" | "cancelled";
type Role = "learner" | "tutor";
type Grounding = ReturnType<typeof groundLearningExtractions>;
export interface NativeLearningSource extends LearningEvidenceSource {
  sourceHash: string;
  messageIndex: number;
  /** Text blocks use the production source representation, joined with two newlines. */
  representation: "text-blocks-utf16";
  excludedContentTypes: string[];
}
export interface NativeLearningRawResponse {
  status: number;
  body: string;
  complete: boolean;
  bytesRead: number;
  bytesRetained: number;
  /** Set for non-UTF-8 bodies so even invalid upstream bytes remain inspectable. */
  bodyBase64?: string;
}
export interface NativeLearningSourceReceipt {
  role: Role;
  status: Exclude<NativeLearningExtractionStatus, "partial">;
  reasons: string[];
  source: NativeLearningSource | null;
  rawRequest: string | null;
  rawResponse: NativeLearningRawResponse | null;
  outcome: ExtractionOutcome | null;
  model: string | null;
  elapsedMs: number;
  grounded: Grounding;
  fieldDecisions: { field: string; kind: LearningExtractionKind; status: "null" | "missing-probability" | "grounded" | "abstained"; reason?: string }[];
}
export interface NativeLearningExtractionReceipt {
  schemaVersion: 1;
  status: NativeLearningExtractionStatus;
  sessionId: string;
  sources: NativeLearningSourceReceipt[];
  contract: {
    sourceHashes: Record<string, string>;
    nullThreshold: number;
    maxSourceChars: number;
    maxResponseBytes: number;
  };
  /** Current-turn evidence only. Null means unavailable, never "no memory". */
  extractedState: {
    learner: GroundedLearningExtraction[] | null;
    tutor: GroundedLearningExtraction[] | null;
    /** Grounded extraction candidates, not calibrated memory admissions. */
    memoryCandidates: GroundedLearningExtraction[] | null;
    persisted: false;
  };
  proofBoundary: "native-extraction-receipt-only";
}

const sourcePaths = [
  "packages/learner-contracts/src/learning-extraction-contract.ts",
  "packages/learner-contracts/src/learning-intelligence.ts",
  "web/src/keating/learning-intelligence/runtime.ts",
  "web/src/keating/learning-intelligence/provider.ts",
  "web/src/keating/learning-intelligence/source-navigation.ts",
  "scripts/training/native_learning_extraction.ts",
] as const;
// Bind the receipt to this module-load snapshot, not a later edit on disk while
// an already-imported module is still running in a long-lived training process.
const sourceHashes = Object.fromEntries(sourcePaths.map(path => [path,
  createHash("sha256").update(readFileSync(new URL(`../../${path}`, import.meta.url))).digest("hex")]));
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Same text/id convention as learningMessageSource; no browser diagnostics import. */
function sourceFor(sessionId: string, row: unknown, index: number): NativeLearningSource | null {
  if (!object(row)) return null;
  const marker = row.keatingPrivateFork;
  if (object(marker) && marker.version === 1 && marker.kind === "imported-context") return null;
  if (!["user", "user-with-attachments", "assistant"].includes(String(row.role))) return null;
  const content = row.content ?? row.parts;
  const text = typeof content === "string" ? content : Array.isArray(content)
    ? content.flatMap(part => object(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : []).join("\n\n") : "";
  const messageId = typeof row.id === "string" && row.id.length > 0 && row.id.length <= 200 ? row.id
    : `${row.role === "assistant" ? "assistant" : "user"}-${index}-${typeof row.timestamp === "number" ? row.timestamp : ""}`;
  return { sessionId, messageId, text, role: String(row.role), sourceHash: learningSourceHash(text), messageIndex: index,
    representation: "text-blocks-utf16", excludedContentTypes: Array.isArray(content)
      ? content.flatMap(part => object(part) && part.type === "text" && typeof part.text === "string" ? [] : [object(part) && typeof part.type === "string" ? part.type : "unknown"]) : [] };
}

function initialReceipt(role: Role, source: NativeLearningSource | null): NativeLearningSourceReceipt {
  return { role, status: "blocked", reasons: [], source, rawRequest: null, rawResponse: null, outcome: null,
    model: null, elapsedMs: 0, grounded: { items: [], abstentions: [] }, fieldDecisions: [] };
}
function failed(receipt: NativeLearningSourceReceipt, error: Extract<ExtractionOutcome, { ok: false }>["error"]): NativeLearningSourceReceipt {
  return { ...receipt, status: error === "cancelled" ? "cancelled" : error === "unavailable" || error === "unauthorized" ? "unavailable" : "failed",
    reasons: [error], outcome: { ok: false, error } };
}

/** Capture before validation, including HTTP errors, under the production byte cap. */
async function captureResponse(response: Response, receipt: NativeLearningSourceReceipt, signal: AbortSignal): Promise<unknown> {
  const raw: NativeLearningRawResponse = { status: response.status, body: "", complete: false, bytesRead: 0, bytesRetained: 0 };
  receipt.rawResponse = raw;
  const reader = response.body?.getReader();
  if (!reader) { raw.complete = true; throw new Error("invalid-response"); }
  const chunks: Uint8Array[] = [];
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  const snapshot = () => {
    const bytes = Buffer.concat(chunks);
    try { raw.body = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { raw.body = new TextDecoder().decode(bytes); raw.bodyBase64 = bytes.toString("base64"); }
  };
  try {
    if (signal.aborted) { cancel(); throw new Error("cancelled"); }
    while (true) {
      const chunk = await reader.read();
      if (signal.aborted) throw new Error("cancelled");
      if (chunk.done) { raw.complete = true; break; }
      raw.bytesRead += chunk.value.byteLength;
      const retained = chunk.value.slice(0, Math.max(0, MAX_RESPONSE_BYTES - raw.bytesRetained));
      chunks.push(retained); raw.bytesRetained += retained.byteLength;
      snapshot();
      if (raw.bytesRead > MAX_RESPONSE_BYTES) { cancel(); throw new Error("response-too-large"); }
    }
    snapshot();
    if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES || raw.bodyBase64 !== undefined) throw new Error("invalid-response");
    return JSON.parse(raw.body);
  } finally { snapshot(); signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}

/** The returned hook takes only actual conversation inputs. Keep its receipt out
 * of simulator observations; the harness may separately consume extractedState.
 */
export function createNativeLearningExtractor(options: NativeLearningExtractorOptions) {
  if (!options.sessionId || options.sessionId.length > 256) throw new Error("native_extraction_invalid_session_id");
  const { sessionId, scope, request } = options, now = options.now ?? Date.now;
  const timeoutMs = Math.min(8_000, Math.max(1, Number.isFinite(options.timeoutMs) ? options.timeoutMs! : 8_000));
  const contract = { sourceHashes,
  nullThreshold: LEARNING_EXTRACTION_NULL_THRESHOLD, maxSourceChars: LEARNING_EXTRACTION_MAX_SOURCE_CHARS, maxResponseBytes: MAX_RESPONSE_BYTES };

  async function extractSource(initial: NativeLearningSourceReceipt, signal?: AbortSignal): Promise<NativeLearningSourceReceipt> {
    const started = now();
    let receipt = initial;
    const done = (value: NativeLearningSourceReceipt) => structuredClone({ ...value, elapsedMs: Math.max(0, now() - started) });
    if (signal?.aborted) return done(failed(receipt, "cancelled"));
    if (receipt.reasons.length) return done(receipt);
    const source = receipt.source;
    if (!source) return done({ ...receipt, reasons: ["missing-source"] });
    if (!source.text.trim()) return done({ ...receipt, reasons: ["empty-source"] });
    if (source.text.length > LEARNING_EXTRACTION_MAX_SOURCE_CHARS) return done({ ...receipt, reasons: ["source-too-large"] });
    const fields = fieldsFor(receipt.role === "learner");
    const payload: ExtractionRequest = { state: source.text, fields: Object.fromEntries(Object.entries(fields)
      .map(([id, field]) => [id, { type: "text" as const, instructions: field.instructions, null_threshold: LEARNING_EXTRACTION_NULL_THRESHOLD }])),
    reference_date: new Date(now()).toISOString().slice(0, 10) };
    receipt.rawRequest = JSON.stringify(payload);
    if (!validRequest(payload)) return done({ ...receipt, reasons: ["invalid-request"] });
    if (!request) return done(failed(receipt, "unavailable"));
    if (!scope) return done(failed(receipt, "unauthorized"));

    const controller = new AbortController();
    let stop!: (reason: "cancelled" | "timeout") => void;
    const stopped = new Promise<NativeLearningSourceReceipt>(resolve => { stop = reason => {
      controller.abort(); resolve(failed(receipt, reason));
    }; });
    const onAbort = () => stop("cancelled");
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => stop("timeout"), timeoutMs);
    const run = async (): Promise<NativeLearningSourceReceipt> => {
      try {
        if (signal?.aborted) return failed(receipt, "cancelled");
        const response = await request(receipt.rawRequest!, scope, controller.signal);
        if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); return failed(receipt, "cancelled"); }
        let body: unknown;
        try { body = await captureResponse(response, receipt, controller.signal); }
        catch {
          if (controller.signal.aborted) return failed(receipt, "cancelled");
          // Error HTTP bodies need not be JSON. Their transport status stays authoritative.
          if (response.ok) return failed(receipt, "invalid-response");
        }
        if (controller.signal.aborted) return failed(receipt, "cancelled");
        if (!response.ok) return failed(receipt, response.status === 401 || response.status === 403 ? "unauthorized"
          : response.status === 402 ? "credit" : response.status === 429 ? "rate-limited"
          : response.status === 404 || response.status === 503 ? "unavailable" : "provider");
        const outcome = validateEnvelope(body, payload);
        receipt.outcome = outcome;
        if (!outcome.ok) return failed(receipt, outcome.error);
        receipt.model = outcome.model;
        const candidates = Object.entries(fields).flatMap(([id, field]) => {
          const answer = outcome.answers[id]!;
          if (answer.value === null) { receipt.fieldDecisions.push({ field: id, kind: field.kind, status: "null" }); return []; }
          if (typeof answer.p_null !== "number") {
            receipt.fieldDecisions.push({ field: id, kind: field.kind, status: "missing-probability" }); return [];
          }
          return typeof answer.value === "string" && answer.span && answer.p_null <= LEARNING_EXTRACTION_NULL_THRESHOLD
            ? [{ field: id, kind: field.kind, quote: answer.value, start: answer.span[0], end: answer.span[1], sourceHash: source.sourceHash }] : [];
        });
        receipt.grounded = groundLearningExtractions(source, candidates);
        candidates.forEach((candidate, index) => {
          const rejection = receipt.grounded.abstentions.find(item => item.index === index);
          receipt.fieldDecisions.push({ field: candidate.field, kind: candidate.kind, status: rejection ? "abstained" : "grounded",
            ...(rejection ? { reason: rejection.reason } : {}) });
        });
        receipt = { ...receipt, status: receipt.grounded.items.length ? "completed" : "abstained",
          reasons: receipt.grounded.abstentions.map(item => item.reason) };
        return receipt;
      } catch { return failed(receipt, controller.signal.aborted ? "cancelled" : "provider"); }
    };
    try { return done(await Promise.race([stopped, run()])); }
    finally { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); }
  }

  return {
    async extract(context: NativeLearningExtractionContext, message: PiAssistantMessage, signal?: AbortSignal): Promise<NativeLearningExtractionReceipt> {
      // Capture both revisions synchronously before dispatch can mutate caller data.
      let learner: NativeLearningSource | null = null;
      for (let index = context.messages.length - 1; index >= 0; index--) {
        const row = context.messages[index];
        if (!object(row) || !["user", "user-with-attachments"].includes(String(row.role))) continue;
        const source = sourceFor(sessionId, row, index);
        if (source) { learner = source; break; }
      }
      const existingIndex = context.messages.lastIndexOf(message);
      const tutor = sourceFor(sessionId, message, existingIndex < 0 ? context.messages.length : existingIndex);
      const learnerInitial = initialReceipt("learner", learner), tutorInitial = initialReceipt("tutor", tutor);
      if (["error", "aborted", "length"].includes(message.stopReason)) tutorInitial.reasons = ["incomplete-tutor-message"];
      // Explicit duplicate IDs cannot provide an unambiguous navigable source.
      for (const entry of [learnerInitial, tutorInitial]) {
        if (!entry.source) continue;
        const matches = context.messages.filter((row, index) => sourceFor(sessionId, row, index)?.messageId === entry.source!.messageId).length;
        if (matches > (entry === tutorInitial && existingIndex < 0 ? 0 : 1)) entry.reasons.push("ambiguous-source-identity");
      }
      const learnerResult = await extractSource(learnerInitial, signal);
      // Preserve rate limits: a throttled transport is not probed for the second source.
      if (learnerResult.outcome?.ok === false && learnerResult.outcome.error === "rate-limited") tutorInitial.reasons.push("rate-limited-before-dispatch");
      const tutorResult = await extractSource(tutorInitial, signal);
      const sources = [learnerResult, tutorResult];
      const available = (entry: NativeLearningSourceReceipt) => entry.status === "completed" || entry.status === "abstained";
      const successes = sources.filter(available);
      const status: NativeLearningExtractionStatus = successes.length === sources.length
        ? sources.some(entry => entry.status === "completed") ? "completed" : "abstained"
        : successes.length ? "partial" : sources.some(entry => entry.status === "cancelled") ? "cancelled"
        : sources.some(entry => entry.status === "failed") ? "failed" : sources.some(entry => entry.status === "unavailable") ? "unavailable" : "blocked";
      return structuredClone({ schemaVersion: 1, status, sessionId, sources, contract,
        extractedState: { learner: available(learnerResult) ? learnerResult.grounded.items : null,
          tutor: available(tutorResult) ? tutorResult.grounded.items : null,
          memoryCandidates: available(learnerResult) ? learnerResult.grounded.items.filter(item => item.kind === "memory") : null,
          persisted: false }, proofBoundary: "native-extraction-receipt-only" });
    },
  };
}

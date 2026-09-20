/**
 * Wire codec for the TypeSafe System One HTTP protocol.
 *
 * Pure by design: encoding and decoding are separated from the fetch that
 * carries them, so the protocol can be tested exhaustively without a network
 * and a transport can be swapped without touching the shape.
 *
 * The protocol has three asymmetries that are easy to get wrong, so they are
 * handled here once rather than at every call site:
 *   - Choice criteria is a map, Score criteria is an ordered array.
 *   - Noul carries no confidence; Choice and Score do.
 *   - Score keys its probabilities by level-as-string.
 */
import {
  type JudgementAnswer,
  type JudgementError,
  type JudgementQuestion,
  type JudgementRequest,
  type JudgementUsage,
} from "./contracts.js";

export const SYSTEM_ONE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const DEFAULT_SYSTEM_ONE_MODEL = "jev-latest";

export interface SystemOneRequestBody {
  readonly state: unknown;
  readonly model: string;
  readonly questions: Record<string, unknown>;
}

/**
 * Question keys are ours and are documented as not reaching the model, so they
 * stay exactly as the caller wrote them — round-tripping answers depends on it.
 */
export function encodeSystemOneRequest(
  request: JudgementRequest,
  model: string = DEFAULT_SYSTEM_ONE_MODEL,
): SystemOneRequestBody {
  const questions: Record<string, unknown> = {};
  for (const [key, question] of Object.entries(request.questions)) {
    questions[key] = encodeQuestion(question);
  }
  return { state: request.state, model, questions };
}

function encodeQuestion(question: JudgementQuestion): Record<string, unknown> {
  if (question.type === "noul") {
    // `criteria` is optional for a Noul and is omitted rather than sent empty:
    // a `true` pole that reads like "no" measurably degrades the answer.
    return question.criteria
      ? { type: "noul", instructions: question.instructions, criteria: { ...question.criteria } }
      : { type: "noul", instructions: question.instructions };
  }
  if (question.type === "choice") {
    return { type: "choice", instructions: question.instructions, criteria: { ...question.criteria } };
  }
  return { type: "score", instructions: question.instructions, criteria: [...question.criteria] };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isProbability(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function decodeProbabilities(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, number> = {};
  for (const [key, probability] of Object.entries(value as Record<string, unknown>)) {
    if (!isProbability(probability)) return null;
    out[key] = probability;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function decodeLegend(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, description] of Object.entries(value as Record<string, unknown>)) {
    if (typeof description !== "string") return null;
    out[key] = description;
  }
  return out;
}

/**
 * Decode one answer, or null if it does not match the primitive that was asked.
 *
 * A mismatch is treated as malformed rather than coerced. Silently repairing a
 * shape here would let an unusable answer reach a threshold as if it were real.
 */
export function decodeAnswer(question: JudgementQuestion, value: unknown): JudgementAnswer | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.type !== question.type) return null;

  if (question.type === "noul") {
    return isProbability(raw.noul) ? { type: "noul", noul: raw.noul } : null;
  }

  if (question.type === "choice") {
    const probabilities = decodeProbabilities(raw.probabilities);
    if (typeof raw.choice !== "string" || probabilities === null) return null;
    // The selected option must be one we declared; anything else means the
    // answer cannot be resolved back to a candidate.
    if (!Object.prototype.hasOwnProperty.call(question.criteria, raw.choice)) return null;
    if (!isProbability(raw.confidence)) return null;
    return { type: "choice", choice: raw.choice, probabilities, confidence: raw.confidence };
  }

  const probabilities = decodeProbabilities(raw.probabilities);
  const legend = decodeLegend(raw.legend);
  if (!isFiniteNumber(raw.score) || probabilities === null || legend === null) return null;
  if (!isProbability(raw.confidence)) return null;
  return { type: "score", score: raw.score, legend, probabilities, confidence: raw.confidence };
}

export interface DecodedSystemOneResponse {
  readonly model?: string;
  readonly answers: Record<string, JudgementAnswer>;
  readonly usage?: JudgementUsage;
}

/**
 * Decode a whole response. Unknown keys are dropped and missing keys are simply
 * absent; the router already treats an absent answer as an escalation, so a
 * partial response degrades rather than failing the batch.
 */
export function decodeSystemOneResponse(
  request: JudgementRequest,
  body: unknown,
): DecodedSystemOneResponse | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const raw = body as Record<string, unknown>;
  if (!raw.answers || typeof raw.answers !== "object" || Array.isArray(raw.answers)) return null;
  const rawAnswers = raw.answers as Record<string, unknown>;

  const answers: Record<string, JudgementAnswer> = {};
  for (const [key, question] of Object.entries(request.questions)) {
    if (!(key in rawAnswers)) continue;
    const decoded = decodeAnswer(question, rawAnswers[key]);
    if (decoded !== null) answers[key] = decoded;
  }

  const usageRaw = raw.usage;
  let usage: JudgementUsage | undefined;
  if (usageRaw && typeof usageRaw === "object" && !Array.isArray(usageRaw)) {
    const entry = usageRaw as Record<string, unknown>;
    if (isFiniteNumber(entry.input_tokens) && isFiniteNumber(entry.output_tokens)) {
      usage = { inputTokens: entry.input_tokens, outputTokens: entry.output_tokens };
    }
  }
  const model = typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : undefined;
  return { answers, usage, model };
}

/**
 * Map an HTTP status to a stable code.
 *
 * The upstream body is deliberately never read: it can echo the learner's own
 * text back, so it must not reach a log line, a screen, or a telemetry span.
 */
export function errorForStatus(status: number): JudgementError {
  if (status === 401 || status === 403) return { code: "backend-unauthorized", retryable: false };
  if (status === 422) return { code: "request-invalid", retryable: false };
  if (status === 429) return { code: "backend-rate-limited", retryable: true };
  if (status === 529 || status === 503) return { code: "backend-overloaded", retryable: true };
  if (status >= 500) return { code: "backend-unavailable", retryable: true };
  return { code: "backend-unavailable", retryable: false };
}

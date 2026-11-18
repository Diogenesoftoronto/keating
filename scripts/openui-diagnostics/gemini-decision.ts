/** Evaluation-only transport for Google's Decisions API. No key or fetch is obtained implicitly. */
import {
  judgementRequestProblem,
  type JudgementAnswer, type JudgementCaller, type JudgementErrorCode, type JudgementOutcome,
  type JudgementQuestion, type JudgementRequest, type JudgementUsage,
} from "../../packages/learner-contracts/src/judgement/contracts.js";
import type { FetchLike } from "../../packages/learner-contracts/src/judgement/system-one.js";
import { errorForStatus } from "../../packages/learner-contracts/src/judgement/wire.js";

export const GEMINI_DECISION_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/decisions";
export const GEMINI_DECISION_MODEL = "gemini-decision-1";

export interface GeminiDecisionReceipt {
  provider: "google";
  requestedModel: typeof GEMINI_DECISION_MODEL;
  reportedModel: string | null;
  modelProvenance: "response-model" | "documented-request-model" | "unverified";
  httpStatus: number | null;
  usage: JudgementUsage | null;
  errorCode: JudgementErrorCode | null;
}

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const probability = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
const tokens = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const sameKeys = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));

/** Extract literal reported billing counters before judging the rest of the response, including on failure. */
export function readGeminiDecisionUsage(body: unknown): JudgementUsage | null {
  if (!object(body) || !object(body.usage)) return null;
  const inputTokens = body.usage.total_input_tokens, outputTokens = body.usage.total_output_tokens;
  return tokens(inputTokens) && tokens(outputTokens) ? { inputTokens, outputTokens } : null;
}

function encodeQuestion(q: JudgementQuestion): Record<string, unknown> | null {
  if (!Object.keys(q).every(k => ["type", "instructions", "criteria"].includes(k))) return null;
  const base = { type: q.type, instructions: q.instructions };
  if (q.type === "noul") {
    if (q.criteria === undefined) return base;
    if (!object(q.criteria) || !sameKeys(q.criteria, ["true", "false"]) || typeof q.criteria.true !== "string" || typeof q.criteria.false !== "string") return null;
    return { ...base, criteria: { true_description: q.criteria.true, false_description: q.criteria.false } };
  }
  if (q.type === "score") {
    if (!Array.isArray(q.criteria) || q.criteria.length > 255 || !q.criteria.every(level => typeof level === "string" && level.trim())) return null;
    return { ...base, criteria: q.criteria };
  }
  if (q.type !== "choice" || !object(q.criteria)) return null;
  const choices = Object.entries(q.criteria);
  if (choices.some(([key, rubric]) => key !== key.trim() || [...key].length > 128 || /[\p{Cc}\p{Z}]/u.test(key.replaceAll(" ", ""))
    || (rubric !== null && typeof rubric !== "string"))) return null;
  return { ...base, criteria: Object.fromEntries(choices.map(([key, rubric]) => [key, rubric ?? ""])) };
}

function encode(request: JudgementRequest): string | null {
  if (!object(request) || (!object(request.state) && !Array.isArray(request.state) && typeof request.state !== "string")
    || !object(request.questions) || judgementRequestProblem(request)) return null;
  const questions: [string, Record<string, unknown>][] = [];
  for (const [id, question] of Object.entries(request.questions)) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) return null;
    const encoded = encodeQuestion(question);
    if (!encoded) return null;
    questions.push([id, encoded]);
  }
  // Google accepts text or content blocks. The original state is shared JSON data, never a new instruction or a media block.
  const input = typeof request.state === "string" ? request.state : JSON.stringify(request.state);
  return JSON.stringify({ model: GEMINI_DECISION_MODEL, input, questions: Object.fromEntries(questions) });
}

// Published examples round individual probabilities to two decimals. Preserve the reported
// values rather than normalizing them; allow half of the last displayed hundredth per term.
const roundoff = 0.0050001;
function answer(question: JudgementQuestion, raw: unknown): JudgementAnswer | null {
  if (!object(raw) || raw.type !== question.type || !probability(raw.confidence)) return null;
  if (question.type === "noul") {
    if (!sameKeys(raw, ["type", "noul", "confidence"]) || !probability(raw.noul) || raw.noul < .01 - 1e-7 || raw.noul > .99 + 1e-7
      || Math.abs(raw.confidence - Math.max(raw.noul, 1 - raw.noul)) > roundoff * 2) return null;
    // Keating's Noul contract uses P(yes) only; Google's confidence has been checked independently.
    return { type: "noul", noul: raw.noul };
  }
  const keys = Object.keys(question.criteria);
  if (!object(raw.probabilities) || !sameKeys(raw.probabilities, keys)) return null;
  const probabilities: Record<string, number> = Object.create(null);
  for (const k of keys) {
    const p = raw.probabilities[k];
    if (!probability(p)) return null;
    probabilities[k] = p;
  }
  const values = Object.values(probabilities), high = Math.max(...values), sum = values.reduce((total, p) => total + p, 0);
  if (!high || Math.abs(sum - 1) > roundoff * keys.length || Math.abs(raw.confidence - high) > roundoff * 2) return null;
  if (question.type === "choice") {
    if (!sameKeys(raw, ["type", "choice", "probabilities", "confidence"]) || typeof raw.choice !== "string"
      || !Object.hasOwn(probabilities, raw.choice) || probabilities[raw.choice]! < high) return null;
    return { type: "choice", choice: raw.choice, probabilities, confidence: raw.confidence };
  }
  const legend = raw.legend;
  if (!sameKeys(raw, ["type", "score", "probabilities", "legend", "confidence"]) || !object(legend) || !sameKeys(legend, keys)
    || !keys.every((key, i) => legend[key] === question.criteria[i]) || typeof raw.score !== "number" || !Number.isFinite(raw.score)
    || raw.score < 0 || raw.score > keys.length - 1) return null;
  const mean = keys.reduce((total, key, i) => total + i * probabilities[key]!, 0);
  if (Math.abs(mean - raw.score) > roundoff * (1 + keys.length * (keys.length - 1) / 2)) return null;
  return { type: "score", score: raw.score, confidence: raw.confidence, probabilities, legend: Object.fromEntries(question.criteria.map((value, i) => [i, value])) };
}

const failure = (code: JudgementErrorCode, retryable = false): JudgementOutcome => ({ ok: false, error: { code, retryable } });
export function createGeminiDecisionCaller(options: {
  apiKey: string;
  fetch: FetchLike;
  onReceipt?: (receipt: GeminiDecisionReceipt) => void | Promise<void>;
}): JudgementCaller {
  return async (request, signal) => {
    const receipt: GeminiDecisionReceipt = { provider: "google", requestedModel: GEMINI_DECISION_MODEL, reportedModel: null,
      modelProvenance: "unverified", httpStatus: null, usage: null, errorCode: null };
    async function finish(outcome: JudgementOutcome) {
      receipt.errorCode = outcome.ok ? null : outcome.error.code;
      try { await options.onReceipt?.(receipt); } catch { return failure("backend-unavailable"); }
      return outcome;
    }
    if (signal?.aborted) return finish(failure("cancelled"));
    if (!options.apiKey?.trim()) return finish(failure("backend-unauthorized"));
    let body: string | null;
    try { body = encode(request); } catch { body = null; }
    if (body === null) return finish(failure("request-invalid"));
    const init = { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": options.apiKey },
      body, signal, redirect: "error" as const };
    let response: Awaited<ReturnType<FetchLike>>;
    try { response = await options.fetch(GEMINI_DECISION_ENDPOINT, init); }
    catch { return finish(failure(signal?.aborted ? "cancelled" : "backend-unavailable")); }
    receipt.httpStatus = response.status;
    let payload: unknown;
    try { payload = await response.json(); } catch { payload = null; }
    receipt.usage = readGeminiDecisionUsage(payload);
    if (signal?.aborted) return finish(failure("cancelled"));
    if (!response.ok) {
      if (response.status === 400) return finish(failure("request-invalid"));
      if (response.status === 408 || response.status === 504) return finish(failure("backend-timeout"));
      return finish({ ok: false, error: errorForStatus(response.status) });
    }
    if (!object(payload) || !object(payload.answers) || !object(payload.usage) || !receipt.usage
      || receipt.usage.outputTokens !== 0 || (Object.hasOwn(payload.usage, "total_tokens") && payload.usage.total_tokens !== receipt.usage.inputTokens)
      || !sameKeys(payload.answers, Object.keys(request.questions))) return finish(failure("response-malformed"));
    // The documented success envelope exposes only answers and usage. Never treat the
    // named request as an independently resolved server revision. An echoed identity must agree.
    const identityKeys = ["model", "model_version", "modelVersion"].filter(k => Object.hasOwn(payload, k));
    if (!Object.keys(payload).every(k => ["answers", "usage", ...identityKeys].includes(k))
      || identityKeys.some(k => payload[k] !== GEMINI_DECISION_MODEL && payload[k] !== `models/${GEMINI_DECISION_MODEL}`)) return finish(failure("response-malformed"));
    if (identityKeys.length) receipt.reportedModel = String(payload[identityKeys[0]!]);
    const answers: Record<string, JudgementAnswer> = Object.create(null);
    for (const [id, question] of Object.entries(request.questions)) {
      const decoded = answer(question, payload.answers[id]);
      if (!decoded) return finish(failure("response-malformed"));
      answers[id] = decoded;
    }
    receipt.modelProvenance = identityKeys.length ? "response-model" : "documented-request-model";
    // The shared protocol category has three legacy values. Provider provenance is
    // explicitly Google in this evaluation receipt and the model identity is never Jev.
    return finish({ ok: true, response: { answers, usage: receipt.usage,
      backend: { backend: "system-one", model: GEMINI_DECISION_MODEL, calibrationSha256: null } } });
  };
}

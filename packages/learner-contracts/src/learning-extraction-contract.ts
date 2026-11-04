/** Shared pure Clairic contract. Browser account/transport authority stays with each caller. */
import type { LearningExtractionKind } from "./learning-intelligence.js";

export const LEARNING_EXTRACTION_NULL_THRESHOLD = 0.25;
export const LEARNING_EXTRACTION_MAX_SOURCE_CHARS = 12_000;

export const fieldsFor = (learner: boolean): Record<string, { kind: LearningExtractionKind; instructions: string }> => learner ? {
  step_1: { kind: "answer-step", instructions: "The learner's first explicit reasoning step, explanation, equation or assumption. Copy an exact self-contained passage. Null when no reasoning is present." },
  step_2: { kind: "answer-step", instructions: "A different explicit reasoning step or assumption from the learner. Exact passage, or null. Do not judge correctness." },
  constraint: { kind: "learning-constraint", instructions: "An explicit learning goal, deadline, time budget or tool constraint stated by the learner. Include negation and time limits. Exact passage or null; do not infer preferences." },
  memory: { kind: "memory", instructions: "A short self-contained, learner-endorsed statement about their durable interests, study context or communication preferences. Exact passage of at most 240 characters, or null. Exclude sensitive data, secrets, task answers, quoted third parties and temporary requests." },
  question: { kind: "important-question", instructions: "An explicit unresolved question the learner asks or says is important to understand. Exact passage including context, or null. Do not invent questions or predict exam content." },
} : {
  fact_1: { kind: "lesson-fact", instructions: "An exact self-contained definition, claim or worked explanation explicitly taught in this message. Preserve qualifications and negation. Null if none. Presence in tutor text does not prove truth." },
  fact_2: { kind: "lesson-fact", instructions: "A different exact definition, claim or worked step explicitly taught here. Preserve context and qualifications, or null." },
  question: { kind: "important-question", instructions: "An exact comprehension question or key unresolved question explicitly posed in this lesson. Copy the question and necessary context, or null. Do not invent an exam prediction." },
};

export interface ExtractionField {
  type: "text" | "forecast" | "estimate";
  instructions?: string;
  min?: number;
  max?: number;
  horizon?: number;
  interval?: "step" | "day";
  null_threshold?: number;
}
export interface ExtractionRequest {
  state: string;
  fields: Record<string, ExtractionField>;
  reference_date?: string;
  options?: { include_quantiles?: boolean; return_state_text?: boolean };
}
export interface ExtractionAnswer {
  type: ExtractionField["type"];
  value: unknown;
  span?: [number, number];
  p_null?: number;
  confidence?: number;
  median?: number | number[];
  p10?: number | number[];
  p90?: number | number[];
}
export type ExtractionOutcome = {
  ok: true;
  model: string;
  answers: Record<string, ExtractionAnswer>;
  usage?: { input_tokens: number; output_tokens: number };
  truncated: false;
} | { ok: false; error: "unavailable" | "unauthorized" | "credit" | "rate-limited" | "timeout" | "cancelled" | "invalid-response" | "provider" };
type Failure = Extract<ExtractionOutcome, { ok: false }>;
const fail = (error: Failure["error"]): Failure => ({ ok: false, error });
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const probability = (value: unknown): value is number => finite(value) && value >= 0 && value <= 1;
export const MAX_RESPONSE_BYTES = 128 * 1024;

export function validRequest(raw: ExtractionRequest): boolean {
  if (!record(raw) || typeof raw.state !== "string" || !raw.state.trim() || raw.state.length > 24_000 || !record(raw.fields)) return false;
  if (Object.keys(raw).some(key => !["state", "fields", "reference_date", "options"].includes(key))) return false;
  const fields = Object.entries(raw.fields);
  if (!fields.length || fields.length > 12) return false;
  if (raw.reference_date !== undefined && (typeof raw.reference_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.reference_date)
    || !Number.isFinite(Date.parse(`${raw.reference_date}T00:00:00Z`)) || new Date(`${raw.reference_date}T00:00:00Z`).toISOString().slice(0, 10) !== raw.reference_date)) return false;
  if (raw.options !== undefined && (!record(raw.options) || Object.entries(raw.options).some(([key, value]) => !["include_quantiles", "return_state_text"].includes(key) || typeof value !== "boolean"))) return false;
  return fields.every(([name, field]) => {
    if (!name || name.length > 100 || !record(field) || !["text", "estimate", "forecast"].includes(field.type)) return false;
    if (Object.keys(field).some(key => !["type", "instructions", "min", "max", "horizon", "interval", "null_threshold"].includes(key))) return false;
    if (field.instructions !== undefined && (typeof field.instructions !== "string" || field.instructions.length > 4_000)) return false;
    if (field.null_threshold !== undefined && !probability(field.null_threshold)) return false;
    if (field.type === "text") return field.horizon === undefined && field.min === undefined && field.max === undefined && field.interval === undefined;
    if (!finite(field.min) || !finite(field.max) || field.min >= field.max) return false;
    return field.type === "estimate" ? field.horizon === undefined && field.interval === undefined
      : Number.isInteger(field.horizon) && field.horizon! >= 1 && field.horizon! <= 64 && (field.interval === undefined || ["step", "day"].includes(field.interval));
  });
}
function boundary(source: string, offset: number): boolean {
  return !(offset > 0 && offset < source.length && /[\uD800-\uDBFF]/.test(source[offset - 1]!) && /[\uDC00-\uDFFF]/.test(source[offset]!));
}
function interval(raw: Record<string, unknown>, field: ExtractionField): { median: number; p10: number; p90: number } | null {
  const { median, p10, p90 } = raw;
  const inRange = (value: unknown): value is number => finite(value) && value >= field.min! && value <= field.max!;
  if (![median, p10, p90].every(inRange) || (p10 as number) > (median as number) || (median as number) > (p90 as number)) return null;
  if (raw.value !== undefined && !inRange(raw.value) || raw.mean !== undefined && !inRange(raw.mean)) return null;
  if (raw.quantiles !== undefined && (!Array.isArray(raw.quantiles) || raw.quantiles.length !== 99 || !raw.quantiles.every(inRange)
    || raw.quantiles.some((value, index, all) => index > 0 && value < all[index - 1]))) return null;
  for (const key of ["p_below", "p_above", "confidence", "p_null"]) if (raw[key] !== undefined && !probability(raw[key])) return null;
  return { median: median as number, p10: p10 as number, p90: p90 as number };
}
/** Gateway offsets are canonical UTF-16; never search, guess, or reinterpret them. */
function validateAnswer(raw: unknown, field: ExtractionField, source: string): ExtractionAnswer | null {
  if (!record(raw) || raw.type !== field.type || !Object.hasOwn(raw, "value")) return null;
  for (const key of ["p_null", "confidence", "p_below", "p_above"]) if (raw[key] !== undefined && !probability(raw[key])) return null;
  const common = { type: field.type, ...(raw.p_null !== undefined ? { p_null: raw.p_null as number } : {}),
    ...(raw.confidence !== undefined ? { confidence: raw.confidence as number } : {}) };
  // Abstention is explicit; upstream guesses and their candidate spans are not evidence.
  if (raw.value === null) return { ...common, value: null };
  if (field.type === "text") {
    const span = raw.span;
    if (typeof raw.value !== "string" || !raw.value || !Array.isArray(span) || span.length !== 2
      || !span.every(n => Number.isSafeInteger(n) && n >= 0) || span[0] >= span[1] || span[1] > source.length
      || !boundary(source, span[0]) || !boundary(source, span[1]) || source.slice(span[0], span[1]) !== raw.value
      || typeof raw.p_null === "number" && raw.p_null > (field.null_threshold ?? .5)
      || raw.guess !== undefined && raw.guess !== raw.value) return null;
    return { ...common, value: raw.value, span: [span[0], span[1]] };
  }
  if (field.type === "estimate") {
    const values = interval(raw, field);
    return values ? { ...common, value: raw.value, ...values } : null;
  }
  const horizon = field.horizon!;
  if (!Array.isArray(raw.value) || raw.value.length !== horizon || raw.value.some(value => !finite(value) || value < field.min! || value > field.max!)) return null;
  let steps: unknown[];
  if (raw.steps !== undefined) {
    if (!Array.isArray(raw.steps) || raw.steps.length !== horizon) return null;
    steps = raw.steps;
  } else {
    if (![raw.median, raw.p10, raw.p90].every(values => Array.isArray(values) && values.length === horizon)) return null;
    steps = (raw.median as unknown[]).map((median, index) => ({ median, p10: (raw.p10 as unknown[])[index], p90: (raw.p90 as unknown[])[index] }));
  }
  const values = steps.map(step => record(step) ? interval(step, field) : null);
  if (values.some(value => !value)) return null;
  for (const key of ["median", "p10", "p90", "mean"] as const) {
    const parallel = raw[key];
    if (parallel === undefined) continue;
    if (!Array.isArray(parallel) || parallel.length !== horizon) return null;
    if (parallel.some((value, index) => key === "mean" ? !finite(value) || value < field.min! || value > field.max!
      || record(steps[index]) && steps[index].mean !== undefined && steps[index].mean !== value : value !== values[index]![key])) return null;
  }
  return { ...common, value: [...raw.value], median: values.map(value => value!.median),
    p10: values.map(value => value!.p10), p90: values.map(value => value!.p90) };
}
export function validateEnvelope(raw: unknown, request: ExtractionRequest): ExtractionOutcome {
  if (!record(raw) || typeof raw.model !== "string" || !/^extraction-clairic\/clairic(?:[-@:.][\w.-]+)?$/.test(raw.model)
    || raw.truncated !== false || !record(raw.answers)) return fail("invalid-response");
  const names = Object.keys(request.fields), rawAnswers = raw.answers;
  if (Object.keys(rawAnswers).length !== names.length || names.some(name => !Object.hasOwn(rawAnswers, name))) return fail("invalid-response");
  const answers: Record<string, ExtractionAnswer> = Object.create(null);
  for (const name of names) {
    const answer = validateAnswer(rawAnswers[name], request.fields[name]!, request.state);
    if (!answer) return fail("invalid-response");
    answers[name] = answer;
  }
  const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  if (raw.usage != null && (!record(raw.usage) || !count(raw.usage.input_tokens) || !count(raw.usage.output_tokens))) return fail("invalid-response");
  return { ok: true, model: raw.model, answers, truncated: false,
    ...(record(raw.usage) ? { usage: { input_tokens: raw.usage.input_tokens as number, output_tokens: raw.usage.output_tokens as number } } : {}) };
}

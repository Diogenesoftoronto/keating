import { Tokenizer } from "@huggingface/tokenizers";

export const JULIA_ENCODER_VERSION = "tokenizers-0.1.3-metaspace-split-strict-v1";
export interface JuliaDecisionRequest { state: unknown; question: string; options: readonly string[]; type: "choice" | "score" | "noul" }
export interface JuliaEncodedRequest { ids: number[]; markers: number[]; qtype: 0 | 1 | 2 }
export interface JuliaEncoder { encode(request: JuliaDecisionRequest, bounds?: { maxLength?: number; headLength?: number }): JuliaEncodedRequest }

function validText(text: unknown): text is string {
  if (typeof text !== "string" || text.length > 72_000) return false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) { const next = text.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; }
    else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return !text.includes("<mask>");
}

/** Rust serde_json object keys sort by Unicode scalar value, not UTF-16 code units. */
function compareKeys(a: string, b: string): number {
  const left = Array.from(a), right = Array.from(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const delta = left[i]!.codePointAt(0)! - right[i]!.codePointAt(0)!;
    if (delta) return delta;
  }
  return left.length - right.length;
}

/** Keep evidence JSON bounded and use the official Rust encoder's compact sorted representation. */
function stateText(state: unknown): string {
  if (typeof state === "string") { if (!validText(state)) throw new Error("Invalid Julia state"); return state; }
  if (state === null || typeof state !== "object") throw new Error("Invalid Julia state");
  let nodes = 0;
  let characters = 0;
  const seen = new Set<object>();
  const serialize = (value: unknown, depth: number): string => {
    if (++nodes > 10_000 || depth > 32) throw new Error("Julia evidence exceeds bounds");
    if (typeof value === "string") { characters += value.length; if (characters > 72_000 || !validText(value)) throw new Error("Invalid Julia evidence string"); return JSON.stringify(value); }
    if (value === null || typeof value === "boolean") return JSON.stringify(value);
    if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
    if (!value || typeof value !== "object" || seen.has(value)) throw new Error("Julia evidence must be JSON");
    seen.add(value);
    try {
      if (Array.isArray(value)) return `[${value.map(item => serialize(item, depth + 1)).join(",")}]`;
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error("Julia evidence must be plain JSON");
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record).sort(compareKeys).map(key => { characters += key.length; if (characters > 72_000 || !validText(key)) throw new Error("Invalid Julia evidence key"); return `${JSON.stringify(key)}:${serialize(record[key], depth + 1)}`; }).join(",")}}`;
    } finally { seen.delete(value); }
  };
  const text = serialize(state, 0);
  if (text.length > 72_000) throw new Error("Julia evidence exceeds bounds");
  return text;
}

/** Pure JS encoder. The Split adapter restores Metaspace.split=true, which tokenizers.js 0.1.3 otherwise ignores. */
export function createJuliaEncoder(tokenizerJson: unknown, tokenizerConfig: unknown): JuliaEncoder {
  const source = tokenizerJson as Record<string, unknown>;
  const pre = source?.pre_tokenizer as Record<string, unknown>;
  if (pre?.type !== "Metaspace" || pre.replacement !== "▁" || pre.split !== true || pre.prepend_scheme !== "always") throw new Error("Unsupported Julia tokenizer");
  const adapted = { ...source, pre_tokenizer: { type: "Sequence", pretokenizers: [pre, { type: "Split", pattern: { Regex: "▁[^▁]*" }, invert: true }] } };
  const tokenizer = new Tokenizer(adapted as ConstructorParameters<typeof Tokenizer>[0], tokenizerConfig as ConstructorParameters<typeof Tokenizer>[1]);
  const tokenize = (text: string): number[] => tokenizer.encode(text, { add_special_tokens: false }).ids;
  return Object.freeze({ encode(request: JuliaDecisionRequest, bounds: { maxLength?: number; headLength?: number } = {}): JuliaEncodedRequest {
    const maxLength = bounds.maxLength ?? 1024, headLength = bounds.headLength ?? 256;
    if (!Number.isSafeInteger(maxLength) || maxLength < 32 || maxLength > 8192 || !Number.isSafeInteger(headLength) || headLength < 64 || headLength + 4 >= maxLength) throw new Error("Invalid Julia context bounds");
    const qtype = { choice: 0, score: 1, noul: 2 }[request.type] as 0 | 1 | 2 | undefined;
    if (qtype === undefined || !validText(request.question) || !Array.isArray(request.options) || request.options.length < 2 || request.options.length > 20 || request.options.some(option => !validText(option) || !option.length) || qtype === 2 && request.options.length !== 2) throw new Error("Invalid Julia decision request");
    const state = stateText(request.state);
    const head = tokenize(`${request.type} question: ${request.question}`);
    const options = request.options.map(option => tokenize(` ${option}`));
    if (options.some(option => option.length > 48)) throw new Error("Julia option exceeds 48-token contract");
    const budget = headLength - options.reduce((total, option) => total + option.length + 1, 0);
    // The vendor reduces long options when the head has under 16 tokens left.
    // Strict mode accepts that branch only when no supplied option would change.
    const cap = Math.max(4, Math.floor((headLength - 16) / options.length));
    if (head.length > budget || budget < 16 && options.some(option => option.length + 1 > cap)) throw new Error("Julia question/options exceed lossless head budget");
    const ids = [2, ...head, 1], markers: number[] = [];
    for (const option of options) { markers.push(ids.length); ids.push(4, ...option); }
    ids.push(1);
    const stateIds = tokenize(state);
    if (maxLength - ids.length - 1 < 1 || stateIds.length > maxLength - ids.length - 1) throw new Error("Julia state exceeds lossless context budget");
    ids.push(...stateIds, 1);
    return { ids, markers, qtype };
  } });
}

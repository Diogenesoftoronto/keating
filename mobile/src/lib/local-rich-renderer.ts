import {
  WEB_MERMAID_GRAMMARS,
  detectSupportedMermaidGrammar,
  type MermaidParityFixture,
} from "@keating/learner-contracts";

export const MAX_MERMAID_SOURCE_LENGTH = 16_384;
export const MAX_MERMAID_LINES = 512;
export const MAX_MATH_SOURCE_LENGTH = 4_096;
export const MAX_CODE_LANGUAGE_LENGTH = 48;

type MermaidGrammar = MermaidParityFixture["grammar"];

export type RichSourceValidation<T extends string = string> =
  | { ok: true; source: string; kind: T }
  | { ok: false; source: string; reason: string };

export type MathSegment =
  | { kind: "text"; value: string }
  | { kind: "inline-math"; value: string; source: string }
  | { kind: "display-math"; value: string; source: string }
  | { kind: "malformed-math"; value: string; source: string };

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;
const MERMAID_FORBIDDEN = [
  { pattern: /%%\s*\{/iu, reason: "Mermaid initialization directives are not allowed." },
  { pattern: /\b(?:click|callback|call|href|link|url)\b/iu, reason: "Interactive Mermaid links and callbacks are not allowed." },
  { pattern: /\b(?:javascript|vbscript|data|file|https?|ftp):/iu, reason: "Mermaid URLs are not allowed." },
  { pattern: /(?:^|\s)(?:import|script|style)\b/imu, reason: "Mermaid import, script, and style statements are not allowed." },
  { pattern: /<\/?[A-Za-z!][^>]*>|&lt;\/?[A-Za-z!]/iu, reason: "HTML is not allowed in Mermaid source." },
  { pattern: /\bon[a-z]+\s*=/iu, reason: "HTML event handlers are not allowed in Mermaid source." },
  { pattern: /(?:^|[^:])\/\/[A-Za-z0-9.-]+/u, reason: "Network locations are not allowed in Mermaid source." },
] as const;

const MATH_FORBIDDEN = [
  /<\/?[A-Za-z!][^>]*>/u,
  /\b(?:javascript|vbscript|data|file|https?|ftp):/iu,
  /\\(?:href|url|htmlClass|htmlId|htmlStyle|includegraphics|input|include|write|read|openout|catcode|newcommand|renewcommand|def)\b/u,
] as const;

export function validateLocalMermaidSource(source: string): RichSourceValidation<MermaidGrammar> {
  if (!source.trim()) return { ok: false, source, reason: "The Mermaid source is empty." };
  if (source.length > MAX_MERMAID_SOURCE_LENGTH) return { ok: false, source, reason: "The Mermaid source is too large to render safely." };
  if (CONTROL_CHARACTERS.test(source)) return { ok: false, source, reason: "The Mermaid source contains unsupported control characters." };
  const lines = source.split(/\r?\n/);
  if (lines.length > MAX_MERMAID_LINES || lines.some((line) => line.length > 1_024)) {
    return { ok: false, source, reason: "The Mermaid source exceeds the local rendering work limit." };
  }
  const kind = detectSupportedMermaidGrammar(source);
  if (!kind || !WEB_MERMAID_GRAMMARS.includes(kind)) {
    return { ok: false, source, reason: "This Mermaid grammar is not supported by the local renderer." };
  }
  for (const forbidden of MERMAID_FORBIDDEN) {
    if (forbidden.pattern.test(source)) return { ok: false, source, reason: forbidden.reason };
  }
  const statementCount = lines.reduce((total, line) => total + line.split(";").filter((entry) => entry.trim()).length, 0);
  if (statementCount > 768) return { ok: false, source, reason: "The Mermaid source exceeds the local rendering work limit." };
  return { ok: true, source, kind };
}

export function validateLocalMathSource(source: string): RichSourceValidation<"math"> {
  if (!source.trim()) return { ok: false, source, reason: "The math expression is empty." };
  if (source.length > MAX_MATH_SOURCE_LENGTH) return { ok: false, source, reason: "The math expression is too large to render safely." };
  if (CONTROL_CHARACTERS.test(source)) return { ok: false, source, reason: "The math expression contains unsupported control characters." };
  if (MATH_FORBIDDEN.some((pattern) => pattern.test(source))) {
    return { ok: false, source, reason: "The math expression contains commands that the local renderer does not allow." };
  }
  const expansionWork = (source.match(/\\(?:frac|sqrt|begin|left|right|over|underbrace|overset|underset)\b/gu) ?? []).length;
  if (expansionWork > 256 || source.split(/\r?\n/).length > 128) {
    return { ok: false, source, reason: "The math expression exceeds the local rendering work limit." };
  }
  return { ok: true, source, kind: "math" };
}

function escaped(value: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function closingDollar(value: string, start: number, delimiter: "$" | "$$"): number {
  for (let index = start; index <= value.length - delimiter.length; index += 1) {
    if (delimiter === "$" && value[index] === "\n") return -1;
    if (value.startsWith(delimiter, index) && !escaped(value, index)) return index;
  }
  return -1;
}

export function segmentMarkdownMath(value: string): MathSegment[] {
  const segments: MathSegment[] = [];
  let textStart = 0;
  let cursor = 0;
  const pushText = (end: number) => {
    if (end > textStart) segments.push({ kind: "text", value: value.slice(textStart, end) });
  };
  while (cursor < value.length) {
    if (value[cursor] !== "$" || escaped(value, cursor)) { cursor += 1; continue; }
    pushText(cursor);
    const delimiter = value.startsWith("$$", cursor) ? "$$" as const : "$" as const;
    const end = closingDollar(value, cursor + delimiter.length, delimiter);
    if (end < 0) {
      const source = value.slice(cursor);
      segments.push({ kind: "malformed-math", value: source.slice(delimiter.length), source });
      return segments;
    }
    const source = value.slice(cursor, end + delimiter.length);
    const expression = value.slice(cursor + delimiter.length, end);
    segments.push({ kind: delimiter === "$$" ? "display-math" : "inline-math", value: expression, source });
    cursor = end + delimiter.length;
    textStart = cursor;
  }
  pushText(value.length);
  return segments.length ? segments : [{ kind: "text", value }];
}

export function normalizeCodeLanguage(language: string | undefined): string | null {
  const normalized = language?.trim().split(/\s+/, 1)[0]?.replace(/[^A-Za-z0-9_+.#-]/gu, "").slice(0, MAX_CODE_LANGUAGE_LENGTH) ?? "";
  return normalized || null;
}

export function codePresentationLabel(language: string | undefined): string {
  const normalized = normalizeCodeLanguage(language);
  return normalized ? `${normalized} code` : "Code";
}

export interface LocalNavigationRequest { url: string }

/** Allow the wrapper's first local document load and exact reloads; deny every later destination. */
export function createInitialDocumentNavigationGuard(): (request: LocalNavigationRequest) => boolean {
  let initialDocument: string | null = null;
  return ({ url }) => {
    if (!initialDocument) {
      initialDocument = url.split("#", 1)[0] ?? url;
      return true;
    }
    return (url.split("#", 1)[0] ?? url) === initialDocument;
  };
}

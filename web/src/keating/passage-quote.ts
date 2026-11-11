/**
 * Passage-anchored quotes in learner turns.
 *
 * A quote is a W3C TextQuoteSelector-style anchor: the exact passage plus a
 * little surrounding context, and the source it came from. Sources are any
 * element carrying `data-quote-source-kind` and `data-quote-source-id` (a
 * tutor message, a study plan, a concept map, a document reader).
 *
 * In a learner turn the quotes are written as readable Markdown first (so the
 * model, exports and shared transcripts read naturally) followed by one HTML
 * comment that carries the anchors:
 *
 *   From Keating's reply:
 *   > the quoted passage
 *
 *   The learner's question
 *
 *   <!-- keating-quotes v1 {"quotes":[{"source":{...},"prefix":"…","suffix":"…"}]} -->
 *
 * Parsing is strict: anything that does not validate is treated as ordinary
 * text, and `passageQuoteDisplayText` strips a stray anchor comment so raw
 * markup is never shown.
 */

export const QUOTE_SOURCE_KINDS = ["message", "artifact", "document"] as const;
export type QuoteSourceKind = (typeof QUOTE_SOURCE_KINDS)[number];

export const MAX_QUOTE_LENGTH = 1_000;
export const MAX_QUOTE_CONTEXT = 48;
export const MAX_QUOTE_LABEL = 80;
export const MAX_QUOTE_SOURCE_ID = 200;
export const MAX_QUOTES_PER_TURN = 3;

export const REVEAL_QUOTE_SOURCE_EVENT = "keating:reveal-quote-source";

export interface QuoteSource {
	kind: QuoteSourceKind;
	id: string;
	revision?: number;
	label?: string;
}

export interface PassageQuote {
	source: QuoteSource;
	exact: string;
	prefix?: string;
	suffix?: string;
}

export interface RevealQuoteSourceDetail {
	kind: QuoteSourceKind;
	id: string;
	revision?: number;
	exact: string;
	prefix?: string;
	suffix?: string;
}

/** Collapse every run of whitespace to one space and trim. */
export function normalizeQuoteWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function clipAtCodePoint(text: string, max: number, fromEnd = false): string {
	if (text.length <= max) return text;
	let out = fromEnd ? text.slice(text.length - max) : text.slice(0, max);
	// Never split a surrogate pair.
	if (!fromEnd && /[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1);
	if (fromEnd && /^[\uDC00-\uDFFF]/.test(out)) out = out.slice(1);
	return out;
}

export function isQuoteSourceKind(value: unknown): value is QuoteSourceKind {
	return typeof value === "string" && (QUOTE_SOURCE_KINDS as readonly string[]).includes(value);
}

export function defaultQuoteSourceLabel(kind: QuoteSourceKind): string {
	return kind === "message" ? "Keating's reply" : kind === "artifact" ? "Workspace item" : "Document";
}

export function quoteSourceLabel(source: QuoteSource): string {
	return source.label || defaultQuoteSourceLabel(source.kind);
}

/**
 * Builds a bounded, whitespace-normalised quote. Returns null when there is
 * nothing to quote or the source is invalid. `truncated` says the passage was
 * cut to `MAX_QUOTE_LENGTH`.
 */
export function createPassageQuote(input: {
	source: { kind: unknown; id: unknown; revision?: unknown; label?: unknown };
	exact: string;
	prefix?: string;
	suffix?: string;
}): { quote: PassageQuote; truncated: boolean } | null {
	const source = sanitizeSource(input.source);
	if (!source) return null;
	const normalized = normalizeQuoteWhitespace(input.exact);
	if (!normalized) return null;
	const truncated = normalized.length > MAX_QUOTE_LENGTH;
	const exact = truncated ? clipAtCodePoint(normalized, MAX_QUOTE_LENGTH).trimEnd() : normalized;
	// Keep the boundary space: it tells resolve that the passage starts or ends
	// at a word break, which disambiguates "cat" from "concatenate".
	const prefix = input.prefix ? clipAtCodePoint(input.prefix.replace(/\s+/g, " ").replace(/^ /, ""), MAX_QUOTE_CONTEXT, true) : "";
	const suffix = !truncated && input.suffix ? clipAtCodePoint(input.suffix.replace(/\s+/g, " ").replace(/ $/, ""), MAX_QUOTE_CONTEXT) : "";
	return {
		quote: { source, exact, ...(prefix ? { prefix } : {}), ...(suffix ? { suffix } : {}) },
		truncated,
	};
}

function sanitizeSource(value: unknown): QuoteSource | null {
	if (!value || typeof value !== "object") return null;
	const raw = value as Record<string, unknown>;
	if (!isQuoteSourceKind(raw.kind)) return null;
	if (typeof raw.id !== "string") return null;
	const id = raw.id.trim();
	if (!id || id.length > MAX_QUOTE_SOURCE_ID || /[\u0000-\u001f]/.test(id)) return null;
	const source: QuoteSource = { kind: raw.kind, id };
	if (raw.revision !== undefined && raw.revision !== null && raw.revision !== "") {
		const revision = typeof raw.revision === "string" ? Number(raw.revision) : raw.revision;
		if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) return null;
		source.revision = revision;
	}
	if (typeof raw.label === "string") {
		const label = clipAtCodePoint(normalizeQuoteWhitespace(raw.label), MAX_QUOTE_LABEL);
		if (label) source.label = label;
	} else if (raw.label !== undefined && raw.label !== null) return null;
	return source;
}

// ---------------------------------------------------------------------------
// Resolve

export type QuoteResolution =
	| { status: "found"; start: number; end: number }
	| { status: "outdated" };

function occurrences(haystack: string, needle: string): number[] {
	const found: number[] = [];
	if (!needle) return found;
	for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) found.push(at);
	return found;
}

function commonSuffixLength(a: string, b: string): number {
	let n = 0;
	while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
	return n;
}

function commonPrefixLength(a: string, b: string): number {
	let n = 0;
	while (n < a.length && n < b.length && a[n] === b[n]) n++;
	return n;
}

/**
 * Finds the quoted passage in the source's current text. Offsets are in the
 * whitespace-normalised text (`normalizeQuoteWhitespace(currentText)`). When
 * the passage repeats, the occurrence whose surroundings best match the
 * recorded prefix/suffix wins; a tie that context cannot break is reported as
 * outdated rather than guessed.
 */
export function resolveQuote(anchor: PassageQuote, currentText: string): QuoteResolution {
	const text = normalizeQuoteWhitespace(currentText);
	const exact = normalizeQuoteWhitespace(anchor.exact);
	const matches = occurrences(text, exact);
	if (matches.length === 0) return { status: "outdated" };
	if (matches.length === 1) return { status: "found", start: matches[0]!, end: matches[0]! + exact.length };
	const prefix = anchor.prefix ?? "";
	const suffix = anchor.suffix ?? "";
	const scored = matches.map((start) => {
		const end = start + exact.length;
		// Compare against the raw neighbourhood with a leading/trailing space
		// boundary so normalisation at the text edges does not skew scores.
		const before = ` ${text.slice(Math.max(0, start - prefix.length - 1), start)}`;
		const after = `${text.slice(end, end + suffix.length + 1)} `;
		return { start, end, score: commonSuffixLength(before, prefix) + commonPrefixLength(after, suffix) };
	});
	scored.sort((a, b) => b.score - a.score);
	if (scored[0]!.score === scored[1]!.score) return { status: "outdated" };
	return { status: "found", start: scored[0]!.start, end: scored[0]!.end };
}

// ---------------------------------------------------------------------------
// Serialise / parse

const ANCHOR_COMMENT = /\n*<!-- keating-quotes v1 (\{[\s\S]*?\}) -->\s*$/;
const ANY_ANCHOR_COMMENT = /\n*<!-- keating-quotes[\s\S]*?-->\s*/g;

export interface QuotedLearnerTurn {
	quotes: PassageQuote[];
	/** What the learner typed; empty when they sent only the quote. */
	question: string;
}

function headerLine(quote: PassageQuote): string {
	return `From ${quoteSourceLabel(quote.source)}:`;
}

function encodeAnchorJson(value: unknown): string {
	// `--` must not appear inside an HTML comment; the escape is valid JSON.
	return JSON.stringify(value).replace(/-(?=-)/g, "\\u002d").replace(/>/g, "\\u003e");
}

/** The learner turn text sent to the model and saved with the session. */
export function serializeQuotedTurn(turn: QuotedLearnerTurn): string {
	const quotes = turn.quotes.slice(0, MAX_QUOTES_PER_TURN);
	if (quotes.length === 0) return turn.question;
	const body = quotes.map((quote) => `${headerLine(quote)}\n> ${normalizeQuoteWhitespace(quote.exact)}`).join("\n\n");
	const anchors = {
		quotes: quotes.map((quote) => ({
			source: quote.source,
			...(quote.prefix ? { prefix: quote.prefix } : {}),
			...(quote.suffix ? { suffix: quote.suffix } : {}),
		})),
	};
	const question = turn.question.trim();
	return `${body}\n\n${question ? `${question}\n\n` : ""}<!-- keating-quotes v1 ${encodeAnchorJson(anchors)} -->`;
}

/**
 * Parses a learner turn written by `serializeQuotedTurn`. Returns null for
 * anything else, including tampered or out-of-bounds envelopes. Never throws.
 */
export function parseQuotedTurn(text: string): QuotedLearnerTurn | null {
	if (typeof text !== "string" || text.length > 64_000) return null;
	const match = text.match(ANCHOR_COMMENT);
	if (!match) return null;
	let anchors: unknown;
	try {
		anchors = JSON.parse(match[1]!);
	} catch {
		return null;
	}
	if (!anchors || typeof anchors !== "object") return null;
	const list = (anchors as { quotes?: unknown }).quotes;
	if (!Array.isArray(list) || list.length === 0 || list.length > MAX_QUOTES_PER_TURN) return null;
	let rest = text.slice(0, match.index);
	const quotes: PassageQuote[] = [];
	for (let index = 0; index < list.length; index++) {
		const item = list[index] as Record<string, unknown> | null;
		if (!item || typeof item !== "object") return null;
		const source = sanitizeSource(item.source);
		if (!source) return null;
		for (const key of ["prefix", "suffix"] as const) {
			const value = item[key];
			if (value !== undefined && (typeof value !== "string" || value.length > MAX_QUOTE_CONTEXT + 8)) return null;
		}
		const header = `From ${quoteSourceLabel(source)}:\n> `;
		if (!rest.startsWith(header)) return null;
		rest = rest.slice(header.length);
		const lineEnd = rest.indexOf("\n");
		const exact = lineEnd === -1 ? rest : rest.slice(0, lineEnd);
		if (!exact || exact !== normalizeQuoteWhitespace(exact) || exact.length > MAX_QUOTE_LENGTH) return null;
		rest = lineEnd === -1 ? "" : rest.slice(lineEnd);
		if (index < list.length - 1) {
			if (!rest.startsWith("\n\n")) return null;
			rest = rest.slice(2);
		}
		quotes.push({
			source,
			exact,
			...(typeof item.prefix === "string" && item.prefix ? { prefix: item.prefix } : {}),
			...(typeof item.suffix === "string" && item.suffix ? { suffix: item.suffix } : {}),
		});
	}
	if (rest && !/^\n\n/.test(rest)) return null;
	return { quotes, question: rest.trim() };
}

/** Readable text for any learner turn: never shows the anchor comment. */
export function passageQuoteDisplayText(text: string): string {
	if (typeof text !== "string") return "";
	return text.replace(ANY_ANCHOR_COMMENT, "\n").trim();
}

/**
 * One-line text for titles, previews and search. The learner's own question
 * leads, so a session opened with a quote is named after what was asked, not
 * after "From Keating's reply". Text without quotes is returned unchanged.
 */
export function passageQuoteSummaryText(text: string): string {
	if (typeof text !== "string") return "";
	const turn = parseQuotedTurn(text);
	if (!turn) return text.includes("<!-- keating-quotes") ? passageQuoteDisplayText(text) : text;
	const passages = turn.quotes.map((quote) => `“${quote.exact}”`).join(" ");
	return turn.question ? `${turn.question} ${passages}` : `About ${passages}`;
}

export function revealQuoteSourceDetail(quote: PassageQuote): RevealQuoteSourceDetail {
	return {
		kind: quote.source.kind,
		id: quote.source.id,
		...(quote.source.revision !== undefined ? { revision: quote.source.revision } : {}),
		exact: quote.exact,
		...(quote.prefix ? { prefix: quote.prefix } : {}),
		...(quote.suffix ? { suffix: quote.suffix } : {}),
	};
}

/** Short single-line preview for chips. */
export function truncateQuoteForPreview(text: string, max = 140): string {
	const normalized = normalizeQuoteWhitespace(text);
	return normalized.length <= max ? normalized : `${clipAtCodePoint(normalized, max - 1).trimEnd()}…`;
}

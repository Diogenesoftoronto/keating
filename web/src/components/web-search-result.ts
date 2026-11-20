export interface WebSearchSite {
	title?: string;
	url: string;
	snippet?: string;
}

export interface ParsedWebSearch {
	query?: string;
	sites: WebSearchSite[];
	text: string;
	/** A completed search returned readable prose instead of a structured source envelope. */
	proseResult?: true;
}

const SEARCH_TOOL_NAMES = new Set([
	"web_search",
	"web_search_preview",
	"web_search_20250305",
	"google_grounding",
	"browser_search",
	"client-web-search",
]);

export function isWebSearchToolName(toolName: string): boolean {
	return SEARCH_TOOL_NAMES.has(toolName);
}

function lookupString(obj: unknown, keys: readonly string[]): string | undefined {
	if (!obj || typeof obj !== "object") return undefined;
	const record = obj as Record<string, unknown>;
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return undefined;
}

function queryFromArgs(args: unknown): string | undefined {
	return lookupString(args, ["query", "q", "search", "question"]);
}

function textFromContent(content: unknown): string | undefined {
	if (typeof content === "string") return content.trim() || undefined;
	if (!Array.isArray(content)) return undefined;
	const text = content
		.map((part) => {
			if (typeof part === "string") return part.trim();
			return lookupString(part, ["text", "message"]);
		})
		.filter((part): part is string => Boolean(part))
		.join("\n")
		.trim();
	return text || undefined;
}

function stringifyResult(result: unknown): string {
	if (result === undefined || result === null) return "";
	try {
		return JSON.stringify(
			result,
			(_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value),
			2,
		) ?? String(result);
	} catch {
		return String(result);
	}
}

function textFromResult(result: unknown): string {
	if (typeof result === "string") return result.trim();
	// Pi tool results arrive as the bare content array: [{ type: "text", text }].
	if (Array.isArray(result)) return textFromContent(result) ?? stringifyResult(result);
	if (!result || typeof result !== "object") return stringifyResult(result);
	const record = result as Record<string, unknown>;
	const details = record.details;
	const error = record.error;
	return (
		lookupString(result, ["text", "answer", "output", "message"]) ??
		textFromContent(record.content) ??
		lookupString(error, ["message", "text", "detail"]) ??
		(typeof error === "string" ? error.trim() : undefined) ??
		lookupString(details, ["text", "answer", "output", "message", "detail"]) ??
		textFromContent((details as Record<string, unknown> | undefined)?.content) ??
		stringifyResult(result)
	);
}

const SITE_ARRAY_KEYS = new Set([
	"citations",
	"results",
	"sources",
	"webresults",
	"web_results",
	"searchresults",
	"search_results",
]);
const SEARCH_ENVELOPE_KEYS = new Set(["content", "data", "details", "output", "payload", "response", "result", "search", "web", "web_search"]);

/** Walk the result object looking for a recognized array containing valid web citations. */
function findSiteArray(value: unknown, collectAll: boolean, depth = 0, mayAcceptArray = depth === 0): unknown[] | null {
	if (depth > 4 || !value || typeof value !== "object") return null;
	const array = Array.isArray(value);
	if (array && mayAcceptArray && value.some(item => normalizeSite(item, 0))) return value;
	const records: unknown[] = [];
	for (const [key, child] of Object.entries(value)) {
		const name = key.toLowerCase();
		const sourceCollection = !array && SITE_ARRAY_KEYS.has(name);
		if (collectAll && !array && !sourceCollection && !SEARCH_ENVELOPE_KEYS.has(name)) continue;
		const found = findSiteArray(child, collectAll, depth + 1, sourceCollection);
		if (!found) continue;
		if (!collectAll) return found;
		for (const record of found) records.push(record);
	}
	return records.length ? records : null;
}

function normalizeHttpUrl(value: string | undefined): string | undefined {
	if (!value) return undefined;
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:" ? value : undefined;
	} catch {
		return undefined;
	}
}

const DISPLAY_SNIPPET_CHARS = 240;

function normalizeSite(raw: unknown, snippetChars: number): WebSearchSite | null {
	if (!raw || typeof raw !== "object") return null;
	const record = raw as Record<string, unknown>;
	const url = normalizeHttpUrl(lookupString(record, ["url", "link", "uri", "href"]));
	if (!url) return null;
	const title = lookupString(record, ["title", "name"]);
	const snippet = lookupString(record, ["snippet", "description", "text"]);
	return { url, title, snippet: snippet?.slice(0, snippetChars) };
}

// URLs may contain balanced parentheses (Wikipedia's Mercury_(planet)); a
// <…>-wrapped link may contain any parenthesis at all.
const URL_BODY = String.raw`https?:\/\/(?:[^\s()<>"']|\([^\s()<>"']*\))+`;
const URL_PATTERN = new RegExp(String.raw`\[((?:[^\[\]]|\[[^\]]*\])+)\]\((?:<(https?:\/\/[^>\s]+)>|(${URL_BODY}))\)`, "g");
const BARE_URL_PATTERN = new RegExp(`(${URL_BODY})`, "g");
const SEARCH_PREAMBLE = /^UNTRUSTED WEB SEARCH RESULTS[^\n{]*/;

/** Exact URL references can select observed search passages for review. */
export function webUrlsInText(text: string): string[] {
	const references = new RegExp(`${URL_PATTERN.source}|(${URL_BODY})`, "g");
	return [...new Set(Array.from(text.matchAll(references), ([, , angle, link, bare]) => angle ?? link ?? bare.replace(/[.,;:!?]+$/, "")))];
}

function sitesFromText(text: string, limit = 8): WebSearchSite[] {
	const sites: WebSearchSite[] = [];
	let match: RegExpExecArray | null;
	URL_PATTERN.lastIndex = 0;
	while ((match = URL_PATTERN.exec(text)) !== null && sites.length < limit) {
		const target = match[2] ?? match[3];
		const url = normalizeHttpUrl(limit === Infinity ? target : target.replace(/[.,;:!?]+$/, ""));
		if (url) {
			sites.push({ url, title: match[1].trim() || undefined, snippet: undefined });
		}
	}
	if (limit === Infinity) {
		const linked = new Set(sites.map(site => site.url));
		for (const url of webUrlsInText(text)) {
			if (normalizeHttpUrl(url) && !linked.has(url)) sites.push({ url });
		}
	} else if (sites.length === 0) {
		BARE_URL_PATTERN.lastIndex = 0;
		while ((match = BARE_URL_PATTERN.exec(text)) !== null && sites.length < limit) {
			const url = normalizeHttpUrl(match[1].replace(/[.,;:!?<>]+$/, ""));
			if (url) sites.push({ url, title: undefined, snippet: undefined });
		}
	}
	return sites;
}

export function parseWebSearchResult(result: unknown, args: unknown, snippetChars: number | "complete" = DISPLAY_SNIPPET_CHARS): ParsedWebSearch {
	const complete = snippetChars === "complete";
	const length = complete ? Infinity : snippetChars;
	const query = queryFromArgs(args) ?? queryFromArgs(result);
	const text = textFromResult(result);
	let sites: WebSearchSite[] = [];
	const array = findSiteArray(result, complete);
	if (array) {
		sites = parseSiteArray(array, length);
	}
	let structuredText = Boolean(array);
	if (sites.length === 0 && text) {
		const payload = text.replace(SEARCH_PREAMBLE, "").trim();
		try {
			// Hosted search prefixes its JSON with an untrusted-content warning line.
			const parsedText = JSON.parse(payload) as unknown;
			structuredText = parsedText !== null && typeof parsedText === "object";
			const jsonArray = findSiteArray(parsedText, complete);
			if (jsonArray) sites = parseSiteArray(jsonArray, length);
		} catch {
			// Omit a broken provider envelope from review as well. A Markdown label remains prose.
			structuredText = SEARCH_PREAMBLE.test(text) || /^(?:\{|\[\s*[{\["])/u.test(payload);
		}
	}
	if (sites.length === 0 && !(complete && structuredText)) sites = sitesFromText(text, complete ? Infinity : 8);
	const normalized = sites.map(withoutUrlTitle);
	// A review groups all observed passages by URL. Cards keep their existing display limits.
	return { query, sites: complete ? normalized : [...new Map(normalized.map(site => [site.url, site])).values()].slice(0, 8), text,
		...(complete && text && !structuredText ? { proseResult: true as const } : {}) };
}

/** Providers fall back to the URL as a title; the card already shows the domain. */
function withoutUrlTitle(site: WebSearchSite): WebSearchSite {
	const title = site.title?.trim();
	if (!title || title === site.url || normalizeHttpUrl(title) === site.url) return { ...site, title: undefined };
	return site;
}

function parseSiteArray(value: unknown[], snippetChars = DISPLAY_SNIPPET_CHARS): WebSearchSite[] {
	const sites: WebSearchSite[] = [];
	for (const raw of value) {
		const site = normalizeSite(raw, snippetChars);
		if (site) sites.push(site);
	}
	return sites;
}

export function formatSites(sites: WebSearchSite[]): string {
	return sites.map((site, index) => `${index + 1}. ${site.title ?? site.url}`).join("\n");
}

export function hostOf(url: string): string {
	try {
		const parsed = new URL(url);
		const hostname = parsed.hostname
			.replace(/\.$/, "")
			.replace(/^www\./, "")
			.split(".")
			.map(decodePunycodeLabel)
			.join(".");
		return parsed.port ? `${hostname}:${parsed.port}` : hostname;
	} catch {
		return url.replace(/^https?:\/\//, "").split("/")[0] ?? url;
	}
}

/** Display IDN hosts (xn--mnchen-3ya.de) as people type them (münchen.de). RFC 3492. */
function decodePunycodeLabel(label: string): string {
	if (!/^xn--/i.test(label)) return label;
	const input = label.slice(4).toLowerCase();
	const base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700;
	const delimiter = input.lastIndexOf("-");
	const output = delimiter > 0 ? [...input.slice(0, delimiter)].map(c => c.codePointAt(0) ?? 0) : [];
	let n = 128, i = 0, bias = 72;
	for (let index = delimiter > 0 ? delimiter + 1 : 0; index < input.length;) {
		const oldi = i;
		for (let w = 1, k = base; ; k += base) {
			if (index >= input.length) return label;
			const code = input.charCodeAt(index++);
			const digit = code >= 48 && code < 58 ? code - 22 : code >= 97 && code < 123 ? code - 97 : base;
			if (digit >= base) return label;
			i += digit * w;
			const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
			if (digit < t) break;
			w *= base - t;
		}
		const length = output.length + 1;
		let delta = oldi === 0 ? Math.floor((i - oldi) / damp) : (i - oldi) >> 1;
		delta += Math.floor(delta / length);
		let k = 0;
		for (; delta > ((base - tMin) * tMax) >> 1; k += base) delta = Math.floor(delta / (base - tMin));
		bias = Math.floor(k + ((base - tMin + 1) * delta) / (delta + skew));
		n += Math.floor(i / length);
		if (n > 0x10ffff) return label;
		i %= length;
		output.splice(i++, 0, n);
	}
	return String.fromCodePoint(...output);
}


/** Only extract the explicit source footer emitted by the Codex stream bridge. */
export function splitSearchSources(text: string): { text: string; sites: WebSearchSite[] } {
  const marker = text.lastIndexOf("\n\nSources: ");
  if (marker < 0) return { text, sites: [] };
  const footer = text.slice(marker + 11);
  if (!/^\[[^\]]+\]\(<https?:\/\//.test(footer)) return { text, sites: [] };
  const sites = sitesFromText(footer);
  return sites.length ? { text: text.slice(0, marker), sites } : { text, sites: [] };
}

export type WebSearchCallState = "running" | "success" | "error";

export interface WebSearchCall extends ParsedWebSearch {
	id: string;
	state: WebSearchCallState;
}

interface MessagePartLike {
	type: string;
	text?: string;
	toolCallId?: string;
	toolName?: string;
	args?: unknown;
	result?: unknown;
	isError?: boolean;
}

function callState(part: MessagePartLike, hasResult: boolean): WebSearchCallState {
	if (part.isError) return "error";
	return hasResult ? "success" : "running";
}

/**
 * Group consecutive web-search tool calls in a message so several queries render
 * as one activity line. Reasoning and blank text between searches do not split a
 * run; prose the learner can read does.
 */
export function webSearchRuns(
	parts: readonly MessagePartLike[],
	hasResult: (result: unknown) => boolean,
): WebSearchCall[][] {
	const runs: WebSearchCall[][] = [];
	let current: WebSearchCall[] | null = null;
	parts.forEach((part, index) => {
		if (part.type === "tool-call" && part.toolName && isWebSearchToolName(part.toolName)) {
			const call: WebSearchCall = {
				...parseWebSearchResult(part.result, part.args),
				id: part.toolCallId ?? `search-${index}`,
				state: callState(part, hasResult(part.result)),
			};
			if (!current) runs.push((current = []));
			current.push(call);
			return;
		}
		if (part.type === "reasoning" || (part.type === "text" && !part.text?.trim())) return;
		current = null;
	});
	return runs;
}

/** Every distinct source across a message's searches, in first-seen order. */
export function citationsFromCalls(calls: readonly WebSearchCall[]): WebSearchSite[] {
	const byUrl = new Map<string, WebSearchSite>();
	for (const call of calls) {
		if (call.state !== "success") continue;
		for (const site of call.sites) if (!byUrl.has(site.url)) byUrl.set(site.url, site);
	}
	return [...byUrl.values()];
}

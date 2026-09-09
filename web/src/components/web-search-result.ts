export interface WebSearchSite {
	title?: string;
	url: string;
	snippet?: string;
}

export interface ParsedWebSearch {
	query?: string;
	sites: WebSearchSite[];
	text: string;
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

/** Walk the result object looking for a recognized array containing valid web citations. */
function findSiteArray(value: unknown, depth = 0, mayAcceptArray = depth === 0): unknown[] | null {
	if (depth > 4) return null;
	if (Array.isArray(value)) {
		if (mayAcceptArray && parseSiteArray(value).length > 0) return value;
		for (const item of value) {
			const found = findSiteArray(item, depth + 1, false);
			if (found) return found;
		}
		return null;
	}
	if (!value || typeof value !== "object") return null;
	const record = value as Record<string, unknown>;
	for (const key of Object.keys(record)) {
		const found = findSiteArray(record[key], depth + 1, SITE_ARRAY_KEYS.has(key.toLowerCase()));
		if (found) return found;
	}
	return null;
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

function normalizeSite(raw: unknown): WebSearchSite | null {
	if (!raw || typeof raw !== "object") return null;
	const record = raw as Record<string, unknown>;
	const url = normalizeHttpUrl(lookupString(record, ["url", "link", "uri", "href"]));
	if (!url) return null;
	const title = lookupString(record, ["title", "name"]);
	const snippet = lookupString(record, ["snippet", "description", "text"]);
	return { url, title, snippet: snippet?.slice(0, 240) };
}

const URL_PATTERN = /\[([^\]]+)\]\(<?(https?:\/\/[^)>\s]+)>?\)/g;
const BARE_URL_PATTERN = /(https?:\/\/[^\s<>"')]+)/g;

function sitesFromText(text: string): WebSearchSite[] {
	const sites: WebSearchSite[] = [];
	let match: RegExpExecArray | null;
	URL_PATTERN.lastIndex = 0;
	while ((match = URL_PATTERN.exec(text)) !== null && sites.length < 8) {
		const url = match[2].replace(/[.,;:!?]+$/, "");
		if (url.startsWith("http")) {
			sites.push({ url, title: match[1].trim() || undefined, snippet: undefined });
		}
	}
	if (sites.length === 0) {
		BARE_URL_PATTERN.lastIndex = 0;
		while ((match = BARE_URL_PATTERN.exec(text)) !== null && sites.length < 8) {
			const url = match[1].replace(/[.,;:!?<>]+$/, "");
			if (url.startsWith("http")) sites.push({ url, title: undefined, snippet: undefined });
		}
	}
	return sites;
}

export function parseWebSearchResult(result: unknown, args: unknown): ParsedWebSearch {
	const query = queryFromArgs(args) ?? queryFromArgs(result);
	const text = textFromResult(result);
	let sites: WebSearchSite[] = [];
	const array = findSiteArray(result);
	if (array) {
		sites = parseSiteArray(array);
	}
	if (sites.length === 0 && typeof result === "string") {
		try {
			const parsed = JSON.parse(result) as unknown;
			const jsonArray = findSiteArray(parsed);
			if (jsonArray) sites = parseSiteArray(jsonArray);
		} catch {
			/* not JSON — fall through */
		}
	}
	if (sites.length === 0 && text) {
		try {
			const parsedText = JSON.parse(text) as unknown;
			const jsonArray = findSiteArray(parsedText);
			if (jsonArray) sites = parseSiteArray(jsonArray);
		} catch {
			/* not JSON — fall through */
		}
	}
	if (sites.length === 0) sites = sitesFromText(text);
	return { query, sites: [...new Map(sites.map(site => [site.url, site])).values()].slice(0, 8), text };
}

function parseSiteArray(value: unknown[]): WebSearchSite[] {
	const sites: WebSearchSite[] = [];
	for (const raw of value) {
		const site = normalizeSite(raw);
		if (site) sites.push(site);
	}
	return sites;
}

export function formatSites(sites: WebSearchSite[]): string {
	return sites.map((site, index) => `${index + 1}. ${site.title ?? site.url}`).join("\n");
}

export function hostOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url.replace(/^https?:\/\//, "").split("/")[0] ?? url;
	}
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

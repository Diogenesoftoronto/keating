import { css } from "../../styled-system/css";
import { CircleAlert, CircleCheck, ExternalLink, Globe, Search } from "lucide-react";

/**
 * Dedicated "web search" pill, replacing the generic ToolPart chip for search
 * tools (`web_search`, `web_search_preview`, Google grounding, client adapter).
 *
 *  - running: amber pill with the query being searched
 *  - success: source list parsed from the tool result (details.citations,
 *             citations/results/sources arrays, markdown links, bare URLs)
 *  - error:   red pill with the failure message
 */

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

const URL_PATTERN = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
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
	return { query, sites: sites.slice(0, 8), text };
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

function hostOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url.replace(/^https?:\/\//, "").split("/")[0] ?? url;
	}
}

function SearchRunningPill({ toolName, query }: { toolName: string; query?: string }) {
	return (
		<div
			className={css({
				marginBlock: "0.5rem",
				width: "100%",
				borderRadius: "0.375rem",
				borderWidth: "1px",
				borderColor: "rgb(245 158 11 / 0.6)",
				backgroundColor: "rgb(245 158 11 / 0.08)",
				paddingInline: "0.75rem",
				paddingBlock: "0.5rem",
				fontSize: "0.75rem",
			})}
		>
			<div
				className={css({
					display: "flex",
					minWidth: 0,
					flexWrap: "wrap",
					alignItems: "center",
					gap: "0.5rem",
				})}
			>
				<span className={css({ display: "inline-flex", alignItems: "center", gap: "0.375rem", color: "rgb(217 119 6)", _dark: { color: "rgb(252 211 77)" } })}>
					<Search size={14} />
					<span className={css({ fontWeight: 600 })}>Searching the web</span>
				</span>
				<span
					className={css({
						maxWidth: "100%",
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
						borderRadius: "0.25rem",
						backgroundColor: "color-mix(in srgb, var(--background) 70%, transparent)",
						paddingInline: "0.375rem",
						paddingBlock: "0.125rem",
						fontFamily: "var(--mono-body)",
						color: "var(--foreground)",
					})}
				>
					{query ?? toolName}
				</span>
				<span
					className={css({
						marginLeft: "auto",
						flexShrink: 0,
						textTransform: "uppercase",
						letterSpacing: "0.025em",
						color: "rgb(217 119 6)",
						_dark: { color: "rgb(252 211 77)" },
					})}
				>
					searching
				</span>
			</div>
		</div>
	);
}

function SearchErrorPill({ query, message }: { query?: string; message: string }) {
	return (
		<div
			className={css({
				marginBlock: "0.5rem",
				width: "100%",
				borderRadius: "0.375rem",
				borderWidth: "1px",
				borderColor: "color-mix(in srgb, var(--destructive) 60%, transparent)",
				backgroundColor: "color-mix(in srgb, var(--destructive) 10%, transparent)",
				color: "var(--destructive)",
				paddingInline: "0.75rem",
				paddingBlock: "0.5rem",
				fontSize: "0.75rem",
			})}
		>
			<div className={css({ display: "flex", minWidth: 0, flexWrap: "wrap", alignItems: "center", gap: "0.5rem" })}>
				<CircleAlert size={14} />
				<span className={css({ fontWeight: 500 })}>Search failed</span>
				{query && (
					<span
						className={css({
							maxWidth: "100%",
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
							borderRadius: "0.25rem",
							backgroundColor: "color-mix(in srgb, var(--background) 70%, transparent)",
							paddingInline: "0.375rem",
							paddingBlock: "0.125rem",
							fontFamily: "var(--mono-body)",
						})}
					>
						{query}
					</span>
				)}
			</div>
			{message && (
				<div
					className={css({
						marginTop: "0.375rem",
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
						fontFamily: "var(--mono-body)",
						color: "color-mix(in srgb, var(--destructive) 80%, transparent)",
					})}
				>
					{message}
				</div>
			)}
		</div>
	);
}

const SITE_COLORS = [
	"rgb(16 185 129 / 0.85)",
	"rgb(59 130 246 / 0.85)",
	"rgb(245 158 11 / 0.85)",
	"rgb(168 85 247 / 0.85)",
	"rgb(236 72 153 / 0.85)",
	"rgb(14 165 233 / 0.85)",
];

function SiteList({ sites, query }: { sites: WebSearchSite[]; query?: string }) {
	if (sites.length === 0) {
		return (
			<div
				className={css({
					marginTop: "0.5rem",
					fontSize: "0.75rem",
					color: "var(--muted-foreground)",
					fontFamily: "var(--mono-body)",
				})}
			>
				No sources returned for{query ? ` "${query}"` : " this query"}.
			</div>
		);
	}
	return (
		<div className={css({ marginTop: "0.5rem", display: "grid", gap: "0.375rem" })}>
			{sites.map((site, index) => {
				const host = hostOf(site.url);
				const initial = (site.title ?? host)[0]?.toUpperCase() ?? "?";
				const color = SITE_COLORS[index % SITE_COLORS.length];
				return (
					<a
						key={`${site.url}-${index}`}
						href={site.url}
						target="_blank"
						rel="noopener noreferrer"
						className={css({
							display: "grid",
							gridTemplateColumns: "1.5rem minmax(0, 1fr)",
							gap: "0.5rem",
							alignItems: "flex-start",
							borderRadius: "0.375rem",
							padding: "0.25rem 0.375rem",
							textDecoration: "none",
							_hover: { backgroundColor: "color-mix(in srgb, var(--foreground) 6%, transparent)" },
						})}
					>
						<span
							className={css({
								display: "inline-flex",
								width: "1.5rem",
								height: "1.5rem",
								alignItems: "center",
								justifyContent: "center",
								borderRadius: "0.375rem",
								fontSize: "0.625rem",
								fontWeight: 700,
								color: "white",
								backgroundColor: color,
								flexShrink: 0,
								userSelect: "none",
							})}
						>
							{initial}
						</span>
						<span className={css({ minWidth: 0 })}>
							<span
								className={css({
									display: "flex",
									alignItems: "center",
									gap: "0.25rem",
									fontSize: "0.75rem",
									fontWeight: 500,
									color: "var(--foreground)",
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
									_hover: { textDecoration: "underline" },
								})}
							>
								<span className={css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 })}>
									{site.title ?? site.url}
								</span>
								<ExternalLink size={11} className={css({ flexShrink: 0, color: "var(--muted-foreground)" })} />
							</span>
							<span
								className={css({
									display: "block",
									fontSize: "0.6875rem",
									fontFamily: "var(--mono-body)",
									color: "var(--muted-foreground)",
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								})}
							>
								{host}
							</span>
							{site.snippet && (
								<span
									className={css({
										display: "-webkit-box",
										WebkitLineClamp: 2,
										overflow: "hidden",
										marginTop: "0.125rem",
										fontSize: "0.6875rem",
										lineHeight: "0.9375rem",
										color: "color-mix(in srgb, var(--foreground) 75%, var(--muted-foreground))",
									})}
								>
									{site.snippet}
								</span>
							)}
						</span>
					</a>
				);
			})}
		</div>
	);
}

function SearchDonePill({ query, sites }: { query?: string; sites: WebSearchSite[] }) {
	return (
		<div
			className={css({
				marginBlock: "0.5rem",
				width: "100%",
				borderRadius: "0.375rem",
				borderWidth: "1px",
				borderColor: "rgb(16 185 129 / 0.5)",
				backgroundColor: "rgb(16 185 129 / 0.05)",
				paddingInline: "0.75rem",
				paddingBlock: "0.5rem",
				fontSize: "0.75rem",
			})}
		>
			<div className={css({ display: "flex", minWidth: 0, flexWrap: "wrap", alignItems: "center", gap: "0.5rem" })}>
				<span className={css({ display: "inline-flex", alignItems: "center", gap: "0.375rem" })}>
					<Globe size={14} />
					<span className={css({ fontWeight: 600 })}>Web search</span>
				</span>
				{query && (
					<span
						className={css({
							maxWidth: "100%",
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
							borderRadius: "0.25rem",
							backgroundColor: "color-mix(in srgb, var(--background) 70%, transparent)",
							paddingInline: "0.375rem",
							paddingBlock: "0.125rem",
							fontFamily: "var(--mono-body)",
						})}
					>
						{query}
					</span>
				)}
				<span
					className={css({
						marginLeft: "auto",
						display: "inline-flex",
						alignItems: "center",
						gap: "0.25rem",
						flexShrink: 0,
						textTransform: "uppercase",
						letterSpacing: "0.025em",
						color: "rgb(4 120 87)",
						_dark: { color: "rgb(110 231 183)" },
					})}
				>
					<CircleCheck size={12} />
					{sites.length > 0 ? `${sites.length} source${sites.length === 1 ? "" : "s"}` : "done"}
				</span>
			</div>
			<SiteList sites={sites} query={query} />
		</div>
	);
}

/** Props surface consumed by AssistantChatPanel (mirrors ToolPart props). */
export type WebSearchPartProps = {
	toolName: string;
	args?: unknown;
	result?: unknown;
	isError?: boolean;
	status?: { type: string };
};

export function WebSearchPart({
	toolName,
	args,
	result,
	isError,
}: WebSearchPartProps) {
	const query = queryFromArgs(args) ?? queryFromArgs(result);

	if (result === undefined) {
		return <SearchRunningPill toolName={toolName} query={query} />;
	}
	if (isError) {
		return <SearchErrorPill query={query} message={textFromResult(result) || "Tool call failed."} />;
	}
	const { sites, text } = parseWebSearchResult(result, args);
	return (
		<>
			<SearchDonePill query={query ?? ""} sites={sites} />
			{sites.length === 0 && text && (
				<div
					className={css({
						marginTop: "0.5rem",
						borderRadius: "0.375rem",
						borderWidth: "1px",
						borderColor: "var(--border)",
						backgroundColor: "color-mix(in srgb, var(--muted) 40%, transparent)",
						padding: "0.5rem 0.75rem",
						fontFamily: "var(--mono-body)",
						fontSize: "0.6875rem",
						lineHeight: "1rem",
						color: "var(--muted-foreground)",
						whiteSpace: "pre-wrap",
						overflowWrap: "break-word",
						maxHeight: "8rem",
						overflow: "auto",
					})}
				>
					{text}
				</div>
			)}
		</>
	);
}

/**
 * Wire protocol between a sandboxed interactive page and its host.
 *
 * Every value arriving from the frame is untrusted. These readers return a
 * typed message or `null`; they never throw and never coerce. The host drops
 * anything that does not parse. See document.ts for the threat model.
 */

export const INTERACTIVE_PAGE_LIMITS = {
	/** Model-authored HTML, UTF-8 bytes. Libraries are inlined separately and do not count. */
	maxHtmlBytes: 512 * 1024,
	maxTitleLength: 200,
	maxDescriptionLength: 2_000,
	minHeight: 80,
	/** Inline frame height cap; taller pages scroll inside the frame or use full screen. */
	maxInlineHeight: 2_000,
	/** Reported heights above this are treated as runaway layout and ignored. */
	maxReportedHeight: 20_000,
	maxStateBytes: 64 * 1024,
	maxShareSummaryLength: 2_000,
	maxShareDataBytes: 16 * 1024,
	maxScorePossible: 10_000,
	maxLinkLength: 2_048,
	maxErrorLength: 300,
	maxJsonDepth: 24,
	maxRequestIdLength: 64,
	/** No ready signal within this window means the page is shown as crashed. */
	readyTimeoutMs: 8_000,
} as const;

export const PAGE_MESSAGE_SOURCE = "keating-interactive-page";
export const HOST_MESSAGE_SOURCE = "keating-interactive-host";
export const PAGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface InteractiveShareResult {
	summary: string;
	data?: JsonValue;
	score?: { earned: number; possible: number };
	complete?: boolean;
}

export type PageMessage =
	| { type: "ready" }
	| { type: "height"; height: number }
	| { type: "state"; state: JsonValue }
	| { type: "share"; id: string; result: InteractiveShareResult }
	| { type: "open-link"; id: string; url: string }
	| { type: "escape" }
	| { type: "error"; message: string };

export type ShareRefusal = "no-gesture" | "rate-limited" | "invalid" | "disabled" | "unavailable";
export type LinkRefusal = "no-gesture" | "rate-limited" | "invalid";

export interface InteractivePageContext {
	appearance: "light" | "dark";
	variables: Record<string, string>;
	reducedMotion: boolean;
}

export type HostMessage =
	| { source: typeof HOST_MESSAGE_SOURCE; channel: string; type: "context"; context: InteractivePageContext }
	| { source: typeof HOST_MESSAGE_SOURCE; channel: string; type: "reply"; id: string; ok: true }
	| { source: typeof HOST_MESSAGE_SOURCE; channel: string; type: "reply"; id: string; ok: false; reason: ShareRefusal | LinkRefusal }
	| { source: typeof HOST_MESSAGE_SOURCE; channel: string; type: "state-saved"; ok: boolean };

const textEncoder = new TextEncoder();

export function utf8Bytes(value: string): number {
	return textEncoder.encode(value).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Accepts only plain JSON (structured clone would also carry Dates, Maps,
 * typed arrays and cycles). Returns the serialized form so callers can bound
 * the byte size without serializing twice.
 */
export function readBoundedJson(value: unknown, maxBytes: number): { value: JsonValue; serialized: string } | null {
	if (!isPlainJson(value, 0)) return null;
	let serialized: string;
	try {
		serialized = JSON.stringify(value);
	} catch {
		return null;
	}
	if (serialized === undefined || utf8Bytes(serialized) > maxBytes) return null;
	return { value: value as JsonValue, serialized };
}

function isPlainJson(value: unknown, depth: number): boolean {
	if (depth > INTERACTIVE_PAGE_LIMITS.maxJsonDepth) return false;
	if (value === null || typeof value === "boolean" || typeof value === "string") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (Array.isArray(value)) return value.every((item) => isPlainJson(item, depth + 1));
	if (typeof value !== "object") return false;
	const proto = Object.getPrototypeOf(value);
	if (proto !== Object.prototype && proto !== null) return false;
	return Object.values(value as Record<string, unknown>).every((item) => isPlainJson(item, depth + 1));
}

export function readShareResult(value: unknown): InteractiveShareResult | null {
	if (!isRecord(value)) return null;
	const allowed = new Set(["summary", "data", "score", "complete"]);
	if (Object.keys(value).some((key) => !allowed.has(key))) return null;
	const { summary, data, score, complete } = value;
	if (typeof summary !== "string") return null;
	const trimmed = summary.trim();
	if (!trimmed || trimmed.length > INTERACTIVE_PAGE_LIMITS.maxShareSummaryLength) return null;
	const result: InteractiveShareResult = { summary: trimmed };
	if (data !== undefined) {
		const json = readBoundedJson(data, INTERACTIVE_PAGE_LIMITS.maxShareDataBytes);
		if (!json) return null;
		result.data = json.value;
	}
	if (score !== undefined) {
		if (!isRecord(score) || Object.keys(score).length !== 2) return null;
		const { earned, possible } = score;
		if (typeof earned !== "number" || typeof possible !== "number") return null;
		if (!Number.isFinite(earned) || !Number.isFinite(possible)) return null;
		if (possible <= 0 || possible > INTERACTIVE_PAGE_LIMITS.maxScorePossible || earned < 0 || earned > possible) return null;
		result.score = { earned, possible };
	}
	if (complete !== undefined) {
		if (typeof complete !== "boolean") return null;
		result.complete = complete;
	}
	return result;
}

/** http(s) only, no embedded credentials, bounded length. Returns the normalized href. */
export function readLinkUrl(value: unknown): string | null {
	if (typeof value !== "string" || value.length > INTERACTIVE_PAGE_LIMITS.maxLinkLength) return null;
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return null;
	if (url.username || url.password) return null;
	return url.href;
}

function readRequestId(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 && value.length <= INTERACTIVE_PAGE_LIMITS.maxRequestIdLength ? value : null;
}

/** Parses one frame message. `channel` is the per-load nonce baked into the document. */
export function readPageMessage(data: unknown, channel: string): PageMessage | null {
	if (!isRecord(data) || data.source !== PAGE_MESSAGE_SOURCE || data.channel !== channel) return null;
	switch (data.type) {
		case "ready":
			return { type: "ready" };
		case "escape":
			return { type: "escape" };
		case "height": {
			const height = data.height;
			if (typeof height !== "number" || !Number.isFinite(height) || height <= 0 || height > INTERACTIVE_PAGE_LIMITS.maxReportedHeight) return null;
			return { type: "height", height };
		}
		case "state": {
			const json = readBoundedJson(data.state, INTERACTIVE_PAGE_LIMITS.maxStateBytes);
			return json ? { type: "state", state: json.value } : null;
		}
		case "share": {
			const id = readRequestId(data.id);
			const result = readShareResult(data.result);
			return id && result ? { type: "share", id, result } : null;
		}
		case "open-link": {
			const id = readRequestId(data.id);
			const url = readLinkUrl(data.url);
			return id && url ? { type: "open-link", id, url } : null;
		}
		case "error": {
			if (typeof data.message !== "string") return null;
			return { type: "error", message: data.message.slice(0, INTERACTIVE_PAGE_LIMITS.maxErrorLength) };
		}
		default:
			return null;
	}
}

export function hostMessage<T extends Omit<HostMessage, "source" | "channel">>(channel: string, message: T): T & { source: typeof HOST_MESSAGE_SOURCE; channel: string } {
	return { source: HOST_MESSAGE_SOURCE, channel, ...message };
}

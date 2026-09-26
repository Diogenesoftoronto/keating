export type DiagnosticLevel = "info" | "warning" | "error";

export interface DiagnosticEntry {
	id: number;
	timestamp: string;
	level: DiagnosticLevel;
	source: string;
	message: string;
	metadata?: Record<string, string | number | boolean>;
}

export interface DiagnosticRuntimeSnapshot {
	appVersion: string;
	pathname: string;
	online: boolean | null;
	userAgent: string;
	platform: string;
	serviceWorkerAvailable: boolean;
	serviceWorkerControlled: boolean;
	localStorageAvailable: boolean;
	indexedDbAvailable: boolean;
}

const MAX_ENTRIES = 200;
const MAX_MESSAGE_LENGTH = 1_200;
const MAX_METADATA_LENGTH = 400;
const BLOCKED_METADATA_KEY = /(?:^|_)(?:api_?key|args?|authorization|body|callback|content|cookie|credential|password|prompt|reply|response|secret|token)(?:$|_)/i;

let entries: readonly DiagnosticEntry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
let captureInstalled = false;

function truncate(value: string, maximum: number): string {
	return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

function credentialFreeUrl(value: string): string {
	try {
		const url = new URL(value);
		url.username = "";
		url.password = "";
		url.search = "";
		url.hash = "";
		return url.toString();
	} catch {
		return value.split(/[?#]/, 1)[0].replace(/\/\/[^/@\s]+@/, "//[redacted]@");
	}
}

/** Remove credentials and URL parameters before text enters the in-memory log. */
export function sanitizeDiagnosticText(value: unknown, maximum = MAX_MESSAGE_LENGTH): string {
	let text = typeof value === "string" ? value : value instanceof Error ? `${value.name}: ${value.message}` : String(value);
	text = text
		.replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi, (url) => credentialFreeUrl(url))
		.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
		.replace(/\b(?:sk|pk|rk|sess|key)-[A-Za-z0-9_-]{8,}\b/gi, "[redacted-key]")
		.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{8,})?\b/g, "[redacted-token]")
		.replace(/(["']?(?:api[_-]?key|authorization|code|cookie|credential|password|refresh[_-]?token|secret|token)["']?\s*[:=]\s*)(["']?)[^\s,;&}"']+\2/gi, "$1[redacted]")
		.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]");
	return truncate(text, maximum);
}

function sanitizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, string | number | boolean> | undefined {
	if (!metadata) return undefined;
	const sanitized: Record<string, string | number | boolean> = {};
	for (const [key, value] of Object.entries(metadata)) {
		if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(key) || BLOCKED_METADATA_KEY.test(key)) continue;
		if (typeof value === "string") sanitized[key] = sanitizeDiagnosticText(value, MAX_METADATA_LENGTH);
		else if (typeof value === "number" && Number.isFinite(value)) sanitized[key] = value;
		else if (typeof value === "boolean") sanitized[key] = value;
	}
	return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

export function recordDiagnostic(
	level: DiagnosticLevel,
	source: string,
	message: unknown,
	metadata?: Record<string, unknown>,
): DiagnosticEntry {
	const entry: DiagnosticEntry = {
		id: nextId++,
		timestamp: new Date().toISOString(),
		level,
		source: sanitizeDiagnosticText(source, 80),
		message: sanitizeDiagnosticText(message),
		metadata: sanitizeMetadata(metadata),
	};
	entries = [...entries.slice(-(MAX_ENTRIES - 1)), entry];
	for (const listener of listeners) listener();
	return entry;
}

export function getDiagnosticsSnapshot(): readonly DiagnosticEntry[] {
	return entries;
}

export function subscribeDiagnostics(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function clearDiagnostics(): void {
	entries = [];
	for (const listener of listeners) listener();
}

function consoleMessage(args: unknown[]): string {
	return args.slice(0, 4).map((value) => {
		if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
		if (value instanceof Error) return `${value.name}: ${value.message}`;
		return value === null ? "null" : `[${Array.isArray(value) ? "Array" : "Object"}]`;
	}).join(" ");
}

/** Install privacy-filtered browser error capture once. No data is persisted or uploaded. */
export function installBrowserDiagnosticsCapture(): void {
	if (captureInstalled || typeof window === "undefined") return;
	captureInstalled = true;

	for (const level of ["warn", "error"] as const) {
		const original = console[level].bind(console);
		console[level] = (...args: unknown[]) => {
			original(...args);
			recordDiagnostic(level === "warn" ? "warning" : "error", `console.${level}`, consoleMessage(args));
		};
	}

	window.addEventListener("error", (event) => {
		recordDiagnostic("error", "window.error", event.error instanceof Error ? event.error : event.message || "Unhandled browser error", {
			filename: event.filename,
			line: event.lineno,
			column: event.colno,
		});
	});
	window.addEventListener("unhandledrejection", (event) => {
		recordDiagnostic("error", "unhandledrejection", event.reason instanceof Error ? event.reason : typeof event.reason === "string" ? event.reason : "Unhandled promise rejection");
	});
}

function storageAvailable(): boolean {
	try {
		return typeof localStorage !== "undefined";
	} catch {
		return false;
	}
}

export function readDiagnosticRuntimeSnapshot(): DiagnosticRuntimeSnapshot {
	const browser = typeof window !== "undefined";
	const nav = typeof navigator !== "undefined" ? navigator : undefined;
	return {
		appVersion: String(import.meta.env?.APP_VERSION ?? "dev"),
		pathname: browser ? sanitizeDiagnosticText(window.location.pathname, 300) : "",
		online: typeof nav?.onLine === "boolean" ? nav.onLine : null,
		userAgent: sanitizeDiagnosticText(nav?.userAgent ?? "", 500),
		platform: sanitizeDiagnosticText(nav?.platform ?? "", 100),
		serviceWorkerAvailable: Boolean(nav && "serviceWorker" in nav),
		serviceWorkerControlled: Boolean(nav?.serviceWorker?.controller),
		localStorageAvailable: storageAvailable(),
		indexedDbAvailable: typeof indexedDB !== "undefined",
	};
}

export function buildDiagnosticReport(options: {
	entries?: readonly DiagnosticEntry[];
	runtime?: DiagnosticRuntimeSnapshot;
	generatedAt?: string;
} = {}): string {
	const report = {
		schemaVersion: 1,
		generatedAt: options.generatedAt ?? new Date().toISOString(),
		notice: "Local, sanitized Keating diagnostics. Prompts, replies, tool payloads, credentials, and URL parameters are intentionally excluded.",
		runtime: options.runtime ?? readDiagnosticRuntimeSnapshot(),
		entries: options.entries ?? entries,
	};
	return `${JSON.stringify(report, null, 2)}\n`;
}

/** The published support address; the desktop external-link allowlist matches it. */
export const DIAGNOSTIC_SUPPORT_EMAIL = "help@keating.help";

const REPORT_ENDPOINT = "/api/diagnostics/report";
/** Matches the server route's own cap so the two ends agree on the limit. */
const MAX_REPORT_LENGTH = 200_000;
/**
 * `mailto:` URLs longer than a few kilobytes are truncated or refused by mail
 * clients, so the attached report is trimmed rather than dropped.
 */
const MAILTO_BODY_LIMIT = 1_800;

export type DiagnosticDelivery = "email" | "log";

/**
 * Build an `mailto:` link carrying the same sanitized report, for learners who
 * would rather email the problem than turn diagnostics on.
 */
export function diagnosticReportMailto(options: {
	summary: string;
	report?: string;
}): string {
	const report = options.report ?? buildDiagnosticReport();
	// Redact and trim in one pass: the mailto body leaves Keating entirely, so
	// it goes through the same sanitizer as the in-memory log.
	const trimmed = sanitizeDiagnosticText(report, MAILTO_BODY_LIMIT);
	const subject = sanitizeDiagnosticText(`Keating error report: ${options.summary}`, 160);
	const body = [
		"Sanitized Keating diagnostics are below. Prompts, replies, tool payloads, credentials, and URL parameters are excluded.",
		"",
		trimmed,
	].join("\n");
	return `mailto:${DIAGNOSTIC_SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * Send the report to Keating. Returns the server's accepted destination, or
 * false when the caller should offer the email fallback.
 */
export async function sendDiagnosticReport(options: {
	summary: string;
	report?: string;
	fetcher?: typeof fetch;
}): Promise<DiagnosticDelivery | false> {
	const report = options.report ?? buildDiagnosticReport();
	try {
		const response = await (options.fetcher ?? fetch)(REPORT_ENDPOINT, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				schemaVersion: 1,
				summary: sanitizeDiagnosticText(options.summary, 200),
				// Sent text is re-redacted so a caller cannot hand the server raw content.
				report: sanitizeDiagnosticText(report, MAX_REPORT_LENGTH),
			}),
		});
		if (!response.ok) return false;
		const payload: unknown = await response.json().catch(() => null);
		if (!payload || typeof payload !== "object") return false;
		const delivery = (payload as { delivery?: unknown }).delivery;
		return delivery === "email" || delivery === "log" ? delivery : false;
	} catch {
		return false;
	}
}

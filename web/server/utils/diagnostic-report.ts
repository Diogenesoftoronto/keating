import { readBoundedBody } from "./bounded-body";

/**
 * Receives sanitized crash diagnostics and delivers them to the Keating team.
 *
 * The browser redacts prompts, replies, tool payloads, credentials, and URL
 * parameters before anything is sent (see `web/src/lib/diagnostics.ts`). This
 * layer redacts again at the trust boundary, caps the payload, keeps only the
 * contract fields, and never lets a delivery failure drop a report: if email
 * is unavailable the report is logged instead.
 */

export class DiagnosticReportError extends Error {
	constructor(public statusCode: number, message: string) {
		super(message);
	}
}

export interface DiagnosticReportOptions {
	resendApiKey?: string;
	from?: string;
	to?: string;
	fetcher?: typeof fetch;
	logger?: (message: string) => void;
	beforeEmail?: () => Promise<void>;
}

export type DiagnosticDelivery = "email" | "log";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_REPORT_LENGTH = 200_000;
const SUBJECT_LIMIT = 140;

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

function sanitizeDiagnosticText(value: unknown, maximum: number): string {
	let text = typeof value === "string" ? value : String(value ?? "");
	text = text
		.replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi, (url) => credentialFreeUrl(url))
		.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
		.replace(/\b(?:sk|pk|rk|sess|key)-[A-Za-z0-9_-]{8,}\b/gi, "[redacted-key]")
		.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{8,})?\b/g, "[redacted-token]")
		.replace(/(["']?(?:api[_-]?key|authorization|code|cookie|credential|password|refresh[_-]?token|secret|token)["']?\s*[:=]\s*)(["']?)[^\s,;&}"']+\2/gi, "$1[redacted]")
		.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]");
	return text.length <= maximum ? text : `${text.slice(0, maximum - 1)}…`;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
	let bytes: Uint8Array;
	try {
		bytes = await readBoundedBody(request, MAX_BODY_BYTES);
	} catch (error) {
		const status = Number((error as { statusCode?: number }).statusCode);
		if (status === 413) throw new DiagnosticReportError(413, "The diagnostics report is too large.");
		if (status === 408) throw new DiagnosticReportError(408, "The diagnostics report timed out.");
		throw error;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch {
		throw new DiagnosticReportError(400, "Expected a diagnostics report.");
	}
	if (!parsed || typeof parsed !== "object") {
		throw new DiagnosticReportError(400, "Expected a diagnostics report.");
	}
	return parsed as Record<string, unknown>;
}

/** Keep only the fields the report contract defines; reject an empty report. */
export function normalizeDiagnosticReport(body: Record<string, unknown>): { summary: string; report: string } {
	const summary = sanitizeDiagnosticText(
		typeof body.summary === "string" && body.summary.trim() ? body.summary : "Unknown error",
		200,
	).trim() || "Unknown error";
	const report = sanitizeDiagnosticText(typeof body.report === "string" ? body.report : "", MAX_REPORT_LENGTH);
	if (!report.trim()) throw new DiagnosticReportError(400, "The diagnostics report was empty.");
	return { summary, report };
}

export async function deliverDiagnosticReport(
	request: Request,
	options: DiagnosticReportOptions = {},
): Promise<{ accepted: true; delivery: DiagnosticDelivery }> {
	const contentType = request.headers.get("content-type");
	if (contentType && !contentType.startsWith("application/json")) {
		throw new DiagnosticReportError(415, "Expected a JSON diagnostics report.");
	}

	const { summary, report } = normalizeDiagnosticReport(await readJsonBody(request));
	const log = options.logger ?? ((message: string) => console.warn(message));

	// A deployment without support mail still collects the report in its log
	// rather than silently dropping it.
	if (!options.resendApiKey || !options.from || !options.to) {
		log(`[diagnostics] ${summary}\n${report}`);
		return { accepted: true, delivery: "log" };
	}

	const fetcher = options.fetcher ?? fetch;
	let response: Response;
	try {
		await options.beforeEmail?.();
		response = await fetcher("https://api.resend.com/emails", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${options.resendApiKey}`,
				"User-Agent": "Keating-diagnostics/1.0",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				from: options.from,
				to: [options.to],
				subject: `Keating error report: ${summary}`.slice(0, SUBJECT_LIMIT),
				text: report,
				tags: [{ name: "purpose", value: "error_diagnostics_v1" }],
			}),
			signal: AbortSignal.timeout(8000),
		});
	} catch {
		log(`[diagnostics] email delivery failed for: ${summary}\n${report}`);
		return { accepted: true, delivery: "log" };
	}

	if (!response.ok) {
		log(`[diagnostics] email delivery refused (${response.status}) for: ${summary}\n${report}`);
		return { accepted: true, delivery: "log" };
	}
	return { accepted: true, delivery: "email" };
}

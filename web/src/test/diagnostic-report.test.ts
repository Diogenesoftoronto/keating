import { expect, test } from "bun:test";
import {
	deliverDiagnosticReport,
	DiagnosticReportError,
	normalizeDiagnosticReport,
} from "../../server/utils/diagnostic-report";
import { DIAGNOSTIC_SUPPORT_EMAIL, diagnosticReportMailto, sanitizeDiagnosticText, sendDiagnosticReport } from "../lib/diagnostics";

function report(body: unknown): Request {
	return new Request("https://keating.test/api/diagnostics/report", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

function resendFixture(status = 200) {
	const calls: Array<{ url: string; body: any }> = [];
	const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
		return Response.json({ id: "email" }, { status });
	}) as unknown as typeof fetch;
	return { calls, fetcher };
}

test("emails the report through Resend when support mail is configured", async () => {
	const { calls, fetcher } = resendFixture();
	const delivered = await deliverDiagnosticReport(report({ summary: "server: 502", report: "{\"entries\":[]}" }), {
		resendApiKey: "test-only",
		from: "Keating <hello@keating.test>",
		to: DIAGNOSTIC_SUPPORT_EMAIL,
		fetcher,
	});
	expect(delivered).toEqual({ accepted: true, delivery: "email" });
	expect(calls).toHaveLength(1);
	expect(calls[0].url).toBe("https://api.resend.com/emails");
	expect(calls[0].body.to).toEqual([DIAGNOSTIC_SUPPORT_EMAIL]);
	expect(calls[0].body.subject).toBe("Keating error report: server: 502");
	expect(calls[0].body.tags).toEqual([{ name: "purpose", value: "error_diagnostics_v1" }]);
});

test("keeps the report in the log instead of dropping it", async () => {
	const logged: string[] = [];
	// No mail configured.
	const unconfigured = await deliverDiagnosticReport(report({ summary: "unknown", report: "report-body" }), {
		logger: (message) => logged.push(message),
	});
	expect(unconfigured).toEqual({ accepted: true, delivery: "log" });
	expect(logged).toHaveLength(1);
	expect(logged[0]).toContain("report-body");

	// Configured but refused by the provider: the report still survives.
	const { fetcher } = resendFixture(422);
	const refused = await deliverDiagnosticReport(report({ summary: "unknown", report: "report-body" }), {
		resendApiKey: "test-only",
		from: "Keating <hello@keating.test>",
		to: DIAGNOSTIC_SUPPORT_EMAIL,
		fetcher,
		logger: (message) => logged.push(message),
	});
	expect(refused).toEqual({ accepted: true, delivery: "log" });
	expect(logged.at(-1)).toContain("report-body");
});

test("rejects an empty or oversized report", async () => {
	expect(() => normalizeDiagnosticReport({ summary: "unknown" })).toThrow(DiagnosticReportError);
	expect(() => normalizeDiagnosticReport({ summary: "unknown", report: "   " })).toThrow(DiagnosticReportError);
	const oversized = await deliverDiagnosticReport(report({ summary: "unknown", report: "x".repeat(300_000) }), {
		logger: () => {},
	}).catch((error) => error);
	expect(oversized).toBeInstanceOf(DiagnosticReportError);
	expect((oversized as DiagnosticReportError).statusCode).toBe(413);
});

test("builds a mailto fallback with the same sanitized report", () => {
	const href = diagnosticReportMailto({
		summary: "server: 502",
		report: "leaked sk-abcdefghijklmnop and Bearer abc123",
	});
	expect(href.startsWith(`mailto:${DIAGNOSTIC_SUPPORT_EMAIL}?`)).toBe(true);
	expect(decodeURIComponent(href)).toContain("Keating error report: server: 502");
	// The mailto body carries what the local redactor left behind.
	expect(decodeURIComponent(href)).toContain(sanitizeDiagnosticText("leaked sk-abcdefghijklmnop and Bearer abc123"));
	expect(decodeURIComponent(href)).not.toContain("sk-abcdefghijklmnop");
});

test("client exposes the server's accepted destination without claiming inbox delivery", async () => {
	const fetcher = (async () => Response.json({ accepted: true, delivery: "log" })) as unknown as typeof fetch;
	expect(await sendDiagnosticReport({ summary: "unknown", report: "sanitized", fetcher })).toBe("log");

	const refused = (async () => Response.json({ accepted: true, delivery: "email" }, { status: 503 })) as unknown as typeof fetch;
	expect(await sendDiagnosticReport({ summary: "unknown", report: "sanitized", fetcher: refused })).toBe(false);
});

test("server redacts credentials and addresses before logging or email", async () => {
	const logged: string[] = [];
	const result = await deliverDiagnosticReport(report({
		summary: "unknown token=secret",
		report: "Bearer raw-token email=user@example.com key=sk-abcdefghijklmnop callback=https://keating.test/auth?code=private",
	}), { logger: (message) => logged.push(message) });
	expect(result).toEqual({ accepted: true, delivery: "log" });
	expect(logged[0]).not.toContain("raw-token");
	expect(logged[0]).not.toContain("user@example.com");
	expect(logged[0]).not.toContain("private");
});

test("trims a mailto body that would exceed mail client limits", () => {
	const href = diagnosticReportMailto({ summary: "unknown", report: "y".repeat(10_000) });
	expect(href.length).toBeLessThan(6_000);
});

import { createError, defineEventHandler, setHeader } from "h3";
import { deliverDiagnosticReport, DiagnosticReportError } from "../../utils/diagnostic-report";
import { createWaitlistRateLimiter, CreditWaitlistError } from "../../utils/credit-waitlist";

// Per-process ceiling, independent of spoofable client IP headers. Apply before
// parsing or delivery, including log-only deployments. Replicas have separate budgets.
const limitReports = createWaitlistRateLimiter(Date.now, 30);

export default defineEventHandler(async (event) => {
	setHeader(event, "Cache-Control", "no-store");
	try {
		limitReports("public-diagnostics");
		return await deliverDiagnosticReport(event.req, {
			resendApiKey: process.env.RESEND_API_KEY,
			from: process.env.KEATING_DIAGNOSTICS_FROM ?? process.env.KEATING_WAITLIST_FROM,
			to: process.env.KEATING_DIAGNOSTICS_TO,
		});
	} catch (error) {
		if (error instanceof DiagnosticReportError || error instanceof CreditWaitlistError) {
			if (error.statusCode === 429) return Response.json(
				{ statusCode: 429, message: error.message },
				{ status: 429, headers: { "Retry-After": "900", "Cache-Control": "no-store" } },
			);
			throw createError({ statusCode: error.statusCode, statusMessage: error.message });
		}
		throw createError({ statusCode: 503, statusMessage: "Could not record the diagnostics report." });
	}
});

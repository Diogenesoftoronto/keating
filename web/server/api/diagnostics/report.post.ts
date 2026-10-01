import { createError, defineEventHandler, setHeader } from "h3";
import { deliverDiagnosticReport, DiagnosticReportError } from "../../utils/diagnostic-report";
import { consumePublicRateLimit, reservePublicQuota } from "../../utils/public-abuse";

export default defineEventHandler(async (event) => {
	setHeader(event, "Cache-Control", "no-store");
	try {
		await consumePublicRateLimit(event, { bucket: "diagnostics-global", key: "global", limit: 30, windowSeconds: 900 });
		return await deliverDiagnosticReport(event.req, {
			resendApiKey: process.env.RESEND_API_KEY,
			from: process.env.KEATING_DIAGNOSTICS_FROM ?? process.env.KEATING_WAITLIST_FROM,
			to: process.env.KEATING_DIAGNOSTICS_TO,
			beforeEmail: async () => { await reservePublicQuota({ bucket: "diagnostics-email", key: "global", amount: 1, limit: 200, windowSeconds: 86400 }); },
		});
	} catch (error) {
		if (error instanceof DiagnosticReportError) {
			if (error.statusCode === 429) return Response.json(
				{ statusCode: 429, message: error.message },
				{ status: 429, headers: { "Retry-After": "900", "Cache-Control": "no-store" } },
			);
			throw createError({ statusCode: error.statusCode, statusMessage: error.message });
		}
		if (error && typeof error === "object" && "statusCode" in error) throw error;
		throw createError({ statusCode: 503, statusMessage: "Could not record the diagnostics report." });
	}
});

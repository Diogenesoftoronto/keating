import { recordDiagnostic } from "./diagnostics";

/** Analytics delivery is optional. Keep failures visible locally without logging payloads. */
export function createAnalyticsRequestErrorHandler(now: () => number = Date.now) {
	let lastReportedAt = -Infinity;
	return (response: { statusCode: number }): void => {
		const timestamp = now();
		if (timestamp - lastReportedAt < 60_000) return;
		lastReportedAt = timestamp;
		const status = response.statusCode;
		recordDiagnostic("warning", "analytics", "Analytics delivery failed. This does not prevent chat or sign-in from working.", {
			status: Number.isInteger(status) && status >= 0 && status <= 599 ? status : 0,
		});
	};
}

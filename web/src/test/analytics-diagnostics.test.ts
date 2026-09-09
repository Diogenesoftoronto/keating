import { beforeEach, expect, it } from "bun:test";
import { createAnalyticsRequestErrorHandler } from "../lib/analytics-diagnostics";
import { clearDiagnostics, getDiagnosticsSnapshot } from "../lib/diagnostics";

beforeEach(clearDiagnostics);

it("records a local warning without exposing request errors or response bodies", () => {
	const report = createAnalyticsRequestErrorHandler();
	report({ statusCode: 0, error: new Error("private request"), text: "secret response" } as { statusCode: number });
	expect(getDiagnosticsSnapshot()).toHaveLength(1);
	expect(getDiagnosticsSnapshot()[0]).toMatchObject({ level: "warning", source: "analytics", metadata: { status: 0 } });
	expect(JSON.stringify(getDiagnosticsSnapshot())).not.toContain("private request");
	expect(JSON.stringify(getDiagnosticsSnapshot())).not.toContain("secret response");
});

it("bounds repeated failures without hiding a later failure", () => {
	let time = 0;
	const report = createAnalyticsRequestErrorHandler(() => time);
	for (let i = 0; i < 100; i++) report({ statusCode: 503 });
	time = 59_999;
	report({ statusCode: 502 });
	expect(getDiagnosticsSnapshot()).toHaveLength(1);
	time = 60_000;
	report({ statusCode: 401 });
	expect(getDiagnosticsSnapshot()).toHaveLength(2);
	expect(getDiagnosticsSnapshot()[1]?.metadata).toEqual({ status: 401 });
});

it("keeps malformed status values out of diagnostics", () => {
	createAnalyticsRequestErrorHandler()({ statusCode: NaN });
	expect(getDiagnosticsSnapshot()[0]?.metadata).toEqual({ status: 0 });
});

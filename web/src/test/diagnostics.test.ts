import { beforeEach, describe, expect, it } from "bun:test";
import {
	buildDiagnosticReport,
	clearDiagnostics,
	getDiagnosticsSnapshot,
	recordDiagnostic,
	sanitizeDiagnosticText,
	type DiagnosticRuntimeSnapshot,
} from "../lib/diagnostics";

describe("browser diagnostics", () => {
	beforeEach(clearDiagnostics);

	it("redacts credentials, callback parameters, and identifying addresses", () => {
		const sanitized = sanitizeDiagnosticText(
			"Bearer abc.def key=sk-supersecret123 callback=https://localhost:1455/auth/callback?code=oauth-code&state=state email=user@example.com",
		);
		expect(sanitized).not.toContain("abc.def");
		expect(sanitized).not.toContain("supersecret");
		expect(sanitized).not.toContain("oauth-code");
		expect(sanitized).not.toContain("state=state");
		expect(sanitized).not.toContain("user@example.com");
		expect(sanitized).toContain("https://localhost:1455/auth/callback");
	});

	it("keeps a bounded in-memory ring and drops sensitive metadata fields", () => {
		for (let index = 0; index < 205; index += 1) {
			recordDiagnostic("info", "test", `entry ${index}`, {
				model: "gpt-test",
				prompt: "private learner text",
				apiKey: "sk-secretsecret",
			});
		}
		const snapshot = getDiagnosticsSnapshot();
		expect(snapshot).toHaveLength(200);
		expect(snapshot[0]?.message).toBe("entry 5");
		expect(snapshot.at(-1)?.metadata).toEqual({ model: "gpt-test" });
	});

	it("builds a shareable report from an explicitly sanitized runtime snapshot", () => {
		recordDiagnostic("warning", "model", "Selection failed", { provider: "openai-codex" });
		const runtime: DiagnosticRuntimeSnapshot = {
			appVersion: "3.8.1",
			pathname: "/chat",
			online: true,
			userAgent: "test browser",
			platform: "test",
			serviceWorkerAvailable: true,
			serviceWorkerControlled: false,
			localStorageAvailable: true,
			indexedDbAvailable: true,
		};
		const report = JSON.parse(buildDiagnosticReport({ runtime, generatedAt: "2026-08-25T00:00:00.000Z" }));
		expect(report.schemaVersion).toBe(1);
		expect(report.runtime.pathname).toBe("/chat");
		expect(report.entries[0]).toMatchObject({ source: "model", metadata: { provider: "openai-codex" } });
		expect(report.notice).toContain("credentials");
	});
});

import { describe, expect, it } from "bun:test";
import type { DiagnosticEntry, DiagnosticRuntimeSnapshot } from "./diagnostics";
import { buildHealthChecks, cleanDiagnosticMessage, explainDiagnostic, groupProblems, overallStatus } from "./diagnostics-insights";

const runtime: DiagnosticRuntimeSnapshot = {
	appVersion: "t", pathname: "/", online: true, userAgent: "", platform: "",
	serviceWorkerAvailable: true, serviceWorkerControlled: false, localStorageAvailable: true, indexedDbAvailable: true,
};
const entry = (id: number, level: DiagnosticEntry["level"], source: string, message: string): DiagnosticEntry =>
	({ id, timestamp: `2026-01-01T00:00:0${id}Z`, level, source, message });

describe("diagnostics insights", () => {
	it("groups repeats and ignores info", () => {
		const groups = groupProblems([
			entry(1, "error", "auth", "Provider sign-in failed"),
			entry(2, "error", "auth", "Provider sign-in failed"),
			entry(3, "info", "auth", "Provider signed out"),
		]);
		expect(groups).toHaveLength(1);
		expect(groups[0].count).toBe(2);
		expect(groups[0].explanation.fix?.tab).toBe("models");
	});
	it("keeps unknown errors distinct by message", () => {
		expect(groupProblems([entry(1, "error", "x", "boom"), entry(2, "error", "x", "bang")])).toHaveLength(2);
	});
	it("flags a missing provider and offline state", () => {
		const checks = buildHealthChecks({ runtime: { ...runtime, online: false }, entries: [], connectedProviderCount: 0 });
		expect(checks.find((c) => c.id === "provider")?.fix?.tab).toBe("models");
		expect(overallStatus(checks)).toBe("problem");
	});
	it("is healthy when everything checks out", () => {
		expect(overallStatus(buildHealthChecks({ runtime, entries: [], connectedProviderCount: 1 }))).toBe("ok");
	});
	it("explains hook-order crashes as a reload and tidies raw messages", () => {
		const e = entry(1, "error", "browser", "React has detected a change in the order of Hooks called by %s");
		expect(explainDiagnostic(e).fix?.reload).toBe(true);
		expect(cleanDiagnosticMessage("%o %s   boom ^^^^ x")).toBe("boom x");
		expect(cleanDiagnosticMessage("a".repeat(300)).length).toBe(220);
	});
});

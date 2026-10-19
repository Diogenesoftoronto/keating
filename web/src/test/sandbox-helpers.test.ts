import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
	WORKSPACE_ROOT,
	commitMessageOrDefault,
	diffAgainstBaseline,
	errorMessage,
	failureBannerMessage,
	fileReadFailureContent,
	fmtBytes,
	formatJson,
	isAdvancedTab,
	parentDirectory,
	parseProbePayload,
	portableExportFilename,
	probeOutputOk,
	recentEventLabel,
	runtimeLabel,
	runtimeStatusLabel,
	shouldComputeDiffOnToggle,
	visibleChanges,
} from "../components/sandbox/sandbox-helpers";
import { executeProbe } from "../components/sandbox/sandbox-probe";

describe("parentDirectory", () => {
	test("walks up one level and floors at the workspace root", () => {
		expect(parentDirectory("/workspace/src/lib")).toBe("/workspace/src");
		expect(parentDirectory("/workspace/src")).toBe("/workspace");
		expect(parentDirectory("/workspace")).toBe(WORKSPACE_ROOT);
		expect(parentDirectory("/")).toBe(WORKSPACE_ROOT);
	});
	test("property: result is always an absolute path with one fewer segment", () => {
		fc.assert(
			fc.property(fc.array(fc.stringMatching(/^[a-z]{1,6}$/), { minLength: 1, maxLength: 5 }), (segments) => {
				const result = parentDirectory(`/${segments.join("/")}`);
				expect(result.startsWith("/")).toBe(true);
				const expected = segments.length === 1 ? WORKSPACE_ROOT : `/${segments.slice(0, -1).join("/")}`;
				expect(result).toBe(expected);
			}),
		);
	});
});

describe("file editor decisions", () => {
	test("diff is computed only when the toggle opens it", () => {
		expect(shouldComputeDiffOnToggle(false)).toBe(true);
		expect(shouldComputeDiffOnToggle(true)).toBe(false);
	});
	test("no baseline yields an empty diff", () => {
		expect(diffAgainstBaseline(null)).toEqual([]);
		expect(diffAgainstBaseline(undefined)).toEqual([]);
		expect(diffAgainstBaseline({ current: "x" })).toEqual([]);
	});
	test("identical baseline and current has no added or removed lines", () => {
		const lines = diffAgainstBaseline({ baseline: "a\nb", current: "a\nb" });
		expect(lines.some((l) => l.type === "added" || l.type === "removed")).toBe(false);
	});
	test("changed content reports added and removed lines", () => {
		const lines = diffAgainstBaseline({ baseline: "a\nb", current: "a\nc" });
		expect(lines.some((l) => l.type === "removed" && l.content === "b")).toBe(true);
		expect(lines.some((l) => l.type === "added" && l.content === "c")).toBe(true);
	});
	test("read failures render as a commented placeholder", () => {
		expect(fileReadFailureContent(new Error("nope"))).toBe("// Error reading file:\n// nope");
		expect(fileReadFailureContent("raw")).toBe("// Error reading file:\n// raw");
	});
});

describe("history helpers", () => {
	test("commit message falls back to a timestamped checkpoint", () => {
		expect(commitMessageOrDefault("  fix  ", 5)).toBe("fix");
		expect(commitMessageOrDefault("   ", 5)).toBe("checkpoint-5");
	});
	test("visibleChanges drops unchanged entries only", () => {
		const changes = [
			{ path: "a", status: "added" },
			{ path: "b", status: "unchanged" },
			{ path: "c", status: "removed" },
		];
		expect(visibleChanges(changes).map((c) => c.path)).toEqual(["a", "c"]);
	});
	test("export filename uses the ISO date", () => {
		expect(portableExportFilename(new Date("2026-10-19T12:00:00Z"))).toBe("keating-sandbox-2026-10-19.json");
	});
});

describe("formatting", () => {
	test("fmtBytes picks the unit", () => {
		expect(fmtBytes(10)).toBe("10 B");
		expect(fmtBytes(2048)).toBe("2.0 KB");
		expect(fmtBytes(3 * 1024 * 1024)).toBe("3.0 MB");
	});
	test("formatJson survives circular values", () => {
		const loop: Record<string, unknown> = {};
		loop.self = loop;
		expect(formatJson(loop)).toBe("[object Object]");
		expect(formatJson({ a: 1 })).toBe('{\n  "a": 1\n}');
	});
	test("errorMessage handles non-errors", () => {
		expect(errorMessage(new Error("x"))).toBe("x");
		expect(errorMessage(7)).toBe("7");
	});
});

describe("dialog and probe helpers", () => {
	test("runtime labels and status pill", () => {
		expect(runtimeLabel("browser-nodepod")).toBe("NodePod · local");
		expect(runtimeLabel("host")).toBe("Host machine");
		expect(runtimeStatusLabel({ booting: true, nodePodActive: true, hasExecutionEndpoint: true })).toBe("Starting…");
		expect(runtimeStatusLabel({ booting: false, nodePodActive: true, hasExecutionEndpoint: false })).toBe("Running");
		expect(runtimeStatusLabel({ booting: false, nodePodActive: false, hasExecutionEndpoint: true })).toBe("Configured");
		expect(runtimeStatusLabel({ booting: false, nodePodActive: false, hasExecutionEndpoint: false })).toBe("Stopped");
	});

	test("advanced tabs live behind More", () => {
		for (const tab of ["snapshots", "vc", "probes"]) expect(isAdvancedTab(tab)).toBe(true);
		for (const tab of ["status", "vfs", "shell", "log"]) expect(isAdvancedTab(tab)).toBe(false);
	});

	test("failure banner and recent-activity labels", () => {
		const event = (output: unknown) => ({ id: "1", timestamp: 0, tab: "t", operation: "x", ok: false, output });
		expect(failureBannerMessage(event({ error: "boom" }))).toBe("boom");
		expect(failureBannerMessage(event("nope"))).toBe("An operation failed. Open Activity for details.");
		expect(failureBannerMessage(event(null))).toBe("An operation failed. Open Activity for details.");
		expect(recentEventLabel("bootNodePod")).toBe("NodePod started");
		expect(recentEventLabel("teardownNodePod")).toBe("NodePod stopped");
		expect(recentEventLabel("write /a")).toBe("write /a");
	});

	test("probe payload parsing and output success", () => {
		expect(parseProbePayload("  ")).toEqual({});
		expect(parseProbePayload('{"a":1}')).toEqual({ a: 1 });
		expect(() => parseProbePayload("{")).toThrow("Probe payload is not valid JSON");
		expect(probeOutputOk({ ok: false })).toBe(false);
		expect(probeOutputOk({ ok: true })).toBe(true);
		expect(probeOutputOk("text")).toBe(true);
		expect(probeOutputOk(null)).toBe(true);
	});
});

describe("executeProbe", () => {
	const runtime = (extra: object) => ({ mode: "host", fallback: "browser-only", ...extra }) as never;

	test("config read is logged untimed with the runtime as output", async () => {
		const r = runtime({ executionEndpoint: "http://x" });
		expect(await executeProbe("config", "{}", r)).toEqual({ operation: "agent_runtime.config", ok: true, output: r, timed: false });
	});

	test("no execution endpoint fails without calling out", async () => {
		const outcome = await executeProbe("runtime.ping", "{}", runtime({ mode: "browser-only" }));
		expect(outcome).toMatchObject({ operation: "probe.runtime.ping", ok: false, timed: true });
		expect(outcome.output).toMatchObject({ reason: "No execution endpoint is configured." });
	});

	test("invalid payload JSON rejects", async () => {
		await expect(executeProbe("runtime.ping", "{", runtime({ executionEndpoint: "http://x" }))).rejects.toThrow("not valid JSON");
	});
});

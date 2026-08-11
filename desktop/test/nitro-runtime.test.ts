import { describe, expect, test } from "bun:test";
import type { ChildProcess } from "node:child_process";
import {
	stopNitroChild,
	waitForNitroReady,
} from "../src/nitro-runtime.js";
import {
	nitroEnvironment,
	resolveDesktopRuntimePaths,
} from "../src/runtime-paths.js";

describe("desktop Nitro runtime paths", () => {
	test("uses a read-only packaged resource and user-data-only mutable state", () => {
		const paths = resolveDesktopRuntimePaths({
			isPackaged: true,
			moduleDir: "/ignored/dist",
			resourcesPath: "/Applications/Keating.app/Contents/Resources",
			userData: "/Users/learner/Library/Application Support/Keating",
		});

		expect(paths.runtimeRoot).toBe("/Applications/Keating.app/Contents/Resources/nitro");
		expect(paths.serverEntry).toBe("/Applications/Keating.app/Contents/Resources/nitro/server/index.mjs");
		expect(paths.coursesStorageDir).toBe("/Users/learner/Library/Application Support/Keating/nitro/courses");
		expect(paths.coursesPearStorageDir).toBe("/Users/learner/Library/Application Support/Keating/nitro/courses-pear");
	});

	test("uses the staged dist/nitro tree while developing", () => {
		const paths = resolveDesktopRuntimePaths({
			isPackaged: false,
			moduleDir: "/work/desktop/dist",
			resourcesPath: "/unused",
			userData: "/tmp/keating-user",
		});

		expect(paths.runtimeRoot).toBe("/work/desktop/dist/nitro");
		expect(paths.serverEntry).toBe("/work/desktop/dist/nitro/server/index.mjs");
	});

	test("sets a loopback-only child environment without putting state in resources", () => {
		const paths = resolveDesktopRuntimePaths({
			isPackaged: false,
			moduleDir: "/work/desktop/dist",
			resourcesPath: "/unused",
			userData: "/tmp/keating-user",
		});
		const environment = nitroEnvironment(paths, 43123, { KEEP: "yes" });

		expect(environment).toMatchObject({
			KEEP: "yes",
			ELECTRON_RUN_AS_NODE: "1",
			NITRO_HOST: "127.0.0.1",
			NITRO_PORT: "43123",
			KEATING_COURSES_STORAGE_DIR: "/tmp/keating-user/nitro/courses",
			KEATING_COURSES_PEAR_STORAGE_DIR: "/tmp/keating-user/nitro/courses-pear",
		});
	});
});

describe("Nitro readiness", () => {
	test("retries bounded readiness probes until the local server is healthy", async () => {
		let clock = 0;
		let attempts = 0;
		await waitForNitroReady("http://127.0.0.1:43123", {
			timeoutMs: 30,
			intervalMs: 10,
			now: () => clock,
			sleep: async (milliseconds) => {
				clock += milliseconds;
			},
			fetchImpl: async () => ({ ok: ++attempts === 3 }),
		});
		expect(attempts).toBe(3);
	});

	test("fails after the bounded readiness deadline", async () => {
		let clock = 0;
		await expect(
			waitForNitroReady("http://127.0.0.1:43123", {
				timeoutMs: 20,
				intervalMs: 10,
				now: () => clock,
				sleep: async (milliseconds) => {
					clock += milliseconds;
				},
				fetchImpl: async () => ({ ok: false }),
			}),
		).rejects.toThrow("did not become ready within 20ms");
	});
});

describe("Nitro shutdown", () => {
	test("escalates only after graceful shutdown exceeds its deadline", async () => {
		const signals: string[] = [];
		const child = {
			exitCode: null,
			kill: (signal: string) => {
				signals.push(signal);
				return true;
			},
		} as unknown as ChildProcess;
		let waits = 0;
		await stopNitroChild(child, {
			timeoutMs: 1,
			waitForExit: async () => {
				if (++waits === 1) throw new Error("still running");
			},
		});
		expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
	});
});

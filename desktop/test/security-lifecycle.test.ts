import { describe, expect, test } from "bun:test";
import { DesktopLifecycle } from "../src/lifecycle.js";
import {
	assertBoundedSerializablePayload,
	assertKnownRpcMethod,
	createRequestIdTracker,
	enforceOwnerOnlySecretFile,
	isSafeExternalUrl,
	isSafeDevelopmentOrigin,
	isTrustedAppNavigation,
} from "../src/security.js";

describe("desktop navigation policy", () => {
	test("keeps the preload-bearing window on its app origin and externalizes only safe links", () => {
		const origin = "http://127.0.0.1:43123";
		expect(isTrustedAppNavigation(`${origin}/chat`, origin)).toBe(true);
		expect(isTrustedAppNavigation("https://untrusted.example/chat", origin)).toBe(false);
		expect(isSafeExternalUrl("https://keating.help/docs")).toBe(true);
		expect(isSafeExternalUrl("mailto:help@keating.help")).toBe(true);
		expect(isSafeExternalUrl("https://user:password@keating.help/")).toBe(false);
		expect(isSafeExternalUrl("file:///tmp/secret")).toBe(false);
		expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
		expect(isSafeDevelopmentOrigin("http://localhost:5173")).toBe(true);
		expect(isSafeDevelopmentOrigin("https://untrusted.example")).toBe(false);
	});

	test("corrects secret file permissions where the operating system supports POSIX modes", () => {
		const calls: Array<[string, number]> = [];
		enforceOwnerOnlySecretFile("/state/keating-user-secret.bin", "linux", (path, mode) => calls.push([path, mode]));
		expect(calls).toEqual([["/state/keating-user-secret.bin", 0o600]]);
		enforceOwnerOnlySecretFile("C:\\Keating\\secret.bin", "win32", (path, mode) => calls.push([path, mode]));
		expect(calls).toHaveLength(1);
	});
});

describe("desktop IPC limits", () => {
	test("rejects unknown RPC methods, payload cycles, excess depth, and replayed ids", () => {
		expect(() => assertKnownRpcMethod("unsafe")).toThrow("not supported");
		const cyclic: { self?: unknown } = {};
		cyclic.self = cyclic;
		expect(() => assertBoundedSerializablePayload(cyclic)).toThrow("cyclic");
		let nested: unknown = "leaf";
		for (let index = 0; index < 13; index += 1) nested = [nested];
		expect(() => assertBoundedSerializablePayload(nested)).toThrow("deeply nested");
		// Escaping doubles these backslashes in the serialized IPC representation.
		expect(() => assertBoundedSerializablePayload("\\\\".repeat(33_000))).toThrow("too large");
		const tracker = createRequestIdTracker(2);
		expect(tracker.claim("request-1")).toBe(true);
		expect(tracker.claim("request-1")).toBe(false);
	});

	test("closes late startup resources before an in-flight shutdown settles", async () => {
		let resolveStore: ((store: { close(): Promise<void> }) => void) | undefined;
		const lifecycle = new DesktopLifecycle<{ close(): Promise<void> }, { stop(): Promise<void> }>();
		const opening = lifecycle.openStore(() => new Promise((resolve) => { resolveStore = resolve; }));
		const shutdown = lifecycle.shutdown();
		const closed: string[] = [];
		const lateNitro = lifecycle.setNitro({ stop: async () => { closed.push("nitro"); } });
		lifecycle.setRendererCleanup(() => { closed.push("renderer"); });
		resolveStore?.({ close: async () => { closed.push("store"); } });
		await Promise.all([opening, lateNitro, shutdown]);
		expect(closed.sort()).toEqual(["nitro", "renderer", "store"]);
	});

	test("waits for an already-starting Nitro runtime before shutdown settles", async () => {
		let resolveNitro: ((runtime: { stop(): Promise<void> }) => void) | undefined;
		let shutdownSettled = false;
		let stops = 0;
		const lifecycle = new DesktopLifecycle<{ close(): Promise<void> }, { stop(): Promise<void> }>();
		const opening = lifecycle.openNitro(() => new Promise((resolve) => { resolveNitro = resolve; }));
		const shutdown = lifecycle.shutdown().then(() => { shutdownSettled = true; });
		await Promise.resolve();
		expect(shutdownSettled).toBe(false);
		resolveNitro?.({ stop: async () => { stops += 1; } });
		await Promise.all([opening, shutdown]);
		expect(stops).toBe(1);
		expect(shutdownSettled).toBe(true);
	});
});

describe("desktop lifecycle", () => {
	test("reuses the process store across macOS reactivation and closes each resource once", async () => {
		const closed: string[] = [];
		let opens = 0;
		const lifecycle = new DesktopLifecycle<{ close(): Promise<void> }, { stop(): Promise<void> }>();
		const first = await lifecycle.openStore(async () => ({ close: async () => { closed.push("store"); } }));
		const second = await lifecycle.openStore(async () => {
			opens += 1;
			return { close: async () => { closed.push("unexpected"); } };
		});
		expect(first).toBe(second);
		expect(opens).toBe(0);

		let firstRendererCleaned = 0;
		let secondRendererCleaned = 0;
		lifecycle.setRendererCleanup(() => { firstRendererCleaned += 1; });
		// Closing/reopening a macOS window swaps only the renderer binding.
		lifecycle.setRendererCleanup(() => { secondRendererCleaned += 1; });
		lifecycle.setNitro({ stop: async () => { closed.push("nitro"); } });
		await Promise.all([lifecycle.shutdown(), lifecycle.shutdown()]);

		expect(firstRendererCleaned).toBe(1);
		expect(secondRendererCleaned).toBe(1);
		expect(closed.sort()).toEqual(["nitro", "store"]);
	});

	test("waits for asynchronous renderer cleanup before shutdown completes", async () => {
		const lifecycle = new DesktopLifecycle<{ close(): Promise<void> }, { stop(): Promise<void> }>();
		let release: (() => void) | undefined;
		let cleaned = false;
		lifecycle.setRendererCleanup(async () => {
			await new Promise<void>((resolve) => { release = resolve; });
			cleaned = true;
		});

		let shutdownSettled = false;
		const shutdown = lifecycle.shutdown().then(() => { shutdownSettled = true; });
		await Promise.resolve();
		expect(shutdownSettled).toBe(false);
		release?.();
		await shutdown;
		expect(cleaned).toBe(true);
		expect(shutdownSettled).toBe(true);
	});
});

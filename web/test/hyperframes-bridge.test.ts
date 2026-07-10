import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { withHyperframesBridge } from "../src/components/hyperframes-bridge";
import { HYPERFRAMES_BRIDGE_SCRIPT } from "../src/components/hyperframes-frame-bridge";

describe("withHyperframesBridge", () => {
	test("injects the inline bridge script before the closing body", () => {
		const html = "<!doctype html><html><body><button>Try it</button></body></html>";
		const bridged = withHyperframesBridge(html);

		// The bridge is inlined as runnable JS (not referenced as a .ts asset),
		// so play/pause/replay/seek/loop work in dev and production builds.
		expect(bridged).toContain("<button>Try it</button><script>");
		expect(bridged).toContain("installHyperframesBridge");
		expect(bridged.indexOf("</script>")).toBeLessThan(bridged.indexOf("</body>"));
	});

	test("appends the bridge script to body fragments", () => {
		const bridged = withHyperframesBridge("<main>microworld</main>");
		expect(bridged.startsWith("<main>microworld</main><script>")).toBe(true);
		expect(bridged).toContain("installHyperframesBridge");
	});

	test("injects before the closing html tag when a body closer is absent", () => {
		const bridged = withHyperframesBridge("<!doctype html><html><main>scene</main></html>");
		expect(bridged.indexOf("</script>")).toBeLessThan(bridged.indexOf("</html>"));
		expect(bridged).toContain("installHyperframesBridge");
	});

	test("does not emit a raw TypeScript bridge asset reference", () => {
		// Regression guard: the migration shipped `new URL("./hyperframes-frame-bridge.ts", ...)`,
		// which the bundler emitted as a `data:video/mp2t` asset of uncompiled TS.
		// The browser could not run it, so the iframe controls silently no-oped.
		const bridged = withHyperframesBridge("<body></body>");
		expect(bridged).not.toContain("hyperframes-frame-bridge.ts");
		expect(bridged).not.toContain("data:video/mp2t");
		expect(bridged).not.toContain(": void");
	});

	test("keeps the player sandbox from reintroducing same-origin iframe access", () => {
		const source = readFileSync(new URL("../src/components/HyperframesPlayer.tsx", import.meta.url), "utf8");
		expect(source).toContain('sandbox="allow-scripts"');
		expect(source).not.toContain("allow-same-origin");
	});
});

describe("hyperframes-frame-bridge", () => {
	test("ships a runnable JS bridge payload with the shared postMessage contract", () => {
		expect(HYPERFRAMES_BRIDGE_SCRIPT).toContain("keating-hyperframes-command");
		expect(HYPERFRAMES_BRIDGE_SCRIPT).toContain("keating-hyperframes-state");
		expect(HYPERFRAMES_BRIDGE_SCRIPT).toContain("installHyperframesBridge");
		// Runnable browser JS: no TypeScript-only syntax that would fail to parse.
		expect(HYPERFRAMES_BRIDGE_SCRIPT).not.toContain(": void");
		expect(HYPERFRAMES_BRIDGE_SCRIPT).not.toContain("as Partial<");
		// Must not contain a literal closing tag that would break the inline script.
		expect(HYPERFRAMES_BRIDGE_SCRIPT).not.toMatch(/<\/script/i);
	});

	test("bridge payload parses as browser JavaScript", () => {
		expect(() => new Function(HYPERFRAMES_BRIDGE_SCRIPT)).not.toThrow();
	});

	test("bridge handles play pause replay seek and request-state commands", () => {
		const listeners = new Map<string, (event: { data: unknown }) => void>();
		const posted: unknown[] = [];
		const calls: string[] = [];
		const timeline = {
			_currentTime: 2,
			_paused: false,
			duration: () => 10,
			totalDuration: () => 10,
			time() {
				return this._currentTime;
			},
			paused() {
				return this._paused;
			},
			play() {
				calls.push("play");
				this._paused = false;
			},
			pause(time?: number) {
				calls.push(typeof time === "number" ? `pause:${time}` : "pause");
				if (typeof time === "number") this._currentTime = time;
				this._paused = true;
			},
		};
		let rafCallback: (() => void) | null = null;
		const fakeWindow = {
			gsap: { globalTimeline: timeline },
			parent: { postMessage: (message: unknown) => posted.push(message) },
			addEventListener: (type: string, listener: (event: { data: unknown }) => void) => {
				listeners.set(type, listener);
			},
			requestAnimationFrame: (callback: () => void) => {
				rafCallback = callback;
				return 1;
			},
		};

		new Function("window", HYPERFRAMES_BRIDGE_SCRIPT)(fakeWindow);
		expect(rafCallback).toBeFunction();
		listeners.get("message")?.({ data: { type: "keating-hyperframes-command", action: "pause" } });
		listeners.get("message")?.({ data: { type: "keating-hyperframes-command", action: "play" } });
		listeners.get("message")?.({ data: { type: "keating-hyperframes-command", action: "seek", progress: 0.5 } });
		listeners.get("message")?.({ data: { type: "keating-hyperframes-command", action: "replay" } });
		listeners.get("message")?.({ data: { type: "keating-hyperframes-command", action: "request-state" } });

		expect(calls).toEqual(["pause", "play", "pause:5", "pause:0", "play"]);
		expect(posted).toContainEqual({
			type: "keating-hyperframes-state",
			progress: 0.2,
			playing: false,
			hasTimeline: true,
		});
		expect(posted.at(-1)).toMatchObject({
			type: "keating-hyperframes-state",
			hasTimeline: true,
		});
	});

	test("player loads the bridge via the inline injector, not a .ts asset URL", () => {
		const playerSource = readFileSync(new URL("../src/components/HyperframesPlayer.tsx", import.meta.url), "utf8");
		expect(playerSource).toContain("withHyperframesBridge(html)");
		expect(playerSource).not.toContain('new URL("./hyperframes-frame-bridge.ts"');
	});
});

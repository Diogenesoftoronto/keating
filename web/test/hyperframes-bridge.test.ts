import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { withHyperframesBridge } from "../src/components/hyperframes-bridge";

describe("withHyperframesBridge", () => {
	test("injects the bridge script before the closing body", () => {
		const html = "<!doctype html><html><body><button>Try it</button></body></html>";
		const bridged = withHyperframesBridge(html, "/assets/hyperframes-frame-bridge.js");

		expect(bridged).toBe("<!doctype html><html><body><button>Try it</button><script src=\"/assets/hyperframes-frame-bridge.js\"></script></body></html>");
	});

	test("appends the bridge script to body fragments", () => {
		const bridged = withHyperframesBridge("<main>microworld</main>", "/assets/hyperframes-frame-bridge.js");
		expect(bridged).toBe("<main>microworld</main><script src=\"/assets/hyperframes-frame-bridge.js\"></script>");
	});

	test("keeps the player sandbox from reintroducing same-origin iframe access", () => {
		const source = readFileSync(new URL("../src/components/HyperframesPlayer.tsx", import.meta.url), "utf8");
		expect(source).toContain('sandbox="allow-scripts"');
		expect(source).not.toContain("allow-same-origin");
	});
});

describe("hyperframes-frame-bridge", () => {
	test("keeps the frame control code as typechecked source instead of interpolated runtime source", () => {
		const playerSource = readFileSync(new URL("../src/components/HyperframesPlayer.tsx", import.meta.url), "utf8");
		const bridgeSource = readFileSync(new URL("../src/components/hyperframes-frame-bridge.ts", import.meta.url), "utf8");
		expect(playerSource).toContain('new URL("./hyperframes-frame-bridge.ts", import.meta.url).href');
		expect(playerSource).not.toContain("HYPERFRAMES_BRIDGE_SOURCE");
		expect(bridgeSource).toContain("keating-hyperframes-command");
		expect(bridgeSource).toContain("keating-hyperframes-state");
		expect(bridgeSource).not.toContain("document.body");
	});
});

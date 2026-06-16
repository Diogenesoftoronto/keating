import { describe, expect, it } from "bun:test";
import { handleTutorialLinkClick, tutorialAdvancedHref, tutorialApiKeyHref } from "../lib/tutorial-links";

describe("tutorial links", () => {
	it("builds provider-specific API key links", () => {
		expect(tutorialApiKeyHref("google")).toBe("/tutorial?tab=cloud#google-api-key");
		expect(tutorialApiKeyHref("openai")).toBe("/tutorial?tab=cloud#openai-api-key");
		expect(tutorialApiKeyHref("unknown")).toBe("/tutorial?tab=cloud#get-api-key");
	});

	it("builds advanced tutorial links", () => {
		expect(tutorialAdvancedHref()).toBe("/tutorial?tab=advanced#fine-tune-from-keating");
		expect(tutorialAdvancedHref("runpod-training")).toBe("/tutorial?tab=advanced#runpod-training");
	});

	it("intercepts normal tutorial clicks for in-app navigation", () => {
		let prevented = false;
		let pushed = "";
		let dispatched = "";
		const previousWindow = (globalThis as any).window;
		const previousDocument = (globalThis as any).document;
		const previousPopStateEvent = (globalThis as any).PopStateEvent;
		(globalThis as any).PopStateEvent = class extends Event {};
		(globalThis as any).window = {
			location: { origin: "https://keating.help" },
			history: {
				pushState: (_state: unknown, _title: string, url: string) => {
					pushed = url;
				},
			},
			dispatchEvent: (event: Event) => {
				dispatched = event.type;
				return true;
			},
			requestAnimationFrame: (callback: FrameRequestCallback) => {
				callback(0);
				return 0;
			},
		};
		(globalThis as any).document = {
			getElementById: () => ({ scrollIntoView: () => {} }),
		};
		try {
			handleTutorialLinkClick({
				button: 0,
				metaKey: false,
				ctrlKey: false,
				shiftKey: false,
				altKey: false,
				preventDefault: () => {
					prevented = true;
				},
			}, "/tutorial?tab=cloud#google-api-key");
			expect(prevented).toBe(true);
			expect(pushed).toBe("/tutorial?tab=cloud#google-api-key");
			expect(dispatched).toBe("popstate");
		} finally {
			(globalThis as any).window = previousWindow;
			(globalThis as any).document = previousDocument;
			(globalThis as any).PopStateEvent = previousPopStateEvent;
		}
	});
});

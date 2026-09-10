import { afterEach, describe, expect, it, mock } from "bun:test";
import { DOCUMENTATION_URL, handleTutorialLinkClick, legacyTutorialHref, tutorialAdvancedHref, tutorialApiKeyHref } from "../lib/tutorial-links";

const originalWindow = globalThis.window;
afterEach(() => { globalThis.window = originalWindow; });

function browser(desktop = false) {
	const state = {
		location: { origin: "https://keating.help", assign: mock() },
		history: { pushState: mock() },
		dispatchEvent: mock(),
		open: mock(),
		...(desktop ? { keatingDesktop: {} } : {}),
	};
	globalThis.window = state as unknown as Window & typeof globalThis;
	return state;
}

function click(overrides: Partial<Parameters<typeof handleTutorialLinkClick>[0]> = {}) {
	return { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, preventDefault: mock(), ...overrides };
}

describe("documentation links", () => {
	it.each(["google", "openai", "anthropic", "openrouter"])("links %s to its API key instructions", (provider) => {
		expect(tutorialApiKeyHref(provider)).toBe(`${DOCUMENTATION_URL}choose-a-model/#section-use-your-own-provider-key`);
	});
	it("uses the API key overview for missing or unsupported providers", () => {
		expect(tutorialApiKeyHref()).toBe(`${DOCUMENTATION_URL}choose-a-model/#section-use-your-own-provider-key`);
		expect(tutorialApiKeyHref("unknown")).toBe(tutorialApiKeyHref());
	});
	it("links advanced topics to existing developer guides", () => {
		expect(tutorialAdvancedHref()).toBe("https://dev.keating.help/data-and-privacy/#training-archives-preserve-provenance");
		expect(tutorialAdvancedHref("runpod-training")).toBe(tutorialAdvancedHref());
		expect(tutorialAdvancedHref("feynman-harness")).toBe("https://dev.keating.help/evaluation-and-evolution/");
		expect(tutorialAdvancedHref("doc-to-lora")).toBe("https://dev.keating.help/models-and-providers/");
	});
	it.each([DOCUMENTATION_URL, tutorialApiKeyHref("google"), tutorialAdvancedHref()])("leaves browser navigation to the external anchor %s", (href) => {
		const state = browser();
		const event = click();
		handleTutorialLinkClick(event, href);
		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(state.history.pushState).not.toHaveBeenCalled();
		expect(state.dispatchEvent).not.toHaveBeenCalled();
		expect(state.open).not.toHaveBeenCalled();
	});
	it.each([tutorialApiKeyHref("openai"), tutorialAdvancedHref()])("opens desktop help in the system browser: %s", (href) => {
		const state = browser(true);
		const event = click();
		handleTutorialLinkClick(event, href);
		expect(event.preventDefault).toHaveBeenCalledTimes(1);
		expect(state.open).toHaveBeenCalledWith(href, "_blank", "noopener,noreferrer");
		expect(state.history.pushState).not.toHaveBeenCalled();
	});
	it.each([{ button: 1 }, { button: 2 }, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }])("preserves modified and non-primary clicks: %j", (overrides) => {
		const state = browser(true);
		const event = click(overrides);
		handleTutorialLinkClick(event, tutorialApiKeyHref("google"));
		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(state.open).not.toHaveBeenCalled();
		expect(state.history.pushState).not.toHaveBeenCalled();
	});
	it.each([false, true])("externalizes a legacy in-app help link (desktop=%s)", (desktop) => {
		const state = browser(desktop);
		const event = click();
		handleTutorialLinkClick(event, "/tutorial?tab=cloud#google-api-key");
		expect(event.preventDefault).toHaveBeenCalledTimes(1);
		expect(state.history.pushState).not.toHaveBeenCalled();
		if (desktop) expect(state.open).toHaveBeenCalledWith(tutorialApiKeyHref("google"), "_blank", "noopener,noreferrer");
		else expect(state.location.assign).toHaveBeenCalledWith(tutorialApiKeyHref("google"));
	});
});

describe("legacy tutorial destinations", () => {
	it.each([
		["/tutorial", DOCUMENTATION_URL],
		["/tutorial/", DOCUMENTATION_URL],
		["/tutorial?tab=cloud", `${DOCUMENTATION_URL}choose-a-model/`],
		["/tutorial?tab=ollama", `${DOCUMENTATION_URL}connect-local-models/#section-ollama`],
		["/tutorial?tab=llamacpp", `${DOCUMENTATION_URL}connect-local-models/#section-llama-cpp`],
		["/tutorial?tab=litellm", `${DOCUMENTATION_URL}connect-local-models/#section-litellm`],
		["/tutorial#tab-ollama", `${DOCUMENTATION_URL}connect-local-models/#section-ollama`],
		["/tutorial#tab-llamacpp", `${DOCUMENTATION_URL}connect-local-models/#section-llama-cpp`],
		["/tutorial#tab-litellm", `${DOCUMENTATION_URL}connect-local-models/#section-litellm`],
		["/tutorial?tab=cloud#tab-ollama", `${DOCUMENTATION_URL}connect-local-models/#section-ollama`],
		["/tutorial?tab=browser", `${DOCUMENTATION_URL}offline-tutor/`],
		["/tutorial?tab=advanced", tutorialAdvancedHref()],
		["/tutorial#settings", `${DOCUMENTATION_URL}learning-with-keating/`],
		["/tutorial#review-sessions", `${DOCUMENTATION_URL}sessions-and-review/`],
		["/tutorial#terminal-onboarding", `${DOCUMENTATION_URL}install-keating/`],
		["/tutorial#problems", `${DOCUMENTATION_URL}troubleshooting/`],
		["/tutorial?tab=cloud#openrouter-api-key", tutorialApiKeyHref("openrouter")],
		["/tutorial?tab=cloud#fine-tune-from-keating", tutorialAdvancedHref()],
		["/tutorial?tab=unknown#old-heading", DOCUMENTATION_URL],
		["/tutorial?redirect=https://example.com", DOCUMENTATION_URL],
	])("maps %s to its guide", (oldHref, expected) => {
		expect(legacyTutorialHref(oldHref)).toBe(expected);
	});
	it.each(["/tutorial/review-workspace.avif", "/tutorial/missing.png", "/tutorials", "/chat", "//evil.test/tutorial", "/\\evil.test/tutorial", "https://evil.test/tutorial"])("does not redirect other URLs or tutorial assets: %s", (href) => {
		expect(legacyTutorialHref(href)).toBeNull();
	});
});

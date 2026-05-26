import { describe, expect, it } from "bun:test";
import { tutorialAdvancedHref, tutorialApiKeyHref } from "../lib/tutorial-links";

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
});

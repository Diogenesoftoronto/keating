import { describe, expect, it } from "bun:test";
import { shouldDefaultToGptLive } from "./speech-default";

describe("gpt-live default", () => {
	it("applies only when signed in and no voice choice is stored", () => {
		expect(shouldDefaultToGptLive({ stored: null, signedIn: true })).toBe(true);
		expect(shouldDefaultToGptLive({ stored: null, signedIn: false })).toBe(false);
		expect(shouldDefaultToGptLive({ stored: "{}", signedIn: true })).toBe(false);
	});
});

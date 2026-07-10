import { describe, expect, it } from "bun:test";

import { hasAutoTitleContext } from "../hooks/session-auto-title";

describe("automatic session title context", () => {
	it("waits for two completed learner-assistant turns", () => {
		expect(hasAutoTitleContext([
			{ role: "user" },
			{ role: "assistant" },
		])).toBe(false);
		expect(hasAutoTitleContext([
			{ role: "user" },
			{ role: "assistant" },
			{ role: "user" },
			{ role: "assistant" },
		])).toBe(true);
	});

	it("does not mistake repeated assistant events for a second turn", () => {
		expect(hasAutoTitleContext([
			{ role: "user" },
			{ role: "assistant" },
			{ role: "assistant" },
		])).toBe(false);
	});
});

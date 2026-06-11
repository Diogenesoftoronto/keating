import { describe, expect, it } from "bun:test";

import { formatRelativeSessionDate } from "../lib/session-date";

describe("formatRelativeSessionDate", () => {
	it("renders today, yesterday, and recent labels", () => {
		const now = new Date();
		const yesterday = new Date(now.getTime() - 86_400_000);
		const threeDaysAgo = new Date(now.getTime() - 3 * 86_400_000);

		expect(formatRelativeSessionDate(now.toISOString())).toBe("Today");
		expect(formatRelativeSessionDate(yesterday.toISOString())).toBe("Yesterday");
		expect(formatRelativeSessionDate(threeDaysAgo.toISOString())).toBe("3d ago");
		expect(formatRelativeSessionDate(threeDaysAgo.toISOString(), { recent: "long" })).toBe("3 days ago");
	});

	it("can show the time for same-day session cards", () => {
		const value = formatRelativeSessionDate(new Date().toISOString(), { today: "time" });
		expect(value).not.toBe("Today");
		expect(value).toMatch(/\d/);
	});
});

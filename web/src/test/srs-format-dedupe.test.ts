import { expect, test } from "bun:test";
import fc from "fast-check";
import { formatDueIn } from "../keating/srs";
const MS_PER_DAY = 86_400_000;
// Pre-extraction numeric adapter oracle, including non-finite values.
function oldFormatDueIn(dueAt: number, now: number = Date.now()): string {
	const diffMs = dueAt - now;
	const days = diffMs / MS_PER_DAY;
	if (Math.abs(days) < 0.001) return "now";
	if (diffMs < 0) {
		const overdueDays = Math.abs(days);
		if (overdueDays < 1) {
			const overdueMin = Math.round(overdueDays * 24 * 60);
			return overdueMin <= 60 ? `${overdueMin}m overdue` : `${Math.round(overdueDays)}d overdue`;
		}
		return `${Math.round(overdueDays)}d overdue`;
	}
	if (days < 1) {
		const minutes = Math.round(days * 24 * 60);
		return minutes <= 60 ? `in ${minutes}m` : "in <1d";
	}
	return `in ${Math.round(days)}d`;
}
test("shared due formatting preserves all numeric timestamp behavior", () => {
  fc.assert(fc.property(fc.double(), fc.double(), (due, now) => {
    expect(formatDueIn(due, now)).toBe(oldFormatDueIn(due, now));
  }), { numRuns: 1000 });
  for (const diff of [-86400001, -86400000, -3600000, -86400, 0, 86400, 3600000, 86400000]) {
    expect(formatDueIn(diff, 0)).toBe(oldFormatDueIn(diff, 0));
  }
});

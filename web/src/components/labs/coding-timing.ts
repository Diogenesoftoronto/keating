import type { UiCodingTiming } from "@keating/learner-contracts";

/** Visible, unpaused work time. Snapshots never advance or reset the clock. */
export class CodingTimingTracker {
	private since: number | null = null;
	private workingMs = 0;
	private lastRunMs = 0;
	private runNumber = 0;

	setActive(active: boolean, now: number): void {
		if (active === (this.since !== null)) return;
		if (this.since !== null) this.workingMs += Math.max(0, now - this.since);
		this.since = active ? now : null;
	}

	snapshot(now: number): number {
		return Math.round(this.workingMs + (this.since === null ? 0 : Math.max(0, now - this.since)));
	}

	recordRun(now: number): UiCodingTiming {
		const workingMs = this.snapshot(now);
		const timing = { workingMs, sinceLastRunMs: workingMs - this.lastRunMs, runNumber: ++this.runNumber };
		this.lastRunMs = workingMs;
		return timing;
	}
}

export function formatCodingTime(ms: number): string {
	const seconds = Math.floor(Math.max(0, ms) / 1000);
	return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

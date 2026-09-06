import type { UiQuizTiming } from "@keating/learner-contracts";

const milliseconds = (value: number) => Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;

/** Explicit visits keep review time out of question timings; snapshots never advance the clock. */
export class QuizTimingTracker {
	private active?: { id: string; since: number };
	private durations: Record<string, number> = {};
	private finished?: UiQuizTiming;
	constructor(private readonly startedAt: number, questionId?: string) {
		if (questionId) this.active = { id: questionId, since: startedAt };
	}
	visit(questionId: string | undefined, now: number): void {
		if (this.finished || this.active?.id === questionId) return;
		if (this.active) {
			const { id, since } = this.active;
			this.durations[id] = (this.durations[id] ?? 0) + Math.max(0, now - since);
		}
		this.active = questionId ? { id: questionId, since: now } : undefined;
	}
	snapshot(now: number): UiQuizTiming {
		if (this.finished) return { totalMs: this.finished.totalMs, perQuestionMs: { ...this.finished.perQuestionMs } };
		const durations = { ...this.durations };
		if (this.active) durations[this.active.id] = (durations[this.active.id] ?? 0) + Math.max(0, now - this.active.since);
		return { totalMs: milliseconds(now - this.startedAt), perQuestionMs: Object.fromEntries(Object.entries(durations).map(([id, time]) => [id, milliseconds(time)])) };
	}
	finish(now: number): UiQuizTiming {
		this.finished ??= this.snapshot(now);
		return this.snapshot(now);
	}
}

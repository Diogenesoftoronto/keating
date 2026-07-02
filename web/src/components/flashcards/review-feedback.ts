/**
 * Juice for flashcard review: confetti on deck completion and tiny synthesized
 * WebAudio ticks for flip/grade events. Everything here is decorative — every
 * entry point is gated on user settings and prefers-reduced-motion, and
 * failures are swallowed so feedback can never break the review flow.
 */

export function prefersReducedMotion(): boolean {
	if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
	try {
		return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	} catch {
		return false;
	}
}

/** Streak milestones that get a celebratory pulse. */
export const STREAK_MILESTONES = [5, 10, 20, 50];

export function isStreakMilestone(streak: number): boolean {
	return STREAK_MILESTONES.includes(streak);
}

/** Fold a review rating into the running streak (consecutive Good/Easy). */
export function nextStreak(streak: number, rating: number): number {
	return rating >= 2 ? streak + 1 : 0;
}

// ---------------------------------------------------------------------------
// Confetti (lazy-loaded; skipped entirely under reduced motion)
// ---------------------------------------------------------------------------

export async function fireCompletionConfetti(): Promise<void> {
	if (prefersReducedMotion()) return;
	try {
		const { default: confetti } = await import("canvas-confetti");
		const base = { spread: 70, disableForReducedMotion: true, ticks: 160 } as const;
		confetti({ ...base, particleCount: 90, origin: { x: 0.5, y: 0.65 } });
		window.setTimeout(() => {
			confetti({ ...base, particleCount: 40, angle: 60, origin: { x: 0.1, y: 0.7 } });
			confetti({ ...base, particleCount: 40, angle: 120, origin: { x: 0.9, y: 0.7 } });
		}, 180);
	} catch {
		/* decorative only */
	}
}

// ---------------------------------------------------------------------------
// Sound (synthesized — no assets; context created lazily on a user gesture)
// ---------------------------------------------------------------------------

export type ReviewSound = "flip" | "again" | "hard" | "good" | "easy" | "complete";

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
	if (typeof window === "undefined") return null;
	const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
	if (!Ctor) return null;
	if (!audioCtx) {
		try {
			audioCtx = new Ctor();
		} catch {
			return null;
		}
	}
	if (audioCtx.state === "suspended") void audioCtx.resume().catch(() => {});
	return audioCtx;
}

function tone(ctx: AudioContext, freq: number, startAt: number, duration: number, gainPeak = 0.08) {
	const osc = ctx.createOscillator();
	const gain = ctx.createGain();
	osc.type = "triangle";
	osc.frequency.value = freq;
	gain.gain.setValueAtTime(0, startAt);
	gain.gain.linearRampToValueAtTime(gainPeak, startAt + 0.01);
	gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
	osc.connect(gain).connect(ctx.destination);
	osc.start(startAt);
	osc.stop(startAt + duration + 0.02);
}

const SOUND_RECIPES: Record<ReviewSound, Array<[freq: number, offset: number, duration: number]>> = {
	flip: [[660, 0, 0.07]],
	again: [[180, 0, 0.16]],
	hard: [[330, 0, 0.09]],
	good: [[523, 0, 0.08], [659, 0.07, 0.1]],
	easy: [[523, 0, 0.07], [659, 0.06, 0.07], [784, 0.12, 0.12]],
	complete: [[523, 0, 0.1], [659, 0.1, 0.1], [784, 0.2, 0.1], [1047, 0.3, 0.22]],
};

/** Play a review tick. No-op unless `enabled` (the user setting) is true. */
export function playReviewSound(sound: ReviewSound, enabled: boolean): void {
	if (!enabled) return;
	try {
		const ctx = getAudioContext();
		if (!ctx) return;
		const now = ctx.currentTime;
		for (const [freq, offset, duration] of SOUND_RECIPES[sound]) {
			tone(ctx, freq, now + offset, duration);
		}
	} catch {
		/* decorative only */
	}
}

export function ratingSound(rating: number): ReviewSound {
	if (rating <= 0) return "again";
	if (rating === 1) return "hard";
	if (rating === 2) return "good";
	return "easy";
}

import { useCallback, useEffect, useRef, useState } from "react";

export const FLASHCARD_REVEAL_DELAYS = [0, 5, 10, 15, 30] as const;
export type FlashcardRevealDelay = (typeof FLASHCARD_REVEAL_DELAYS)[number];

export interface FlashcardCountdown {
	remainingMs: number;
	sampledAt: number;
	running: boolean;
	done: boolean;
}

export function createFlashcardCountdown(delay: FlashcardRevealDelay, now: number): FlashcardCountdown {
	return { remainingMs: delay * 1000, sampledAt: now, running: false, done: delay === 0 };
}

/** Count only time since the previous sample that was actually running. */
export function sampleFlashcardCountdown(clock: FlashcardCountdown, now: number, running: boolean): { clock: FlashcardCountdown; reveal: boolean } {
	if (clock.done) return { clock: { ...clock, sampledAt: now, running: false }, reveal: false };
	const elapsed = clock.running ? Math.max(0, now - clock.sampledAt) : 0;
	const remainingMs = Math.max(0, clock.remainingMs - elapsed);
	const reveal = running && remainingMs === 0;
	return { clock: { remainingMs, sampledAt: now, running: running && !reveal, done: reveal }, reveal };
}

export interface FlashcardAutoReveal {
	delay: FlashcardRevealDelay;
	setDelay: (delay: FlashcardRevealDelay) => void;
	/** Seconds left, including fractions for the smooth progress indicator. */
	remaining: number | null;
	paused: boolean;
	togglePause: () => void;
}

/** Optional per-card reveal timer. It never rates or advances a card. */
export function useFlashcardAutoReveal({ cardKey, revealed, disabled = false, onReveal }: {
	cardKey: string;
	revealed: boolean;
	disabled?: boolean;
	onReveal: () => void;
}): FlashcardAutoReveal {
	const [delay, setDelayState] = useState<FlashcardRevealDelay>(0);
	const [manualPaused, setManualPaused] = useState(false);
	const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden);
	const [display, setDisplay] = useState<{ key: string; delay: FlashcardRevealDelay; remaining: number | null }>({ key: cardKey, delay: 0, remaining: null });
	const onRevealRef = useRef(onReveal);
	const inputs = useRef({ cardKey, delay, revealed, disabled, manualPaused });
	const active = useRef<{ key: string; delay: FlashcardRevealDelay; clock: FlashcardCountdown } | null>(null);
	onRevealRef.current = onReveal;
	inputs.current = { cardKey, delay, revealed, disabled, manualPaused };

	const setDelay = useCallback((next: FlashcardRevealDelay) => {
		if (!FLASHCARD_REVEAL_DELAYS.includes(next)) return;
		// A newly chosen duration is an explicit restart, including manual pause.
		inputs.current.delay = next;
		inputs.current.manualPaused = false;
		setManualPaused(false);
		setDelayState(next);
	}, []);
	const togglePause = useCallback(() => {
		const next = !inputs.current.manualPaused;
		inputs.current.manualPaused = next;
		setManualPaused(next);
	}, []);

	useEffect(() => {
		const run = { key: cardKey, delay, clock: createFlashcardCountdown(delay, performance.now()) };
		active.current = run;
		setDisplay({ key: cardKey, delay, remaining: delay || null });
		return () => { if (active.current === run) active.current = null; };
	}, [cardKey, delay]);

	useEffect(() => {
		const run = active.current;
		if (!run || !delay) return;
		let interval: ReturnType<typeof setInterval> | undefined;
		let disposed = false;
		const stop = () => { if (interval !== undefined) clearInterval(interval); interval = undefined; };
		const sample = () => {
			const latest = inputs.current;
			if (disposed || active.current !== run || latest.cardKey !== run.key || latest.delay !== run.delay) return;
			if (latest.revealed) run.clock = { ...run.clock, done: true, running: false };
			const canRun = !latest.revealed && !latest.disabled && !latest.manualPaused && !document.hidden;
			const next = sampleFlashcardCountdown(run.clock, performance.now(), canRun);
			run.clock = next.clock;
			const remaining = run.clock.done ? null : run.clock.remainingMs / 1000;
			setDisplay((previous) => previous.key === cardKey && previous.delay === delay && previous.remaining === remaining ? previous : { key: cardKey, delay, remaining });
			if (run.clock.done || !canRun) stop();
			// Marking the clock done above precedes the callback, so a parent render
			// or queued interval cannot reveal the same card for a second time.
			if (next.reveal) onRevealRef.current();
		};
		const visibilityChanged = () => { setHidden(document.hidden); sample(); };
		document.addEventListener("visibilitychange", visibilityChanged);
		sample();
		if (!run.clock.done && !revealed && !disabled && !manualPaused && !document.hidden) interval = setInterval(sample, 100);
		return () => {
			disposed = true;
			stop();
			document.removeEventListener("visibilitychange", visibilityChanged);
			// Settle the previous visible interval before entering any pause.
			run.clock = sampleFlashcardCountdown(run.clock, performance.now(), false).clock;
		};
	}, [cardKey, delay, revealed, disabled, manualPaused, hidden]);

	const remaining = !delay || revealed ? null : display.key === cardKey && display.delay === delay ? display.remaining : delay;
	return { delay, setDelay, remaining, paused: manualPaused || hidden, togglePause };
}

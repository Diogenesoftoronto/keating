import { useEffect, useState } from "react";
import { CodingTimingTracker } from "./coding-timing";

export function useCodingTimer(disabled: boolean, running: boolean) {
	const [tracker] = useState(() => new CodingTimingTracker());
	const [started, setStarted] = useState(false);
	const [paused, setPaused] = useState(false);
	const [completed, setCompleted] = useState(false);
	const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden);
	const [workingMs, setWorkingMs] = useState(0);
	const eligible = started && !paused && !completed && !disabled && !running;
	useEffect(() => {
		const synchronize = () => {
			setHidden(document.hidden);
			tracker.setActive(eligible && !document.hidden, performance.now());
			setWorkingMs(tracker.snapshot(performance.now()));
		};
		synchronize();
		document.addEventListener("visibilitychange", synchronize);
		const interval = eligible ? window.setInterval(() => setWorkingMs(tracker.snapshot(performance.now())), 250) : undefined;
		return () => {
			tracker.setActive(false, performance.now());
			document.removeEventListener("visibilitychange", synchronize);
			if (interval !== undefined) window.clearInterval(interval);
		};
	}, [eligible, tracker]);
	return {
		workingMs, started, completed,
		paused: paused || hidden || disabled || running,
		engage: () => {
			if (disabled || running) return;
			setStarted(true);
			setCompleted(false);
			tracker.setActive(!paused && !document.hidden, performance.now());
		},
		togglePause: () => {
			tracker.setActive(paused && !hidden && !disabled && !running && !completed, performance.now());
			setWorkingMs(tracker.snapshot(performance.now()));
			setPaused(value => !value);
		},
		beginRun: () => tracker.setActive(false, performance.now()),
		finishRun: (allPassed: boolean) => {
			const timing = tracker.recordRun(performance.now());
			setWorkingMs(timing.workingMs);
			setCompleted(allPassed);
			return timing;
		},
	};
}

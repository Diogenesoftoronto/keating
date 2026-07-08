type HyperframesCommand =
	| { type: "keating-hyperframes-command"; action: "play" | "pause" | "replay" | "request-state" }
	| { type: "keating-hyperframes-command"; action: "seek"; progress: number };

type HyperframesStateMessage = {
	type: "keating-hyperframes-state";
	progress: number;
	playing: boolean;
	hasTimeline: boolean;
};

type GsapTimeline = {
	duration(): number;
	pause(time?: number): unknown;
	paused?(): boolean;
	play(): unknown;
	time(): number;
	totalDuration?(): number;
};

type HyperframesWindow = Window & {
	gsap?: {
		globalTimeline?: GsapTimeline;
	};
};

const commandType = "keating-hyperframes-command";
const stateType = "keating-hyperframes-state";

function timeline(win: HyperframesWindow): GsapTimeline | null {
	return win.gsap?.globalTimeline ?? null;
}

function duration(tl: GsapTimeline): number {
	const total = typeof tl.totalDuration === "function" ? tl.totalDuration() : tl.duration();
	return Number.isFinite(total) && total > 0 && total < 100000 ? total : 0;
}

function timelineProgress(tl: GsapTimeline): number {
	const total = duration(tl);
	return total ? Math.max(0, Math.min(1, tl.time() / total)) : 0;
}

function isPlaying(tl: GsapTimeline): boolean {
	return typeof tl.paused === "function" ? !tl.paused() : true;
}

function isHyperframesCommand(value: unknown): value is HyperframesCommand {
	if (!value || typeof value !== "object") return false;
	const message = value as Partial<HyperframesCommand>;
	if (message.type !== commandType) return false;
	if (message.action === "seek") return typeof message.progress === "number" && Number.isFinite(message.progress);
	return message.action === "play"
		|| message.action === "pause"
		|| message.action === "replay"
		|| message.action === "request-state";
}

function postState(win: HyperframesWindow): void {
	const tl = timeline(win);
	const state: HyperframesStateMessage = {
		type: stateType,
		progress: tl ? timelineProgress(tl) : 0,
		playing: tl ? isPlaying(tl) : false,
		hasTimeline: Boolean(tl),
	};
	win.parent.postMessage(state, "*");
}

function handleCommand(win: HyperframesWindow, message: HyperframesCommand): void {
	const tl = timeline(win);
	if (!tl) {
		postState(win);
		return;
	}

	if (message.action === "play") tl.play();
	else if (message.action === "pause") tl.pause();
	else if (message.action === "replay") {
		tl.pause(0);
		tl.play();
	} else if (message.action === "seek") {
		const total = duration(tl);
		const progress = Math.max(0, Math.min(1, message.progress));
		if (total) tl.pause(progress * total);
	}

	postState(win);
}

function installHyperframesBridge(win: HyperframesWindow): void {
	win.addEventListener("message", (event: MessageEvent<unknown>) => {
		if (!isHyperframesCommand(event.data)) return;
		handleCommand(win, event.data);
	});

	function tick() {
		postState(win);
		win.requestAnimationFrame(tick);
	}

	win.requestAnimationFrame(tick);
}

installHyperframesBridge(window);

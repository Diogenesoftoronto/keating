import { useEffect, useRef, useState, type CSSProperties } from "react";
import { companionTiming, type CompanionSprite } from "./companion/timing";
import { PixelScreen, type FaceProgram } from "./companion/PixelScreen";
import "./keating-bot.css";

export const KEATING_BOT_CHAT_STATES = ["idle", "listening", "thinking", "speaking", "success", "waving", "loading"] as const;
export const KEATING_BOT_ACTIVITY_STATES = ["walking", "sitting", "flipping", "reading", "music", "science", "maths", "coding", "chemistry", "biology", "physics", "astronomy", "palaeontology", "electronics", "mycology", "lotus", "connecting", "understanding"] as const;
/** Scenes that narrate first contact: meeting, being heard, bringing things in, and settling. */
export const KEATING_BOT_ONBOARDING_STATES = ["greeting", "listening-voice", "importing", "sorting", "settled"] as const;
export const KEATING_BOT_COMPANION_STATES = Object.keys(companionTiming) as CompanionSprite[];
export type KeatingBotState = typeof KEATING_BOT_CHAT_STATES[number] | typeof KEATING_BOT_ACTIVITY_STATES[number] | typeof KEATING_BOT_ONBOARDING_STATES[number] | CompanionSprite;

// Only opt into a head crop when it exists and preserves the authored gesture.
const HEAD_STATES: ReadonlySet<string> = new Set([
  ...KEATING_BOT_CHAT_STATES, "sitting", "reading", "music", "science", "maths", "coding",
  "chemistry", "biology", "physics", "astronomy", "palaeontology", "electronics", "mycology",
]);

/** Whole-body movement must stay in view even in a compact head placement. */
export function keatingBotSpriteVariant(variant: "head" | "body", state: KeatingBotState): "head" | "body" {
	return HEAD_STATES.has(state) ? variant : "body";
}

export interface KeatingBotProps {
	variant?: "head" | "body";
	state?: KeatingBotState;
	size?: number;
	/** Pass an empty label when nearby text already conveys the state. */
	label?: string;
	animated?: boolean;
	/** Zero-based frame for inspection. Supplying it freezes both sprite and motion. */
	frame?: number;
	screen?: FaceProgram;
}

/** Eight row-major authored poses in a four-column, two-row atlas. */
export function keatingBotFramePosition(frame: number): { x: string; y: string } {
	const selected = Math.min(7, Math.max(0, Number.isFinite(frame) ? Math.floor(frame) : 0));
	return { x: `${selected % 4 / 3 * 100}%`, y: `${Math.floor(selected / 4) * 100}%` };
}
const FALLBACK_URL = "/brand/mascot-head-v2.avif";
const spriteReady = new Map<string, Promise<boolean>>();

function loadSprite(url: string): Promise<boolean> {
	const cached = spriteReady.get(url);
	if (cached) return cached;
	const promise = new Promise<boolean>(resolve => {
		const image = new Image();
		image.onload = () => resolve(image.naturalWidth > 0 && image.naturalHeight > 0);
		image.onerror = () => resolve(false);
		image.src = url;
	});
	spriteReady.set(url, promise);
	return promise;
}

export function preloadCompanionDragSprites() {
  for (const name of ["held", "falling", "landing", "wall-climb", "climbing"]) void loadSprite(`/brand/stop-motion-v1/keatingbot-body-${name}.avif`);
}

/** An animated atlas, with no React work between animation frames. */
export function KeatingBot({ variant = "head", state = "idle", size = 64, label = `Keatingbot · ${state}`, animated = true, frame, screen }: KeatingBotProps) {
	const host = useRef<HTMLSpanElement>(null);
	const [readyUrl, setReadyUrl] = useState<string>();
	const [visible, setVisible] = useState(false);
	const [pageVisible, setPageVisible] = useState(true);
	const [fallbackFailed, setFallbackFailed] = useState(false);
	const selectedFrame = frame === undefined ? undefined : keatingBotFramePosition(frame);
	const spriteVariant = keatingBotSpriteVariant(variant, state);
	const spriteUrl = `/brand/stop-motion-v1/keatingbot-${spriteVariant}-${state}.avif`;
	useEffect(() => {
		let mounted = true;
		void loadSprite(spriteUrl).then(loaded => { if (mounted) setReadyUrl(loaded ? spriteUrl : undefined); });
		return () => { mounted = false; };
	}, [spriteUrl]);
	useEffect(() => {
		function updateVisibility() { setPageVisible(document.visibilityState !== "hidden"); }
		updateVisibility();
		document.addEventListener("visibilitychange", updateVisibility);
		const element = host.current;
		const observer = typeof IntersectionObserver === "undefined" ? undefined : new IntersectionObserver(entries => {
			setVisible(entries.some(entry => entry.isIntersecting));
		});
		if (element && observer) observer.observe(element);
		else setVisible(true);
		return () => { observer?.disconnect(); document.removeEventListener("visibilitychange", updateVisibility); };
	}, []);
	const cadence = Object.hasOwn(companionTiming, state) ? companionTiming[state as CompanionSprite] : undefined;
	const face = screen && (state === "blank-idle" || state === "blank-sitting");
	const dimension = Number.isFinite(size) && size > 0 ? size : 64;
	return <span
		ref={host}
		className="keating-bot"
		role={label ? "img" : undefined}
		aria-label={label || undefined}
		aria-hidden={label ? undefined : true}
		data-state={state}
		data-cadence={Boolean(cadence)}
		data-screen={Boolean(face)}
		data-variant={variant}
		data-frozen={selectedFrame !== undefined}
		data-animated={animated}
		data-paused={!visible || !pageVisible}
		style={{ "--bot-period": cadence && `${8 / cadence[0]}s`, "--bot-repeat": cadence && (cadence[1] || "infinite"), "--keating-bot-size": `${dimension}px`, "--keating-bot-frame-x": selectedFrame?.x, "--keating-bot-frame-y": selectedFrame?.y } as CSSProperties}
	>
		{readyUrl === spriteUrl ? <span key={`${variant}:${state}`} className="keating-bot__motion" aria-hidden="true"><span className="keating-bot__sprite" style={{ backgroundImage: `url("${spriteUrl}")` }} />{face && <PixelScreen state={state} program={screen} active={animated && visible && pageVisible && frame === undefined} frame={frame} />}</span>
			: !fallbackFailed && <img className="keating-bot__fallback" src={state === "lotus" ? "/brand/mascot-lotus.avif" : spriteVariant === "body" ? "/brand/mascot-full.avif" : FALLBACK_URL} alt="" aria-hidden="true" draggable={false} onError={() => setFallbackFailed(true)} />}
	</span>;
}

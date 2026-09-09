import { useEffect, useRef, useState, type CSSProperties } from "react";
import "./keating-bot.css";

export const KEATING_BOT_CHAT_STATES = ["idle", "listening", "thinking", "speaking", "success", "waving", "loading"] as const;
export const KEATING_BOT_ACTIVITY_STATES = ["walking", "sitting", "flipping", "reading", "music", "science", "maths", "coding", "chemistry", "biology", "physics", "astronomy", "palaeontology", "electronics", "mycology", "lotus", "connecting", "understanding"] as const;
export type KeatingBotState = typeof KEATING_BOT_CHAT_STATES[number] | typeof KEATING_BOT_ACTIVITY_STATES[number];

/** Whole-body movement must stay in view even in a compact head placement. */
export function keatingBotSpriteVariant(variant: "head" | "body", state: KeatingBotState): "head" | "body" {
	return state === "walking" || state === "flipping" || state === "lotus" || state === "connecting" || state === "understanding" ? "body" : variant;
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

/** An animated atlas, with no React work between animation frames. */
export function KeatingBot({ variant = "head", state = "idle", size = 64, label = `Keatingbot · ${state}`, animated = true, frame }: KeatingBotProps) {
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
	const dimension = Number.isFinite(size) && size > 0 ? size : 64;
	return <span
		ref={host}
		className="keating-bot"
		role={label ? "img" : undefined}
		aria-label={label || undefined}
		aria-hidden={label ? undefined : true}
		data-state={state}
		data-variant={variant}
		data-frozen={selectedFrame !== undefined}
		data-animated={animated}
		data-paused={!visible || !pageVisible}
		style={{ "--keating-bot-size": `${dimension}px`, "--keating-bot-frame-x": selectedFrame?.x, "--keating-bot-frame-y": selectedFrame?.y } as CSSProperties}
	>
		{readyUrl === spriteUrl ? <span key={`${variant}:${state}`} className="keating-bot__motion" aria-hidden="true"><span className="keating-bot__sprite" style={{ backgroundImage: `url("${spriteUrl}")` }} /></span>
			: !fallbackFailed && <img className="keating-bot__fallback" src={state === "lotus" ? "/brand/mascot-lotus.avif" : spriteVariant === "body" ? "/brand/mascot-full.avif" : FALLBACK_URL} alt="" aria-hidden="true" draggable={false} onError={() => setFallbackFailed(true)} />}
	</span>;
}

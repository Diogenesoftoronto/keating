import { useEffect, useRef, useState, type CSSProperties } from "react";
import "./keating-bot.css";

export type KeatingBotState = "idle" | "listening" | "thinking" | "speaking" | "success" | "waving";

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

const SPRITE_URLS = { head: "/brand/keatingbot-sprites-v1.png", body: "/brand/keatingbot-body-sprites-v1.png" };
const FALLBACK_URL = "/brand/mascot-head-v2.png";
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
	const bodyWave = state === "waving" && variant === "body";
	const strip = state === "thinking" || state === "speaking" || bodyWave;
	const frameCount = bodyWave ? 12 : state === "speaking" ? 8 : 4;
	const selectedFrame = frame === undefined ? undefined : Math.min(frameCount - 1, Math.max(0, Number.isFinite(frame) ? Math.floor(frame) : 0));
	const spriteUrl = bodyWave ? "/brand/keatingbot-body-waving-v3.png" : strip ? `/brand/keatingbot-${variant}-${state}-v2.png` : SPRITE_URLS[variant];
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
		data-strip={strip}
		data-frozen={selectedFrame !== undefined}
		data-animated={animated}
		data-paused={!visible || !pageVisible}
		style={{ "--keating-bot-size": `${dimension}px`, "--keating-bot-frame": `${(selectedFrame ?? 0) / (frameCount - 1) * 100}%` } as CSSProperties}
	>
		{readyUrl === spriteUrl ? <span key={`${variant}:${state}`} className="keating-bot__motion" aria-hidden="true"><span className="keating-bot__sprite" style={{ backgroundImage: `url("${spriteUrl}")` }} /></span>
			: !fallbackFailed && <img className="keating-bot__fallback" src={variant === "body" ? "/brand/mascot-full.png" : FALLBACK_URL} alt="" aria-hidden="true" draggable={false} onError={() => setFallbackFailed(true)} />}
	</span>;
}

import { Button, Loading } from "../design-system/kit";
import { PlaybackPosition } from "./PlaybackPosition";
import { useEffect, useMemo, useRef, useState } from "react";
import { KeatingGlyph } from "../design-system/glyphs";
import { css, cx } from "../../styled-system/css";
import { withHyperframesBridge } from "./hyperframes-bridge";

interface HyperframesPlayerProps {
	html: string;
	title: string;
	className?: string;
	duration?: number;
}

type HyperframesCommand =
	| { type: "keating-hyperframes-command"; action: "play" | "pause" | "replay" | "request-state" }
	| { type: "keating-hyperframes-command"; action: "seek"; progress: number };

type HyperframesStateMessage = {
	type: "keating-hyperframes-state";
	progress: number;
	playing: boolean;
	hasTimeline: boolean;
	seekable: boolean;
};

type HyperframesErrorMessage = {
	type: "keating-hyperframes-error";
	message: string;
	source?: string;
};

function isHyperframesStateMessage(value: unknown): value is HyperframesStateMessage {
	if (!value || typeof value !== "object") return false;
	const message = value as Partial<HyperframesStateMessage>;
	return message.type === "keating-hyperframes-state"
		&& typeof message.progress === "number"
		&& Number.isFinite(message.progress)
		&& typeof message.playing === "boolean"
		&& typeof message.hasTimeline === "boolean"
		&& typeof message.seekable === "boolean";
}

function isHyperframesErrorMessage(value: unknown): value is HyperframesErrorMessage {
	if (!value || typeof value !== "object") return false;
	const message = value as Partial<HyperframesErrorMessage>;
	return message.type === "keating-hyperframes-error"
		&& typeof message.message === "string"
		&& message.message.trim().length > 0;
}

export function HyperframesPlayer({ html, title, className, duration }: HyperframesPlayerProps) {
	const iframeRef = useRef<HTMLIFrameElement | null>(null);
	const [playing, setPlaying] = useState(false);
	const [looping, setLooping] = useState(true);
	const [progress, setProgress] = useState(0);
	const [bridgeReady, setBridgeReady] = useState(false);
	const [hasTimeline, setHasTimeline] = useState(false);
	const [seekable, setSeekable] = useState(false);
	const [runtimeError, setRuntimeError] = useState("");
	const [loadTimedOut, setLoadTimedOut] = useState(false);
	const sandboxedHtml = useMemo(() => withHyperframesBridge(html), [html]);
	const src = useBlobUrl(sandboxedHtml, "text/html");

	const postCommand = (command: HyperframesCommand) => {
		iframeRef.current?.contentWindow?.postMessage(command, "*");
	};

	useEffect(() => {
		const handleMessage = (event: MessageEvent<unknown>) => {
			if (event.source !== iframeRef.current?.contentWindow) return;
			if (isHyperframesErrorMessage(event.data)) {
				setRuntimeError(event.data.message);
				return;
			}
			if (!isHyperframesStateMessage(event.data)) return;
			const next = Math.max(0, Math.min(1, event.data.progress));
			setBridgeReady(true);
			setLoadTimedOut(false);
			setHasTimeline(event.data.hasTimeline);
			setSeekable(event.data.seekable);
			setProgress(next);
			setPlaying(event.data.playing);
			if (event.data.hasTimeline && looping && event.data.playing && next >= 0.995) {
				postCommand({ type: "keating-hyperframes-command", action: "replay" });
			}
		};
		window.addEventListener("message", handleMessage);
		return () => window.removeEventListener("message", handleMessage);
	}, [looping]);

	useEffect(() => {
		const frame = requestAnimationFrame(() => {
			postCommand({ type: "keating-hyperframes-command", action: "request-state" });
		});
		return () => cancelAnimationFrame(frame);
	}, [src]);

	useEffect(() => {
		if (!src || bridgeReady || runtimeError) return;
		const timer = window.setTimeout(() => setLoadTimedOut(true), 5000);
		return () => window.clearTimeout(timer);
	}, [bridgeReady, runtimeError, src]);

	useEffect(() => {
		setPlaying(false);
		setProgress(0);
		setBridgeReady(false);
		setHasTimeline(false);
		setSeekable(false);
		setRuntimeError("");
		setLoadTimedOut(false);
	}, [src]);

	const loading = !bridgeReady && !runtimeError && !loadTimedOut;
	const controlLabel = !bridgeReady ? "Loading" : !hasTimeline ? "Unavailable" : playing ? "Pause" : "Play";

	return (
		// The stage is the only framed element; controls sit on open space beneath
		// it rather than inside a second box.
		<div className={cx(css({ display: "grid", gap: "0.75rem" }), className)}>
			<iframe
				ref={iframeRef}
				title={title}
				src={src || undefined}
				sandbox="allow-scripts"
				onLoad={() => postCommand({ type: "keating-hyperframes-command", action: "request-state" })}
				className="specialist-animation-stage k-grid"
			/>
			{runtimeError && (
				<div
					role="alert"
					className={css({
						display: "flex",
						alignItems: "flex-start",
						gap: "0.5rem",
						borderRadius: "0.375rem",
						background: "color-mix(in srgb, var(--destructive) 10%, transparent)",
						padding: "0.75rem",
						fontSize: "0.75rem",
						color: "var(--destructive)",
					})}
				>
					<KeatingGlyph name="alert" size={14} className={css({ marginTop: "0.0625rem", flexShrink: 0 })} />
					<span>Animation failed to render: {runtimeError}</span>
				</div>
			)}
			{!runtimeError && loadTimedOut && (
				<div
					role="status"
					className={css({
						display: "flex",
						alignItems: "flex-start",
						gap: "0.5rem",
						borderRadius: "0.375rem",
						background: "var(--k-wash)",
						padding: "0.75rem",
						fontSize: "0.75rem",
						color: "var(--foreground)",
					})}
				>
					<KeatingGlyph name="alert" size={14} className={css({ marginTop: "0.0625rem", flexShrink: 0, color: "var(--ink-soft)" })} />
					<span>The animation loaded without a controllable timeline. Its script may be blocked or still loading.</span>
				</div>
			)}
			<div className="specialist-playback">
				<Button variant="ghost" size="sm"
					type="button"
					disabled={!hasTimeline}
					glyph={loading ? undefined : playing && hasTimeline ? "pause" : "play"}
					aria-label={controlLabel}
					onClick={() => {
						const next = !playing;
						setPlaying(next);
						postCommand({ type: "keating-hyperframes-command", action: next ? "play" : "pause" });
					}}
				>
					{loading ? <Loading size="inline" label={controlLabel} /> : controlLabel}
				</Button>
				<Button variant="ghost" size="sm"
					type="button"
					onClick={() => {
						setPlaying(true);
						setProgress(0);
						postCommand({ type: "keating-hyperframes-command", action: "replay" });
					}}
				>
					<KeatingGlyph name="refresh" size={14} />
					Replay
				</Button>
				<PlaybackPosition label="Animation progress" value={progress * (duration || 1)} max={duration || 1} seconds={Boolean(duration)} disabled={!seekable}
					onSeek={value => {
						const next = value / (duration || 1);
						setProgress(next);
						setPlaying(false);
						postCommand({type:"keating-hyperframes-command", action:"seek", progress:next});
					}} />
				<Button variant="ghost" size="sm"
					type="button"
					onClick={() => setLooping((value) => !value)}
					aria-pressed={looping}
					disabled={!seekable}
				>
					<KeatingGlyph name="refresh" size={14} />
					Loop
				</Button>
			</div>
		</div>
	);
}

function useBlobUrl(source: string, type: string): string {
	const blob = useMemo(() => new Blob([source], { type }), [source, type]);
	const [url, setUrl] = useState<string>("");
	useEffect(() => {
		const next = URL.createObjectURL(blob);
		setUrl(next);
		return () => URL.revokeObjectURL(next);
	}, [blob]);
	return url;
}

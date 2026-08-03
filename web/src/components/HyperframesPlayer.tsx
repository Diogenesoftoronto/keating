import { useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, Pause, Play, RotateCcw, Repeat } from "lucide-react";
import { css, cx } from "../../styled-system/css";
import { withHyperframesBridge } from "./hyperframes-bridge";

interface HyperframesPlayerProps {
	html: string;
	title: string;
	className?: string;
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

export function HyperframesPlayer({ html, title, className }: HyperframesPlayerProps) {
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
				className={css({ display: "block", aspectRatio: "16 / 9", width: "100%", borderRadius: "0.75rem", border: "none", background: "black" })}
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
					<CircleAlert size={14} className={css({ marginTop: "0.0625rem", flexShrink: 0 })} />
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
						background: "color-mix(in srgb, #f59e0b 12%, transparent)",
						padding: "0.75rem",
						fontSize: "0.75rem",
						color: "var(--foreground)",
					})}
				>
					<CircleAlert size={14} className={css({ marginTop: "0.0625rem", flexShrink: 0, color: "#d97706" })} />
					<span>The animation loaded without a controllable timeline. Its script may be blocked or still loading.</span>
				</div>
			)}
			<div className={css({ display: "grid", gridTemplateColumns: "auto auto 1fr auto", alignItems: "center", gap: "0.75rem" })}>
				<button
					type="button"
					disabled={!hasTimeline}
					aria-label={controlLabel}
					onClick={() => {
						const next = !playing;
						setPlaying(next);
						postCommand({ type: "keating-hyperframes-command", action: next ? "play" : "pause" });
					}}
					className={controlButtonClass}
				>
					{playing && hasTimeline ? <Pause size={14} /> : <Play size={14} />}
					{controlLabel}
				</button>
				<button
					type="button"
					onClick={() => {
						setPlaying(true);
						setProgress(0);
						postCommand({ type: "keating-hyperframes-command", action: "replay" });
					}}
					className={controlButtonClass}
				>
					<RotateCcw size={14} />
					Replay
				</button>
				<input
					type="range"
					min={0}
					max={1000}
					value={Math.round(progress * 1000)}
					disabled={!seekable}
					onChange={(event) => {
						const next = Math.max(0, Math.min(1, Number(event.target.value) / 1000));
						setProgress(next);
						setPlaying(false);
						postCommand({ type: "keating-hyperframes-command", action: "seek", progress: next });
					}}
					aria-label="Animation progress"
					className={css({ minWidth: 0, accentColor: "var(--primary)" })}
				/>
				<button
					type="button"
					onClick={() => setLooping((value) => !value)}
					aria-pressed={looping}
					disabled={!seekable}
					className={cx(controlButtonClass, looping && css({ color: "var(--primary)", _hover: { color: "var(--primary)" } }))}
				>
					<Repeat size={14} />
					Loop
				</button>
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

// Borderless: the controls read as a row of actions, not a strip of boxes.
const controlButtonClass = css({
	display: "inline-flex",
	height: "2rem",
	alignItems: "center",
	justifyContent: "center",
	gap: "0.375rem",
	borderRadius: "0.375rem",
	paddingInline: "0.5rem",
	fontSize: "0.75rem",
	fontWeight: 500,
	whiteSpace: "nowrap",
	color: "var(--muted-foreground)",
	transition: "color 150ms, background-color 150ms",
	_disabled: { cursor: "not-allowed", opacity: 0.55 },
	_hover: { background: "var(--accent)", color: "var(--accent-foreground)" },
});

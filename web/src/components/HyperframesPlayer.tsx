import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Repeat } from "lucide-react";
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
};

const hyperframesBridgeUrl = new URL("./hyperframes-frame-bridge.ts", import.meta.url).href;

function isHyperframesStateMessage(value: unknown): value is HyperframesStateMessage {
	if (!value || typeof value !== "object") return false;
	const message = value as Partial<HyperframesStateMessage>;
	return message.type === "keating-hyperframes-state"
		&& typeof message.progress === "number"
		&& Number.isFinite(message.progress)
		&& typeof message.playing === "boolean"
		&& typeof message.hasTimeline === "boolean";
}

export function HyperframesPlayer({ html, title, className }: HyperframesPlayerProps) {
	const iframeRef = useRef<HTMLIFrameElement | null>(null);
	const [playing, setPlaying] = useState(true);
	const [looping, setLooping] = useState(true);
	const [progress, setProgress] = useState(0);
	const sandboxedHtml = useMemo(() => withHyperframesBridge(html, hyperframesBridgeUrl), [html]);
	const src = useBlobUrl(sandboxedHtml, "text/html");

	const postCommand = (command: HyperframesCommand) => {
		iframeRef.current?.contentWindow?.postMessage(command, "*");
	};

	useEffect(() => {
		const handleMessage = (event: MessageEvent<unknown>) => {
			if (event.source !== iframeRef.current?.contentWindow || !isHyperframesStateMessage(event.data)) return;
			const next = Math.max(0, Math.min(1, event.data.progress));
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
		setPlaying(true);
		setProgress(0);
	}, [src]);

	return (
		<div className={cx(css({ display: "grid", gap: "0.5rem" }), className)}>
			<iframe
				ref={iframeRef}
				title={title}
				src={src}
				sandbox="allow-scripts"
				className={css({ display: "block", aspectRatio: "16 / 9", width: "100%", borderRadius: "0.375rem", border: "1px solid var(--border)", background: "black" })}
			/>
			<div className={css({ display: "grid", gridTemplateColumns: "auto auto 1fr auto", alignItems: "center", gap: "0.5rem", borderRadius: "0.5rem", border: "1px solid var(--border)", background: "color-mix(in srgb, var(--background) 80%, transparent)", padding: "0.5rem" })}>
				<button
					type="button"
					onClick={() => {
						const next = !playing;
						setPlaying(next);
						postCommand({ type: "keating-hyperframes-command", action: next ? "play" : "pause" });
					}}
					className={controlButtonClass}
				>
					{playing ? <Pause size={14} /> : <Play size={14} />}
					{playing ? "Pause" : "Play"}
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
					className={cx(controlButtonClass, looping && css({ color: "var(--primary)", borderColor: "var(--primary)" }))}
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

const controlButtonClass = css({
	display: "inline-flex",
	height: "2rem",
	alignItems: "center",
	justifyContent: "center",
	gap: "0.25rem",
	borderRadius: "0.375rem",
	border: "1px solid var(--border)",
	paddingInline: "0.5rem",
	fontSize: "0.75rem",
	fontWeight: 500,
	whiteSpace: "nowrap",
	_hover: { background: "var(--accent)" },
});

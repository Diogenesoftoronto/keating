import { LessonFrame } from "./lesson/LessonFrame";
import "./specialist-lessons.css";
import { useEffect, useRef, useState } from "react";
import { browserThemeSource, watchAppContext } from "../keating/interactive-page/theme";
import type { UiMusicLabNode } from "@keating/learner-contracts";
import { MarkdownBlock } from "./MarkdownBlock";
import { buildMusicDocument } from "./labs/music-document";
import "./labs/learning-labs.css";

export function MusicLab({ node, disabled = false }: { node: UiMusicLabNode; disabled?: boolean }) {
	const frame = useRef<HTMLIFrameElement>(null);
	const [frameDocument, setDocument] = useState<string>();
	const [height, setHeight] = useState(540);
	function syncAppearance() {
		const root = browserThemeSource();
		if (!root || !frame.current?.contentWindow) return;
		const tokens = ["--series-1", "--ink", "--ink-soft", "--line", "--line-soft", "--paper", "--paper-deep", "--accent-green", "--green-deep"];
		const palette = Object.fromEntries(tokens.map(token => [token, root.readVariable(token).trim()]));
		frame.current.contentWindow.postMessage({ type: "keating-music-appearance", palette, reducedMotion: root.reducedMotion() }, "*");
	}
	useEffect(() => watchAppContext(syncAppearance), []);
	useEffect(() => {
		if (!window.location?.origin) return;
		setDocument(buildMusicDocument(node.code, window.location.origin, { controls: node.controls, visualization: node.visualization }));
	}, [node.code, node.controls, node.visualization]);
	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			if (event.source !== frame.current?.contentWindow || event.data?.type !== "keating-music-resize") return;
			if (typeof event.data.height === "number" && Number.isFinite(event.data.height)) setHeight(Math.min(1600, Math.max(280, Math.ceil(event.data.height))));
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, []);
	useEffect(() => {
		const player = frame.current?.contentWindow;
		if (disabled) player?.postMessage({ type: "keating-music-stop" }, "*");
		return () => player?.postMessage({ type: "keating-music-stop" }, "*");
	}, [disabled, node.id]);
	return <LessonFrame glyph="music" title={node.title} kind="Music lab" tools={<span className="lesson-meta">Strudel</span>} className="learning-lab music-lab" data-music-lab={node.id} aria-label={node.title}>
		{node.brief ? <div className="learning-lab__brief"><MarkdownBlock content={node.brief} /></div> : null}
		{disabled
			? <pre className="music-lab__code">{node.code}</pre>
			: <div className="lesson-stage lesson-bleed music-lab__stage" aria-label={`${node.visualization === "scope" ? "Waveform" : "Pattern"}. Sound starts when you press Play.`} role="group">
				<iframe key={node.id} ref={frame} className="music-lab__frame" style={{ height }} title={`${node.title}: Strudel instrument, visualization and playback`} sandbox="allow-scripts" allow="autoplay" referrerPolicy="no-referrer" onLoad={syncAppearance} srcDoc={frameDocument} />
			</div>}
		<p className="lesson-hint music-lab__credit"><span>Sound starts when you press Play.</span><a href="https://strudel.cc/technical-manual/project-start/" target="_blank" rel="noreferrer">Powered by Strudel</a></p>
	</LessonFrame>;
}

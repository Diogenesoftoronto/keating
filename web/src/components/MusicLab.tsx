import { useEffect, useId, useRef, useState } from "react";
import { AudioLines } from "lucide-react";
import type { UiMusicLabNode } from "@keating/learner-contracts";
import { MarkdownBlock } from "./MarkdownBlock";
import { buildMusicDocument } from "./labs/music-document";
import "./labs/learning-labs.css";

export function MusicLab({ node, disabled = false }: { node: UiMusicLabNode; disabled?: boolean }) {
	const id = useId();
	const frame = useRef<HTMLIFrameElement>(null);
	const [document, setDocument] = useState<string>();
	const [height, setHeight] = useState(540);
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
	return <section className="learning-lab music-lab" data-music-lab={node.id} aria-labelledby={`${id}-title`}>
		<header className="learning-lab__header"><h4 id={`${id}-title`}><AudioLines size={18} aria-hidden="true" />{node.title}</h4><span className="learning-lab__language">Strudel</span></header>
		{node.brief ? <div className="learning-lab__brief"><MarkdownBlock content={node.brief} /></div> : null}
		{disabled ? <pre>{node.code}</pre> : <iframe key={node.id} ref={frame} className="music-lab__frame" style={{ height }} title={`${node.title}: Strudel instrument, visualization and playback`} sandbox="allow-scripts" allow="autoplay" referrerPolicy="no-referrer" srcDoc={document} />}
		<div className="music-lab__credit"><span>Sound starts when you press Play.</span><a href="https://strudel.cc/technical-manual/project-start/" target="_blank" rel="noreferrer">Powered by Strudel</a></div>
	</section>;
}

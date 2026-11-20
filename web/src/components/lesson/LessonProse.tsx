import { useEffect, useState, type ReactNode } from "react";
import { KeatingGlyph } from "../../design-system/glyphs";
import { Button, Loading } from "../../design-system/kit";
import { MarkdownBlock } from "../MarkdownBlock";
import { MermaidRenderer } from "../MermaidRenderer";
import { LessonFrame } from "./LessonFrame";
import "./lesson-prose.css";

/**
 * Prose and figure blocks inside a reply (board L3). A titled explanation is a
 * prose frame; an untitled one is ordinary reply prose, never a card.
 */
export function LessonExplanation({ title, markdown }: { title?: string; markdown: string }) {
	if (!title) return <section className="lesson-prose-plain"><MarkdownBlock content={markdown} /></section>;
	return (
		<LessonFrame glyph="book" kind="Explanation" title={title} className="lesson-prose-frame" data-lesson="prose">
			<MarkdownBlock content={markdown} />
		</LessonFrame>
	);
}

/** A Mermaid concept map: the diagram on the bleeding grid stage, its pan/zoom/expand controls in the frame head. */
export function LessonConceptMap({ title, source }: { title?: string; source: string }) {
	const [controlsHost, setControlsHost] = useState<HTMLSpanElement | null>(null);
	return (
		<LessonFrame glyph="route" kind="Concept map" title={title} className="lesson-prose-frame" tools={<span ref={setControlsHost} className="lesson-prose-tools" data-glyph-host />}
			footer={<span className="lesson-foot-meta">Drag to pan · use the buttons to zoom</span>}>
			<MermaidRenderer content={source} chrome="none" controlsHost={controlsHost} className="lesson-stage k-grid lesson-bleed lesson-prose-bleed" />
		</LessonFrame>
	);
}

export type LessonImageStatus = "loading" | "loaded" | "failed";

/**
 * A learning image on the grid while it loads, with a mono caption under a soft
 * rule. `status` pins the state for previews; otherwise the image's own load
 * and error events drive it, and "Try again" asks the browser for it once more.
 */
export function LessonImage({ src, alt, title, caption, status: pinnedStatus, actions }: { src: string; alt: string; title?: string; caption?: string; status?: LessonImageStatus; /** Quiet footer actions, e.g. save to Materials. */ actions?: ReactNode }) {
	const [loadStatus, setLoadStatus] = useState<LessonImageStatus>("loading");
	const [attempt, setAttempt] = useState(0);
	useEffect(() => { setLoadStatus("loading"); setAttempt(0); }, [src]);
	const status = pinnedStatus ?? loadStatus;
	const retry = () => { setLoadStatus("loading"); setAttempt((count) => count + 1); };
	return (
		<LessonFrame
			glyph="image"
			kind="Image"
			title={title}
			className="lesson-prose-frame"
			data-lesson-image={status}
			footer={status === "failed" ? (
				<>
					<span className="lesson-status" data-tone="bad">Load failed</span>
					{actions}
					<Button variant="primary" size="sm" glyph="refresh" className="lesson-prose-retry" onClick={retry}>Retry</Button>
				</>
			) : actions}
		>
			<figure className="lesson-figure lesson-prose-bleed">
				<div className="lesson-stage k-grid lesson-prose-image" data-status={status}>
					{status !== "failed" ? (
						<img
							key={attempt}
							src={src}
							alt={alt}
							loading="lazy"
							onLoad={() => setLoadStatus("loaded")}
							onError={() => setLoadStatus("failed")}
						/>
					) : null}
					{status === "loading" ? <Loading size="block" label="Loading the image" /> : null}
					{status === "failed" ? (
						<div className="lesson-prose-failed" role="status" data-glyph-host>
							<KeatingGlyph name="alert" size={15} />
							<p className="lesson-prose-failed-note">The image could not be loaded.</p>
							<p className="lesson-prose-alt">{alt}</p>
						</div>
					) : null}
				</div>
				{caption && status !== "failed" ? <figcaption>{caption}</figcaption> : null}
			</figure>
		</LessonFrame>
	);
}

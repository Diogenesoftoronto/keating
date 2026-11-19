import { IconButton } from "../design-system/kit";
import { Progress } from "../design-system/charts";
import "./specialist-lessons.css";
import { useMemo, useState } from "react";
import { KeatingGlyph } from "../design-system/glyphs";
import { css, cx } from "../../styled-system/css";
import type { StoryboardScene } from "../keating/storyboard";
export type { StoryboardScene } from "../keating/storyboard";

function durationSeconds(label: string): number {
	const cleaned = label.trim().replace(/s$/i, "");
	const range = cleaned.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
	if (range) {
		return Math.max(0, Number(range[2]) - Number(range[1]));
	}
	const value = Number(cleaned);
	return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function parseStoryboard(markdown: string): { title: string; scenes: StoryboardScene[]; totalDuration: number } {
	const lines = markdown.split("\n");
	const scenes: StoryboardScene[] = [];
	let title = "";
	let current: Partial<StoryboardScene> = {};

	for (const line of lines) {
		const titleMatch = line.match(/^# Animation Storyboard: (.+)$/);
		if (titleMatch) {
			title = titleMatch[1];
			continue;
		}

		const sceneMatch = line.match(/^## Scene (\d+): (.+) \((.+)\)$/);
		if (sceneMatch) {
			if (current.title) {
				scenes.push(current as StoryboardScene);
			}
			const [, num, name, dur] = sceneMatch;
			current = { number: parseInt(num, 10), title: name, duration: dur };
			continue;
		}

		const visualMatch = line.match(/^- \*\*Visual\*\*: (.+)$/);
		if (visualMatch) current.visual = visualMatch[1];

		const audioMatch = line.match(/^- \*\*Audio\*\*: (.+)$/);
		if (audioMatch) current.audio = audioMatch[1];

		const narrMatch = line.match(/^- \*\*Narration\*\*: (.+)$/);
		if (narrMatch) current.audio = narrMatch[1];

		const transMatch = line.match(/^- \*\*Transition\*\*: (.+)$/);
		if (transMatch) current.transition = transMatch[1];

		const durMatch = line.match(/^- \*\*Duration\*\*: (\d+)s$/);
		if (durMatch) {
			current.duration = `${durMatch[1]}s`;
		}

		const highMatch = line.match(/^- \*\*Highlight\*\*: (.+)$/);
		if (highMatch) current.highlight = highMatch[1];

		const overlayMatch = line.match(/^- \*\*Overlay\*\*: (.+)$/);
		if (overlayMatch) current.highlight = overlayMatch[1];

		const stepMatch = line.match(/^- \*\*Step-through\*\*: (.+)$/);
		if (stepMatch) current.highlight = stepMatch[1];
	}

	if (current.title) scenes.push(current as StoryboardScene);

	const totalDuration = scenes.reduce((sum, scene) => sum + durationSeconds(scene.duration), 0);
	return { title, scenes, totalDuration };
}

function SceneIcon({ title }: { title: string }) {
	const t = title.toLowerCase();
	if (t.includes("intro") || t.includes("title")) return <KeatingGlyph name="book" size={18} />;
	if (t.includes("intuition")) return <KeatingGlyph name="bulb" size={18} />;
	if (t.includes("miscon")) return <KeatingGlyph name="alert" size={18} />;
	if (t.includes("transfer")) return <KeatingGlyph name="right" size={18} />;
	if (t.includes("example")) return <KeatingGlyph name="eye" size={18} />;
	if (t.includes("formal")) return <KeatingGlyph name="book" size={18} />;
	return <KeatingGlyph name="eye" size={18} />;
}

function SceneCard({ scene }: { scene: StoryboardScene }) {
	return <section className="specialist-scene-detail" data-glyph-host>
		<header><SceneIcon title={scene.title} /><strong>{scene.title}</strong><span className="specialist-caption">{scene.duration}</span></header>
		{scene.visual && <p><KeatingGlyph name="eye" size={14} />{scene.visual}</p>}
		{scene.audio && <p><KeatingGlyph name="speaker" size={14} />{scene.audio}</p>}
		{scene.transition && <p><KeatingGlyph name="right" size={14} />{scene.transition}</p>}
		{scene.highlight && <p><KeatingGlyph name="bulb" size={14} />{scene.highlight}</p>}
	</section>;
}

export function SceneRenderer({ storyboard }: { storyboard: string }) {
	const { title, scenes, totalDuration } = useMemo(() => parseStoryboard(storyboard), [storyboard]);
	const [activeIdx, setActiveIdx] = useState(0);

	if (!scenes.length) return null;

	const active = scenes[activeIdx];

	return (
		<div className="specialist-frame">
			<div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" })}>
				<div>
					<h3 className={css({ fontSize: "1rem", fontWeight: 700 })}>{title || "Animation Storyboard"}</h3>
					<p className={cx("font-terminal", css({ fontSize: "0.75rem", color: "var(--muted-foreground)" }))}>
						{scenes.length} SCENES // {totalDuration}s TOTAL
					</p>
				</div>
				<div className={css({ display: "flex", alignItems: "center", gap: "0.25rem" })}>
					<IconButton onClick={() => setActiveIdx((i) => Math.max(0, i - 1))} label="Previous scene" disabled={activeIdx === 0} glyph="chevl" />
					<span className={cx("font-terminal", css({ minWidth: "3rem", textAlign: "center", fontSize: "0.75rem" }))}>
						{activeIdx + 1}/{scenes.length}
					</span>
					<IconButton onClick={() => setActiveIdx((i) => Math.min(scenes.length - 1, i + 1))} label="Next scene" disabled={activeIdx === scenes.length - 1} glyph="chevr" />
				</div>
			</div>

			<Progress label="Scene position" done={activeIdx + 1} total={scenes.length} />
			<SceneCard scene={active} />

			<div className={css({ "& > * + *": { marginTop: "0.5rem" } })}>
				{scenes.map((s, i) => (
					<button
						key={s.number}
						onClick={() => setActiveIdx(i)}
						aria-current={i === activeIdx ? "step" : undefined}
						className="specialist-scene-choice">
						<span>{s.number}</span><strong>{s.title}</strong>
						<span className={cx("font-terminal", css({ fontSize: "0.625rem", color: "var(--muted-foreground)" }))}>{s.duration}</span>
					</button>
				))}
			</div>
		</div>
	);
}



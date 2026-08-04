import { useMemo, useState } from "react";
import { ChevronRight, ChevronLeft, Clock, Eye, Volume2, AlertTriangle, Lightbulb, BookOpen, ArrowRight } from "lucide-react";
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
	if (t.includes("intro") || t.includes("title")) return <BookOpen size={18} />;
	if (t.includes("intuition")) return <Lightbulb size={18} />;
	if (t.includes("miscon")) return <AlertTriangle size={18} />;
	if (t.includes("transfer")) return <ArrowRight size={18} />;
	if (t.includes("example")) return <Eye size={18} />;
	if (t.includes("formal")) return <BookOpen size={18} />;
	return <Eye size={18} />;
}

function SceneCard({
	scene,
	isActive,
	progress,
}: {
	scene: StoryboardScene;
	isActive: boolean;
	progress: number;
}) {
	return (
		<div
			className={css({
				borderRadius: "0.5rem",
				border: "2px solid",
				borderColor: isActive ? "var(--primary)" : "var(--border)",
				background: isActive
					? "color-mix(in srgb, var(--primary) 5%, transparent)"
					: "color-mix(in srgb, var(--muted) 20%, transparent)",
				padding: "1rem",
				opacity: isActive ? 1 : 0.9,
				boxShadow: isActive ? "var(--shadow-sm)" : undefined,
				transition: "all 150ms",
			})}
		>
			<div className={css({ marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.75rem" })}>
				<div className={css({
					display: "flex",
					height: "2rem",
					width: "2rem",
					flexShrink: 0,
					alignItems: "center",
					justifyContent: "center",
					borderRadius: "9999px",
					background: isActive ? "var(--primary)" : "var(--muted)",
					color: isActive ? "var(--primary-foreground)" : "var(--muted-foreground)",
				})}>
					<SceneIcon title={scene.title} />
				</div>
				<div className={css({ minWidth: 0, flex: 1 })}>
					<div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between" })}>
						<span className={css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.875rem", fontWeight: 600 })}>{scene.title}</span>
						<span className={cx("font-terminal", css({ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.75rem", color: "var(--muted-foreground)" }))}>
							<Clock size={12} />
							{scene.duration}
						</span>
					</div>
					{isActive && (
						<div className={css({ marginTop: "0.25rem", height: "0.25rem", width: "100%", overflow: "hidden", borderRadius: "9999px", background: "var(--muted)" })}>
							<div
								className={css({ height: "100%", borderRadius: "9999px", background: "var(--primary)", transition: "all 150ms" })}
								style={{ width: `${progress}%` }}
							/>
						</div>
					)}
				</div>
			</div>

			{scene.visual && (
				<div className={css({ marginBottom: "0.5rem", borderRadius: "0.375rem", background: "color-mix(in srgb, var(--muted) 50%, transparent)", padding: "0.75rem" })}>
					<div className={css({ display: "flex", alignItems: "flex-start", gap: "0.5rem" })}>
						<Eye size={14} className={css({ marginTop: "0.125rem", flexShrink: 0, color: "var(--muted-foreground)" })} />
						<p className={css({ fontSize: "0.75rem", lineHeight: "1.25rem" })}>{scene.visual}</p>
					</div>
				</div>
			)}

			<div className={css({ display: "flex", flexWrap: "wrap", columnGap: "1rem", rowGap: "0.25rem" })}>
				{scene.audio && (
					<div className={css({ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
						<Volume2 size={12} />
						<span className={css({ maxWidth: "240px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>{scene.audio}</span>
					</div>
				)}
				{scene.transition && (
					<div className={css({ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
						<ArrowRight size={12} />
						<span>{scene.transition}</span>
					</div>
				)}
				{scene.highlight && (
					<div className={css({ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.75rem", color: "var(--accent)" })}>
						<Lightbulb size={12} />
						<span className={css({ maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>{scene.highlight}</span>
					</div>
				)}
			</div>
		</div>
	);
}

export function SceneRenderer({ storyboard }: { storyboard: string }) {
	const { title, scenes, totalDuration } = useMemo(() => parseStoryboard(storyboard), [storyboard]);
	const [activeIdx, setActiveIdx] = useState(0);

	if (!scenes.length) return null;

	const active = scenes[activeIdx];

	return (
		<div className={css({
			marginBlock: "0.75rem",
			borderRadius: "0.75rem",
			border: "2px solid var(--border)",
			background: "var(--background)",
			padding: { base: "1rem", sm: "1.25rem" },
			boxShadow: "var(--shadow-sm)",
			"& > * + *": { marginTop: "1rem" },
		})}>
			<div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" })}>
				<div>
					<h3 className={css({ fontSize: "1rem", fontWeight: 700 })}>{title || "Animation Storyboard"}</h3>
					<p className={cx("font-terminal", css({ fontSize: "0.75rem", color: "var(--muted-foreground)" }))}>
						{scenes.length} SCENES // {totalDuration}s TOTAL
					</p>
				</div>
				<div className={css({ display: "flex", alignItems: "center", gap: "0.25rem" })}>
					<button
						onClick={() => setActiveIdx((i) => Math.max(0, i - 1))}
						disabled={activeIdx === 0}
						className={css({
							display: "inline-flex",
							height: "2rem",
							width: "2rem",
							alignItems: "center",
							justifyContent: "center",
							borderRadius: "0.375rem",
							border: "1px solid var(--border)",
							color: "var(--muted-foreground)",
							transition: "color 150ms, background-color 150ms",
							_hover: { background: "var(--accent)" },
							_disabled: { opacity: 0.3 },
						})}
					>
						<ChevronLeft size={16} />
					</button>
					<span className={cx("font-terminal", css({ minWidth: "3rem", textAlign: "center", fontSize: "0.75rem" }))}>
						{activeIdx + 1}/{scenes.length}
					</span>
					<button
						onClick={() => setActiveIdx((i) => Math.min(scenes.length - 1, i + 1))}
						disabled={activeIdx === scenes.length - 1}
						className={css({
							display: "inline-flex",
							height: "2rem",
							width: "2rem",
							alignItems: "center",
							justifyContent: "center",
							borderRadius: "0.375rem",
							border: "1px solid var(--border)",
							color: "var(--muted-foreground)",
							transition: "color 150ms, background-color 150ms",
							_hover: { background: "var(--accent)" },
							_disabled: { opacity: 0.3 },
						})}
					>
						<ChevronRight size={16} />
					</button>
				</div>
			</div>

			<SceneCard scene={active} isActive={true} progress={60} />

			<div className={css({ "& > * + *": { marginTop: "0.5rem" } })}>
				{scenes.map((s, i) => (
					<button
						key={s.number}
						onClick={() => setActiveIdx(i)}
						className={css({
							display: "flex",
							width: "100%",
							alignItems: "center",
							gap: "0.75rem",
							borderRadius: "0.375rem",
							border: "1px solid",
							borderColor: i === activeIdx ? "color-mix(in srgb, var(--primary) 30%, transparent)" : "transparent",
							background: i === activeIdx
								? "color-mix(in srgb, var(--primary) 10%, transparent)"
								: "color-mix(in srgb, var(--muted) 30%, transparent)",
							padding: "0.5rem 0.75rem",
							textAlign: "left",
							transition: "all 150ms",
							_hover: i === activeIdx ? undefined : { background: "color-mix(in srgb, var(--muted) 50%, transparent)" },
						})}
					>
						<div className={css({ display: "flex", height: "1.5rem", width: "1.5rem", flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: "9999px", background: "var(--muted)", fontSize: "0.625rem", fontWeight: 700, color: "var(--muted-foreground)" })}>
							{s.number}
						</div>
						<span className={css({ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.75rem", fontWeight: 500 })}>{s.title}</span>
						<span className={cx("font-terminal", css({ fontSize: "0.625rem", color: "var(--muted-foreground)" }))}>{s.duration}</span>
					</button>
				))}
			</div>
		</div>
	);
}

// Needed for useMemo import

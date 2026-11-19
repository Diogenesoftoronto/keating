import { Stat } from "../design-system/charts";
import { Button, EmptyState, IconButton } from "../design-system/kit";
import { PlaybackPosition } from "./PlaybackPosition";
import { useMotionAllowed } from "../design-system/motion";
import { useEffect, useMemo, useState } from "react";
import { KeatingGlyph } from "../design-system/glyphs";
import { css, cx } from "../../styled-system/css";
import { SceneRenderer, parseStoryboard, type StoryboardScene } from "./SceneRenderer";
import { HyperframesPlayer } from "./HyperframesPlayer";

interface AnimationPlayerProps {
	scene?: string;
	manifest?: string;
	storyboard?: string;
	renderer?: "hyperframes";
	className?: string;
}

interface Manifest {
	topic: string;
	slug: string;
	renderer?: string;
	kind?: string;
	compositionId?: string;
	width?: number;
	height?: number;
	scenes: string[];
	duration: number;
}

function durationSeconds(label: string): number {
	const cleaned = label.trim().replace(/s$/i, "");
	const range = cleaned.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
	if (range) return Math.max(0.5, Number(range[2]) - Number(range[1]));
	const value = Number(cleaned);
	return Number.isFinite(value) ? Math.max(0.5, value) : 4;
}

function sceneDuration(scene: StoryboardScene): number {
	return durationSeconds(scene.duration);
}

function visualTokens(scene: StoryboardScene): string[] {
	const source = `${scene.title} ${scene.visual} ${scene.highlight ?? ""}`;
	return source
		.split(/[^a-z0-9]+/i)
		.map((token) => token.trim())
		.filter((token) => token.length >= 4)
		.slice(0, 6);
}

function AnimatedStoryboardStage({
	title,
	scenes,
	totalDuration,
}: {
	title: string;
	scenes: StoryboardScene[];
	totalDuration: number;
}) {
	const [activeIdx, setActiveIdx] = useState(0);
	const motion = useMotionAllowed();
	const [playing, setPlaying] = useState(motion);
	useEffect(() => { if (!motion) setPlaying(false); }, [motion]);
	const [elapsed, setElapsed] = useState(0);
	const active = scenes[activeIdx];
	const duration = active ? sceneDuration(active) : 1;
	const progress = Math.min(1, elapsed / duration);
	const tokens = useMemo(() => (active ? visualTokens(active) : []), [active]);

	useEffect(() => {
		setElapsed(0);
	}, [activeIdx]);

	useEffect(() => {
		if (!playing || !active) return;
		let frame = 0;
		let last = performance.now();
		const tick = (now: number) => {
			const delta = (now - last) / 1000;
			last = now;
			setElapsed((current) => {
				const next = current + delta;
				if (next >= duration) {
					setActiveIdx((index) => (index + 1) % scenes.length);
					return 0;
				}
				return next;
			});
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [active, duration, playing, scenes.length]);

	if (!active) return null;

	const goTo = (index: number) => {
		setActiveIdx((index + scenes.length) % scenes.length);
		setElapsed(0);
	};

	return (
		<div className={css({ display: "grid", gap: "0.75rem" })}>
			<div className={css({ position: "relative", aspectRatio: "16 / 9", overflow: "hidden", borderRadius: "0.5rem", border: "1px solid var(--border)", background: "var(--paper-deep)", color: "var(--ink)" })}>
				<div aria-hidden="true" className="specialist-stage-grid k-grid" />
				<div
					key={active.number}
					className={css({
						position: "absolute",
						inset: 0,
						display: "grid",
						gridTemplateColumns: "1fr 1.1fr",
						gap: "1.5rem",
						padding: "1.5rem",
						"@media (min-width: 640px)": { padding: "2rem" },
					})}
				>
					<div className={css({ position: "relative", display: "flex", minWidth: 0, flexDirection: "column", justifyContent: "space-between" })}>
						<div>
							<div className={cx("font-terminal", css({ marginBottom: "0.75rem", display: "inline-flex", borderRadius: "0.25rem", border: "1px solid var(--line)", background: "var(--card)", padding: "0.25rem 0.5rem", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.025em", color: "var(--ink)" }))}>
								Scene {active.number} / {scenes.length}
							</div>
							<h3 className={css({ maxWidth: "18rem", fontSize: "1.25rem", fontWeight: 600, lineHeight: 1.25, color: "var(--ink)", "@media (min-width: 640px)": { fontSize: "1.875rem" } })}>
								{active.title}
							</h3>
						</div>
						<p className={css({ maxWidth: "28rem", fontSize: "0.75rem", lineHeight: "1.25rem", color: "var(--ink-soft)", "@media (min-width: 640px)": { fontSize: "0.875rem" } })}>
							{active.visual}
						</p>
					</div>
					<div className={css({ position: "relative", minHeight: 0 })}>
						<div className={css({ position: "absolute", left: "50%", top: "50%", height: "10rem", width: "10rem", transform: "translate(-50%, -50%)", borderRadius: "9999px", border: "1px solid var(--line)", background: "var(--card)", "@media (min-width: 640px)": { height: "14rem", width: "14rem" }, "@media (prefers-reduced-motion: no-preference)": { animation: "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite" } })} />
						<div
							className={css({ position: "absolute", left: "50%", top: "50%", height: "6rem", width: "6rem", borderRadius: "9999px", border: "2px solid var(--series-3)", background: "var(--card)", transitionProperty: "transform", transitionDuration: "300ms" })}
							style={{ transform: `translate(-50%, -50%) rotate(${progress * 180}deg) scale(${1 + progress * 0.08})` }}
						>
							<div className={css({ position: "absolute", left: "50%", top: 0, height: "50%", width: "0.125rem", transform: "translateX(-50%)", background: "var(--series-3)" })} />
							<div className={css({ position: "absolute", bottom: 0, left: "50%", height: "50%", width: "0.125rem", transform: "translateX(-50%)", background: "var(--series-1)" })} />
							<div className={css({ position: "absolute", left: 0, top: "50%", height: "0.125rem", width: "50%", transform: "translateY(-50%)", background: "var(--series-2)" })} />
							<div className={css({ position: "absolute", right: 0, top: "50%", height: "0.125rem", width: "50%", transform: "translateY(-50%)", background: "var(--ink-soft)" })} />
						</div>
						{tokens.map((token, index) => {
							const angle = (index / Math.max(1, tokens.length)) * Math.PI * 2 + progress * Math.PI * 0.65;
							const radius = 36 + (index % 3) * 14;
							const x = 50 + Math.cos(angle) * radius;
							const y = 50 + Math.sin(angle) * radius;
							return (
								<div
									key={`${active.number}-${token}-${index}`}
									className={css({ position: "absolute", maxWidth: "7rem", borderRadius: "0.25rem", border: "1px solid var(--line)", background: "var(--card)", padding: "0.25rem 0.5rem", textAlign: "center", fontSize: "10px", fontWeight: 500, color: "var(--ink)", boxShadow: "var(--shadow-sm, 0 1px 2px rgb(0 0 0 / 0.05))", backdropFilter: "blur(8px)" })}
									style={{ left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)" }}
								>
									{token}
								</div>
							);
						})}
					</div>
				</div>

			</div>

			<PlaybackPosition label="Scene position" value={elapsed} max={duration} onSeek={value=>{setElapsed(value);setPlaying(false);}} />

			<div className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" })}>
				<div className={css({ minWidth: 0 })}>
					<div className={css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.875rem", fontWeight: 500 })}>{title || "Animation"}</div>
					<div className={cx("font-terminal", css({ fontSize: "11px", color: "var(--muted-foreground)" }))}>
						{scenes.length} scenes // {totalDuration}s
					</div>
				</div>
				<div className={css({ display: "flex", alignItems: "center", gap: "0.25rem" })}>
					<IconButton onClick={() => goTo(activeIdx - 1)} label="Previous scene" glyph="chevl" />
					<Button variant="ghost" onClick={() => setPlaying(value => !value)}>
						{playing ? <KeatingGlyph name="pause" size={14} /> : <KeatingGlyph name="play" size={14} />}
						{playing ? "Pause" : "Play"}
					</Button>
					<IconButton onClick={() => { setElapsed(0); setPlaying(true); }} label="Restart scene" glyph="refresh" />
					<IconButton onClick={() => goTo(activeIdx + 1)} label="Next scene" glyph="chevr" />
				</div>
			</div>

			<div className={css({ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "0.25rem", "@media (min-width: 640px)": { gridTemplateColumns: "repeat(6, minmax(0, 1fr))" } })}>
				{scenes.map((scene, index) => (
					<button
						key={scene.number}
						type="button"
						onClick={() => goTo(index)}
						className="specialist-scene-choice" aria-current={index === activeIdx ? "step" : undefined}>
						<span>{scene.title}</span>
					</button>
				))}
			</div>
		</div>
	);
}

export function AnimationPlayer({ scene, manifest, storyboard, renderer: storedRenderer, className }: AnimationPlayerProps) {
	const [showSource, setShowSource] = useState(false);

	// Parse manifest
	let manifestData: Manifest | null = null;
	if (manifest) {
		try {
			manifestData = JSON.parse(manifest);
		} catch {
			// Invalid JSON
		}
	}

	const storyboardData = storyboard ? parseStoryboard(storyboard) : null;
	const renderer = manifestData?.renderer === "hyperframes" || manifestData?.kind === "hyperframes" || storedRenderer === "hyperframes"
		? "hyperframes"
		: undefined;
	const sceneLooksLikeHtml = scene?.trim().toLowerCase().startsWith("<!doctype") || scene?.trim().toLowerCase().startsWith("<html");
	const canRenderHyperframes = Boolean(scene && (renderer === "hyperframes" || sceneLooksLikeHtml));

	return (
		// One surface: no card fill, no tinted header/footer bands. The topic is the
		// heading, and the renderer name is dropped — it repeated the footer and
		// means nothing to a learner.
		<div className={cx("specialist-frame animation-player", css({ display: "grid", gap: "1rem" }), className)}>
			<div className={css({ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "1rem" })}>
				<div className={css({ minWidth: 0 })}>
					<h3 className="specialist-scene-heading">
						{manifestData?.topic ?? "Animation"}
					</h3>
					{manifestData && (
						<div className="specialist-stats">
							{Number.isFinite(manifestData.duration) && <Stat label="Duration" value={`${manifestData.duration}s`} />}
							<Stat label="Scenes" value={Array.isArray(manifestData.scenes) ? manifestData.scenes.length : 0} />
						</div>
					)}
				</div>
				<button
					onClick={() => setShowSource(!showSource)}
					className={css({ flexShrink: 0, borderRadius: "0.25rem", padding: "0.25rem 0.5rem", fontSize: "0.75rem", color: "var(--muted-foreground)", transitionProperty: "color, background-color", _hover: { background: "var(--accent)", color: "var(--accent-foreground)" } })}
				>
					{showSource ? "Hide" : "Show"} source
				</button>
			</div>

			{/* Content */}
			<div>
				{canRenderHyperframes && scene ? (
					<HyperframesPlayer
						title={`${manifestData?.topic ?? "Keating"} Hyperframes composition`}
						html={scene} duration={manifestData?.duration}
					/>
				) : storyboardData?.scenes.length ? (
					<div className={css({ display: "grid", gap: "0.75rem" })}>
						<AnimatedStoryboardStage
							title={storyboardData.title}
							scenes={storyboardData.scenes}
							totalDuration={storyboardData.totalDuration}
						/>
						<details className="specialist-notes">
							<summary className={css({ cursor: "pointer", fontSize: "0.75rem", fontWeight: 500, color: "var(--muted-foreground)" })}>
								Storyboard notes
							</summary>
							<SceneRenderer storyboard={storyboard ?? ""} />
						</details>
					</div>
				) : scene ? (
					<div className={css({ display: "grid", gap: "0.75rem" })}>
						<h3 className={css({ fontWeight: 500 })}>Scene Source</h3>
						<pre className={css({ maxHeight: "16rem", overflow: "auto", borderRadius: "0.25rem", background: "color-mix(in srgb, var(--muted) 30%, transparent)", padding: "0.75rem", whiteSpace: "pre-wrap", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
							{scene}
						</pre>
					</div>
				) : (
					<EmptyState heading="No animation loaded" glyph="play" />
				)}

				{showSource && storyboard && (
					<div className={css({ marginTop: "0.75rem", display: "grid", gap: "0.5rem" })}>
						<div className={css({ fontSize: "0.75rem", fontWeight: 500, color: "var(--muted-foreground)" })}>
							Storyboard Source ({storyboardData?.scenes.length ?? 0} scenes)
						</div>
						<pre className={css({ maxHeight: "16rem", overflow: "auto", borderRadius: "0.25rem", background: "color-mix(in srgb, var(--muted) 30%, transparent)", padding: "0.75rem", whiteSpace: "pre-wrap", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
							{storyboard}
						</pre>
					</div>
				)}

				{showSource && scene && (
					<div className={css({ marginTop: "0.75rem", display: "grid", gap: "0.5rem" })}>
						<div className={css({ fontSize: "0.75rem", fontWeight: 500, color: "var(--muted-foreground)" })}>
							{canRenderHyperframes ? "Hyperframes HTML" : "Scene Source"}
						</div>
						<pre className={css({ maxHeight: "16rem", overflow: "auto", borderRadius: "0.25rem", background: "color-mix(in srgb, var(--muted) 30%, transparent)", padding: "0.75rem", whiteSpace: "pre-wrap", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
							{scene}
						</pre>
					</div>
				)}
				</div>
		</div>
	);
}

// Component to extract and render animation from stored data
export function AnimationPreview({
	storyboard,
	scene,
	manifest,
	compact = false,
}: {
	storyboard?: string;
	scene?: string;
	manifest?: string;
	compact?: boolean;
}) {
	const [expanded, setExpanded] = useState(!compact);

	if (!storyboard && !scene) {
		return null;
	}

	if (!expanded) {
		return (
			<button
				onClick={() => setExpanded(true)}
				className={css({ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.75rem", color: "var(--primary)", _hover: { textDecoration: "underline" } })}
			>
				Show Animation
			</button>
		);
	}

	return (
		<div className={css({ marginBlock: "1rem" })}>
			{compact && (
				<button onClick={() => setExpanded(false)} className={css({ marginBottom: "0.5rem", fontSize: "0.75rem", color: "var(--muted-foreground)", _hover: { textDecoration: "underline" } })}>
					Collapse
				</button>
			)}
			<AnimationPlayer storyboard={storyboard} scene={scene} manifest={manifest} />
		</div>
	);
}

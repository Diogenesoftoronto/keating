import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";
import { css, cx } from "../../styled-system/css";
import { SceneRenderer, parseStoryboard } from "./SceneRenderer";
import { buildManimSceneHtml } from "./animation-host";

interface AnimationPlayerProps {
	scene?: string;
	manifest?: string;
	storyboard?: string;
	renderer?: "manim" | "hyperframes";
	className?: string;
}

interface Manifest {
	topic: string;
	slug: string;
	renderer?: "manim" | "hyperframes";
	kind?: "manim" | "hyperframes";
	compositionId?: string;
	width?: number;
	height?: number;
	scenes: string[];
	duration: number;
}

interface StoryboardScene {
	number: number;
	title: string;
	duration: string;
	visual: string;
	audio?: string;
	transition?: string;
	highlight?: string;
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
	const [playing, setPlaying] = useState(true);
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
			<div className={css({ position: "relative", aspectRatio: "16 / 9", overflow: "hidden", borderRadius: "0.5rem", border: "1px solid var(--border)", background: "#0a0a0a", color: "white" })}>
				<div className={css({ position: "absolute", inset: 0, background: "radial-gradient(circle at 20% 20%, rgba(34,197,94,0.24), transparent 32%), radial-gradient(circle at 80% 30%, rgba(245,158,11,0.28), transparent 30%), linear-gradient(135deg, #050505, #111827 52%, #1f1305)" })} />
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
							<div className={cx("font-terminal", css({ marginBottom: "0.75rem", display: "inline-flex", borderRadius: "0.25rem", border: "1px solid rgb(251 191 36 / 0.5)", background: "rgb(0 0 0 / 0.3)", padding: "0.25rem 0.5rem", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.025em", color: "#fde68a" }))}>
								Scene {active.number} / {scenes.length}
							</div>
							<h3 className={css({ maxWidth: "18rem", fontSize: "1.25rem", fontWeight: 600, lineHeight: 1.25, color: "white", "@media (min-width: 640px)": { fontSize: "1.875rem" } })}>
								{active.title}
							</h3>
						</div>
						<p className={css({ maxWidth: "28rem", fontSize: "0.75rem", lineHeight: "1.25rem", color: "#e5e5e5", "@media (min-width: 640px)": { fontSize: "0.875rem" } })}>
							{active.visual}
						</p>
					</div>
					<div className={css({ position: "relative", minHeight: 0 })}>
						<div className={css({ position: "absolute", left: "50%", top: "50%", height: "10rem", width: "10rem", transform: "translate(-50%, -50%)", borderRadius: "9999px", border: "1px solid rgb(110 231 183 / 0.5)", background: "rgb(110 231 183 / 0.1)", "@media (min-width: 640px)": { height: "14rem", width: "14rem" }, "@media (prefers-reduced-motion: no-preference)": { animation: "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite" } })} />
						<div
							className={css({ position: "absolute", left: "50%", top: "50%", height: "6rem", width: "6rem", borderRadius: "9999px", border: "2px solid rgb(252 211 77 / 0.8)", background: "rgb(0 0 0 / 0.35)", boxShadow: "0 0 36px rgba(245,158,11,0.35)", transitionProperty: "transform", transitionDuration: "300ms" })}
							style={{ transform: `translate(-50%, -50%) rotate(${progress * 180}deg) scale(${1 + progress * 0.08})` }}
						>
							<div className={css({ position: "absolute", left: "50%", top: 0, height: "50%", width: "0.125rem", transform: "translateX(-50%)", background: "#fcd34d" })} />
							<div className={css({ position: "absolute", bottom: 0, left: "50%", height: "50%", width: "0.125rem", transform: "translateX(-50%)", background: "#6ee7b7" })} />
							<div className={css({ position: "absolute", left: 0, top: "50%", height: "0.125rem", width: "50%", transform: "translateY(-50%)", background: "#7dd3fc" })} />
							<div className={css({ position: "absolute", right: 0, top: "50%", height: "0.125rem", width: "50%", transform: "translateY(-50%)", background: "#fda4af" })} />
						</div>
						{tokens.map((token, index) => {
							const angle = (index / Math.max(1, tokens.length)) * Math.PI * 2 + progress * Math.PI * 0.65;
							const radius = 36 + (index % 3) * 14;
							const x = 50 + Math.cos(angle) * radius;
							const y = 50 + Math.sin(angle) * radius;
							return (
								<div
									key={`${active.number}-${token}-${index}`}
									className={css({ position: "absolute", maxWidth: "7rem", borderRadius: "0.25rem", border: "1px solid rgb(255 255 255 / 0.15)", background: "rgb(0 0 0 / 0.45)", padding: "0.25rem 0.5rem", textAlign: "center", fontSize: "10px", fontWeight: 500, color: "white", boxShadow: "var(--shadow-sm, 0 1px 2px rgb(0 0 0 / 0.05))", backdropFilter: "blur(8px)" })}
									style={{ left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)" }}
								>
									{token}
								</div>
							);
						})}
					</div>
				</div>
				<div className={css({ position: "absolute", bottom: 0, left: 0, right: 0, height: "0.25rem", background: "rgb(255 255 255 / 0.15)" })}>
					<div className={css({ height: "100%", background: "#fcd34d", transitionProperty: "width" })} style={{ width: `${progress * 100}%` }} />
				</div>
			</div>

			<div className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" })}>
				<div className={css({ minWidth: 0 })}>
					<div className={css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.875rem", fontWeight: 500 })}>{title || "Animation"}</div>
					<div className={cx("font-terminal", css({ fontSize: "11px", color: "var(--muted-foreground)" }))}>
						{scenes.length} scenes // {totalDuration}s
					</div>
				</div>
				<div className={css({ display: "flex", alignItems: "center", gap: "0.25rem" })}>
					<button type="button" onClick={() => goTo(activeIdx - 1)} className={css({ display: "inline-flex", height: "2rem", width: "2rem", alignItems: "center", justifyContent: "center", borderRadius: "0.375rem", border: "1px solid var(--border)", _hover: { background: "var(--accent)" } })} aria-label="Previous scene">
						<ChevronLeft size={15} />
					</button>
					<button type="button" onClick={() => setPlaying((value) => !value)} className={css({ display: "inline-flex", height: "2rem", alignItems: "center", gap: "0.25rem", borderRadius: "0.375rem", border: "1px solid var(--border)", paddingInline: "0.5rem", fontSize: "0.75rem", fontWeight: 500, _hover: { background: "var(--accent)" } })}>
						{playing ? <Pause size={14} /> : <Play size={14} />}
						{playing ? "Pause" : "Play"}
					</button>
					<button type="button" onClick={() => { setElapsed(0); setPlaying(true); }} className={css({ display: "inline-flex", height: "2rem", width: "2rem", alignItems: "center", justifyContent: "center", borderRadius: "0.375rem", border: "1px solid var(--border)", _hover: { background: "var(--accent)" } })} aria-label="Restart scene">
						<RotateCcw size={14} />
					</button>
					<button type="button" onClick={() => goTo(activeIdx + 1)} className={css({ display: "inline-flex", height: "2rem", width: "2rem", alignItems: "center", justifyContent: "center", borderRadius: "0.375rem", border: "1px solid var(--border)", _hover: { background: "var(--accent)" } })} aria-label="Next scene">
						<ChevronRight size={15} />
					</button>
				</div>
			</div>

			<div className={css({ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "0.25rem", "@media (min-width: 640px)": { gridTemplateColumns: "repeat(6, minmax(0, 1fr))" } })}>
				{scenes.map((scene, index) => (
					<button
						key={scene.number}
						type="button"
						onClick={() => goTo(index)}
						className={css({
							minWidth: 0,
							borderRadius: "0.375rem",
							border: "1px solid",
							borderColor: index === activeIdx ? "var(--primary)" : "var(--border)",
							background: index === activeIdx ? "color-mix(in srgb, var(--primary) 10%, transparent)" : "var(--background)",
							padding: "0.375rem 0.5rem",
							textAlign: "left",
							fontSize: "11px",
							color: index === activeIdx ? "var(--primary)" : undefined,
							transitionProperty: "color, background-color, border-color",
							_hover: index === activeIdx ? undefined : { background: "var(--accent)" },
						})}
					>
						<span className={css({ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>{scene.title}</span>
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
	const renderer = manifestData?.renderer ?? manifestData?.kind ?? storedRenderer;
	const isHyperframes = renderer === "hyperframes";
	const isManim = renderer === "manim";

	return (
		<div className={cx("animation-player", css({ overflow: "hidden", borderRadius: "0.5rem", background: "color-mix(in srgb, var(--muted) 20%, transparent)" }), className)}>
			{/* Header */}
			<div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)", background: "color-mix(in srgb, var(--muted) 30%, transparent)", padding: "0.5rem 1rem" })}>
				<div className={css({ display: "flex", alignItems: "center", gap: "0.5rem" })}>
					<span className={css({ fontSize: "0.875rem", fontWeight: 500 })}>Animation</span>
					{manifestData && <span className={css({ fontSize: "0.75rem", color: "var(--muted-foreground)" })}>({manifestData.topic})</span>}
					{isHyperframes && <span className={css({ fontSize: "0.75rem", color: "var(--muted-foreground)" })}>Hyperframes</span>}
				</div>
				<div className={css({ display: "flex", alignItems: "center", gap: "0.5rem" })}>
					<button
						onClick={() => setShowSource(!showSource)}
						className={css({ borderRadius: "0.25rem", background: "var(--muted)", padding: "0.25rem 0.5rem", fontSize: "0.75rem", transitionProperty: "color, background-color, border-color", _hover: { background: "color-mix(in srgb, var(--muted) 80%, transparent)" } })}
					>
						{showSource ? "Hide" : "Show"} Source
					</button>
				</div>
			</div>

			{/* Content */}
			<div className={css({ padding: "1rem" })}>
				{isHyperframes && scene ? (
					<iframe
						title={`${manifestData?.topic ?? "Keating"} Hyperframes composition`}
						srcDoc={scene}
						sandbox="allow-scripts"
						className={css({ aspectRatio: "16 / 9", width: "100%", borderRadius: "0.375rem", border: "1px solid var(--border)", background: "black" })}
					/>
				) : isManim && scene ? (
					<div className={css({ display: "grid", gap: "0.75rem" })}>
						<iframe
							title={`${manifestData?.topic ?? "Keating"} manim animation`}
							srcDoc={buildManimSceneHtml(scene, manifestData?.topic ?? "Keating Animation")}
							sandbox="allow-scripts"
							className={css({ aspectRatio: "16 / 9", width: "100%", borderRadius: "0.375rem", border: "1px solid var(--border)", background: "black" })}
						/>
						{storyboardData?.scenes.length ? (
							<details className={css({ borderRadius: "0.375rem", border: "1px solid var(--border)", background: "color-mix(in srgb, var(--background) 70%, transparent)", padding: "0.75rem" })}>
								<summary className={css({ cursor: "pointer", fontSize: "0.75rem", fontWeight: 500, color: "var(--muted-foreground)" })}>
									Storyboard notes
								</summary>
								<SceneRenderer storyboard={storyboard ?? ""} />
							</details>
						) : null}
					</div>
				) : storyboardData?.scenes.length ? (
					<div className={css({ display: "grid", gap: "0.75rem" })}>
						<AnimatedStoryboardStage
							title={storyboardData.title}
							scenes={storyboardData.scenes}
							totalDuration={storyboardData.totalDuration}
						/>
						<details className={css({ borderRadius: "0.375rem", border: "1px solid var(--border)", background: "color-mix(in srgb, var(--background) 70%, transparent)", padding: "0.75rem" })}>
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
					<div className={css({ paddingBlock: "2rem", textAlign: "center", color: "var(--muted-foreground)" })}>No animation loaded</div>
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
							{isHyperframes ? "Hyperframes HTML" : "Scene Code"}
						</div>
						<pre className={css({ maxHeight: "16rem", overflow: "auto", borderRadius: "0.25rem", background: "color-mix(in srgb, var(--muted) 30%, transparent)", padding: "0.75rem", whiteSpace: "pre-wrap", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
							{scene}
						</pre>
					</div>
				)}
				</div>

			{/* Manifest Info */}
			{manifestData && (
				<div className={css({ borderTop: "1px solid var(--border)", background: "color-mix(in srgb, var(--muted) 30%, transparent)", padding: "0.5rem 1rem", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
					<span className={css({ marginRight: "1rem" })}>Duration: {manifestData.duration ?? 0}s</span>
					<span>Scenes: {Array.isArray(manifestData.scenes) ? manifestData.scenes.length : 0}</span>
					{renderer && <span className={css({ marginLeft: "1rem" })}>Renderer: {renderer}</span>}
				</div>
			)}

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

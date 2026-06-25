import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";
import { SceneRenderer, parseStoryboard } from "./SceneRenderer";

interface AnimationPlayerProps {
	scene?: string;
	manifest?: string;
	storyboard?: string;
	className?: string;
}

interface Manifest {
	topic: string;
	slug: string;
	renderer?: "manim" | "hyperframes";
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
		<div className="space-y-3">
			<div className="relative aspect-video overflow-hidden rounded-lg border border-border bg-neutral-950 text-white">
				<div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(34,197,94,0.24),transparent_32%),radial-gradient(circle_at_80%_30%,rgba(245,158,11,0.28),transparent_30%),linear-gradient(135deg,#050505,#111827_52%,#1f1305)]" />
				<div
					key={active.number}
					className="absolute inset-0 grid grid-cols-[1fr_1.1fr] gap-6 p-6 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300 sm:p-8"
				>
					<div className="relative flex min-w-0 flex-col justify-between">
						<div>
							<div className="mb-3 inline-flex rounded border border-amber-400/50 bg-black/30 px-2 py-1 font-terminal text-[10px] uppercase tracking-wide text-amber-200">
								Scene {active.number} / {scenes.length}
							</div>
							<h3 className="max-w-[18rem] text-xl font-semibold leading-tight text-white sm:text-3xl">
								{active.title}
							</h3>
						</div>
						<p className="max-w-md text-xs leading-5 text-neutral-200 sm:text-sm">
							{active.visual}
						</p>
					</div>
					<div className="relative min-h-0">
						<div className="absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-300/50 bg-emerald-300/10 motion-safe:animate-pulse sm:h-56 sm:w-56" />
						<div
							className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-300/80 bg-black/35 shadow-[0_0_36px_rgba(245,158,11,0.35)] transition-transform duration-300"
							style={{ transform: `translate(-50%, -50%) rotate(${progress * 180}deg) scale(${1 + progress * 0.08})` }}
						>
							<div className="absolute left-1/2 top-0 h-1/2 w-0.5 -translate-x-1/2 bg-amber-300" />
							<div className="absolute bottom-0 left-1/2 h-1/2 w-0.5 -translate-x-1/2 bg-emerald-300" />
							<div className="absolute left-0 top-1/2 h-0.5 w-1/2 -translate-y-1/2 bg-sky-300" />
							<div className="absolute right-0 top-1/2 h-0.5 w-1/2 -translate-y-1/2 bg-rose-300" />
						</div>
						{tokens.map((token, index) => {
							const angle = (index / Math.max(1, tokens.length)) * Math.PI * 2 + progress * Math.PI * 0.65;
							const radius = 36 + (index % 3) * 14;
							const x = 50 + Math.cos(angle) * radius;
							const y = 50 + Math.sin(angle) * radius;
							return (
								<div
									key={`${active.number}-${token}-${index}`}
									className="absolute max-w-28 rounded border border-white/15 bg-black/45 px-2 py-1 text-center text-[10px] font-medium text-white shadow-sm backdrop-blur"
									style={{ left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)" }}
								>
									{token}
								</div>
							);
						})}
					</div>
				</div>
				<div className="absolute bottom-0 left-0 right-0 h-1 bg-white/15">
					<div className="h-full bg-amber-300 transition-[width]" style={{ width: `${progress * 100}%` }} />
				</div>
			</div>

			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="min-w-0">
					<div className="truncate text-sm font-medium">{title || "Animation"}</div>
					<div className="font-terminal text-[11px] text-muted-foreground">
						{scenes.length} scenes // {totalDuration}s
					</div>
				</div>
				<div className="flex items-center gap-1">
					<button type="button" onClick={() => goTo(activeIdx - 1)} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-accent" aria-label="Previous scene">
						<ChevronLeft size={15} />
					</button>
					<button type="button" onClick={() => setPlaying((value) => !value)} className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs font-medium hover:bg-accent">
						{playing ? <Pause size={14} /> : <Play size={14} />}
						{playing ? "Pause" : "Play"}
					</button>
					<button type="button" onClick={() => { setElapsed(0); setPlaying(true); }} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-accent" aria-label="Restart scene">
						<RotateCcw size={14} />
					</button>
					<button type="button" onClick={() => goTo(activeIdx + 1)} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-accent" aria-label="Next scene">
						<ChevronRight size={15} />
					</button>
				</div>
			</div>

			<div className="grid grid-cols-3 gap-1 sm:grid-cols-6">
				{scenes.map((scene, index) => (
					<button
						key={scene.number}
						type="button"
						onClick={() => goTo(index)}
						className={`min-w-0 rounded-md border px-2 py-1.5 text-left text-[11px] transition-colors ${
							index === activeIdx
								? "border-primary bg-primary/10 text-primary"
								: "border-border bg-background hover:bg-accent"
						}`}
					>
						<span className="block truncate">{scene.title}</span>
					</button>
				))}
			</div>
		</div>
	);
}

export function AnimationPlayer({ scene, manifest, storyboard, className }: AnimationPlayerProps) {
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
	const isHyperframes = manifestData?.renderer === "hyperframes";

	return (
		<div className={`animation-player bg-muted/20 rounded-lg overflow-hidden ${className ?? ""}`}>
			{/* Header */}
			<div className="flex items-center justify-between px-4 py-2 bg-muted/30 border-b border-border">
				<div className="flex items-center gap-2">
					<span className="text-sm font-medium">Animation</span>
					{manifestData && <span className="text-xs text-muted-foreground">({manifestData.topic})</span>}
					{isHyperframes && <span className="text-xs text-muted-foreground">Hyperframes</span>}
				</div>
				<div className="flex items-center gap-2">
					<button
						onClick={() => setShowSource(!showSource)}
						className="text-xs px-2 py-1 rounded bg-muted hover:bg-muted/80 transition-colors"
					>
						{showSource ? "Hide" : "Show"} Source
					</button>
				</div>
			</div>

			{/* Content */}
			<div className="p-4">
				{isHyperframes && scene ? (
					<iframe
						title={`${manifestData?.topic ?? "Keating"} Hyperframes composition`}
						srcDoc={scene}
						sandbox="allow-scripts"
						className="aspect-video w-full rounded-md border border-border bg-black"
					/>
				) : storyboardData?.scenes.length ? (
					<div className="space-y-3">
						<AnimatedStoryboardStage
							title={storyboardData.title}
							scenes={storyboardData.scenes}
							totalDuration={storyboardData.totalDuration}
						/>
						<details className="rounded-md border border-border bg-background/70 p-3">
							<summary className="cursor-pointer text-xs font-medium text-muted-foreground">
								Storyboard notes
							</summary>
							<SceneRenderer storyboard={storyboard ?? ""} />
						</details>
					</div>
				) : scene ? (
					<div className="space-y-3">
						<h3 className="font-medium">Scene Source</h3>
						<pre className="text-xs text-muted-foreground whitespace-pre-wrap bg-muted/30 p-3 rounded overflow-auto max-h-64">
							{scene}
						</pre>
					</div>
				) : (
					<div className="text-center text-muted-foreground py-8">No animation loaded</div>
				)}

				{showSource && storyboard && (
					<div className="mt-3 space-y-2">
						<div className="text-xs font-medium text-muted-foreground">
							Storyboard Source ({storyboardData?.scenes.length ?? 0} scenes)
						</div>
						<pre className="text-xs text-muted-foreground whitespace-pre-wrap bg-muted/30 p-3 rounded overflow-auto max-h-64">
							{storyboard}
						</pre>
					</div>
				)}

				{showSource && scene && (
					<div className="mt-3 space-y-2">
						<div className="text-xs font-medium text-muted-foreground">
							{isHyperframes ? "Hyperframes HTML" : "Scene Code"}
						</div>
						<pre className="text-xs text-muted-foreground whitespace-pre-wrap bg-muted/30 p-3 rounded overflow-auto max-h-64">
							{scene}
						</pre>
					</div>
				)}
				</div>

			{/* Manifest Info */}
			{manifestData && (
				<div className="px-4 py-2 bg-muted/30 border-t border-border text-xs text-muted-foreground">
					<span className="mr-4">Duration: {manifestData.duration ?? 0}s</span>
					<span>Scenes: {Array.isArray(manifestData.scenes) ? manifestData.scenes.length : 0}</span>
					{manifestData.renderer && <span className="ml-4">Renderer: {manifestData.renderer}</span>}
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
				className="text-xs text-primary hover:underline flex items-center gap-1"
			>
				Show Animation
			</button>
		);
	}

	return (
		<div className="my-4">
			{compact && (
				<button onClick={() => setExpanded(false)} className="text-xs text-muted-foreground hover:underline mb-2">
					Collapse
				</button>
			)}
			<AnimationPlayer storyboard={storyboard} scene={scene} manifest={manifest} />
		</div>
	);
}

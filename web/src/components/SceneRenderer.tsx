import { useMemo, useState } from "react";
import { ChevronRight, ChevronLeft, Clock, Eye, Volume2, AlertTriangle, Lightbulb, BookOpen, ArrowRight } from "lucide-react";

interface Scene {
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
	if (range) {
		return Math.max(0, Number(range[2]) - Number(range[1]));
	}
	const value = Number(cleaned);
	return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function parseStoryboard(markdown: string): { title: string; scenes: Scene[]; totalDuration: number } {
	const lines = markdown.split("\n");
	const scenes: Scene[] = [];
	let title = "";
	let current: Partial<Scene> = {};

	for (const line of lines) {
		const titleMatch = line.match(/^# Animation Storyboard: (.+)$/);
		if (titleMatch) {
			title = titleMatch[1];
			continue;
		}

		const sceneMatch = line.match(/^## Scene (\d+): (.+) \((.+)\)$/);
		if (sceneMatch) {
			if (current.title) {
				scenes.push(current as Scene);
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

	if (current.title) scenes.push(current as Scene);

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
	scene: Scene;
	isActive: boolean;
	progress: number;
}) {
	return (
		<div
			className={`rounded-lg border-2 p-4 transition-all ${
				isActive
					? "border-primary bg-primary/5 shadow-sm"
					: "border-border bg-muted/20 opacity-90"
				}`}
		>
			<div className="flex items-center gap-3 mb-3">
				<div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
					<SceneIcon title={scene.title} />
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex items-center justify-between">
						<span className="text-sm font-semibold truncate">{scene.title}</span>
						<span className="flex items-center gap-1 text-xs text-muted-foreground font-terminal">
							<Clock size={12} />
							{scene.duration}
						</span>
					</div>
					{isActive && (
						<div className="mt-1 h-1 w-full rounded-full bg-muted overflow-hidden">
							<div
								className="h-full rounded-full bg-primary transition-all"
								style={{ width: `${progress}%` }}
							/>
						</div>
					)}
				</div>
			</div>

			{scene.visual && (
				<div className="rounded-md bg-muted/50 p-3 mb-2">
					<div className="flex items-start gap-2">
						<Eye size={14} className="shrink-0 mt-0.5 text-muted-foreground" />
						<p className="text-xs leading-5">{scene.visual}</p>
					</div>
				</div>
			)}

			<div className="flex flex-wrap gap-x-4 gap-y-1">
				{scene.audio && (
					<div className="flex items-center gap-1 text-xs text-muted-foreground">
						<Volume2 size={12} />
						<span className="truncate max-w-[240px]">{scene.audio}</span>
					</div>
				)}
				{scene.transition && (
					<div className="flex items-center gap-1 text-xs text-muted-foreground">
						<ArrowRight size={12} />
						<span>{scene.transition}</span>
					</div>
				)}
				{scene.highlight && (
					<div className="flex items-center gap-1 text-xs text-accent">
						<Lightbulb size={12} />
						<span className="truncate max-w-[200px]">{scene.highlight}</span>
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
		<div className="rounded-xl border-2 border-border bg-background p-4 sm:p-5 space-y-4 my-3 shadow-sm">
			<div className="flex items-center justify-between gap-2">
				<div>
					<h3 className="text-base font-bold">{title || "Animation Storyboard"}</h3>
					<p className="text-xs text-muted-foreground font-terminal">
						{scenes.length} SCENES // {totalDuration}s TOTAL
					</p>
				</div>
				<div className="flex items-center gap-1">
					<button
						onClick={() => setActiveIdx((i) => Math.max(0, i - 1))}
						disabled={activeIdx === 0}
						className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent disabled:opacity-30 transition-colors"
					>
						<ChevronLeft size={16} />
					</button>
					<span className="text-xs font-terminal min-w-[3rem] text-center">
						{activeIdx + 1}/{scenes.length}
					</span>
					<button
						onClick={() => setActiveIdx((i) => Math.min(scenes.length - 1, i + 1))}
						disabled={activeIdx === scenes.length - 1}
						className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent disabled:opacity-30 transition-colors"
					>
						<ChevronRight size={16} />
					</button>
				</div>
			</div>

			<SceneCard scene={active} isActive={true} progress={60} />

			<div className="space-y-2">
				{scenes.map((s, i) => (
					<button
						key={s.number}
						onClick={() => setActiveIdx(i)}
						className={`w-full flex items-center gap-3 rounded-md px-3 py-2 text-left transition-all ${
							i === activeIdx
								? "bg-primary/10 border border-primary/30"
								: "bg-muted/30 border border-transparent hover:bg-muted/50"
						}`}
					>
						<div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-[10px] font-bold">
							{s.number}
						</div>
						<span className="text-xs font-medium truncate flex-1">{s.title}</span>
						<span className="text-[10px] text-muted-foreground font-terminal">{s.duration}</span>
					</button>
				))}
			</div>
		</div>
	);
}

// Needed for useMemo import

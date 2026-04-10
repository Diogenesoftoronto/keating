import { useEffect, useRef, useState } from "react";

interface AnimationPlayerProps {
	scene?: string;
	manifest?: string;
	storyboard?: string;
	className?: string;
}

interface Manifest {
	topic: string;
	slug: string;
	scenes: string[];
	duration: number;
}

export function AnimationPlayer({ scene, manifest, storyboard, className }: AnimationPlayerProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [error, setError] = useState<string | null>(null);
	const [currentScene, setCurrentScene] = useState(0);
	const [isPlaying, setIsPlaying] = useState(false);
	const [showStoryboard, setShowStoryboard] = useState(true);

	// Parse manifest
	let manifestData: Manifest | null = null;
	if (manifest) {
		try {
			manifestData = JSON.parse(manifest);
		} catch {
			// Invalid JSON
		}
	}

	// Parse storyboard into scenes
	const storyboardScenes = storyboard
		? storyboard
				.split(/##\s+Scene/)
				.filter((s) => s.trim())
				.map((s) => {
					const lines = s.trim().split("\n");
					const titleLine = lines[0] || "";
					const titleMatch = titleLine.match(/\d+:\s*(.+?)\s*\(/);
					return {
						title: titleMatch?.[1] || "Scene",
						content: lines.slice(1).join("\n"),
					};
				})
		: [];

	useEffect(() => {
		// In a real implementation, this would load and run manim-web
		// For now, we just display the storyboard and scene code
	}, [scene, manifest]);

	return (
		<div className={`animation-player bg-muted/20 rounded-lg overflow-hidden ${className}`}>
			{/* Header */}
			<div className="flex items-center justify-between px-4 py-2 bg-muted/30 border-b border-border">
				<div className="flex items-center gap-2">
					<span className="text-sm font-medium">🎬 Animation</span>
					{manifestData && <span className="text-xs text-muted-foreground">({manifestData.topic})</span>}
				</div>
				<div className="flex items-center gap-2">
					<button
						onClick={() => setShowStoryboard(!showStoryboard)}
						className="text-xs px-2 py-1 rounded bg-muted hover:bg-muted/80 transition-colors"
					>
						{showStoryboard ? "Hide" : "Show"} Storyboard
					</button>
				</div>
			</div>

			{/* Content */}
			<div className="flex">
				{/* Storyboard Panel */}
				{showStoryboard && storyboard && (
					<div className="w-80 border-r border-border bg-muted/10 max-h-96 overflow-auto">
						<div className="p-2 text-xs font-medium text-muted-foreground border-b border-border sticky top-0 bg-muted/30">
							Storyboard ({storyboardScenes.length} scenes)
						</div>
						<div className="p-2 space-y-2">
							{storyboardScenes.map((s, i) => (
								<button
									key={i}
									onClick={() => setCurrentScene(i)}
									className={`w-full text-left p-2 rounded text-xs transition-colors ${
										currentScene === i
											? "bg-primary/20 text-foreground"
											: "hover:bg-muted/50"
									}`}
								>
									<div className="font-medium">{s.title}</div>
									<div className="text-muted-foreground line-clamp-2 mt-1">{s.content.slice(0, 50)}...</div>
								</button>
							))}
						</div>
					</div>
				)}

				{/* Preview Area */}
				<div className="flex-1 p-4">
					{storyboardScenes[currentScene] ? (
						<div className="space-y-3">
							<h3 className="font-medium">{storyboardScenes[currentScene].title}</h3>
							<pre className="text-xs text-muted-foreground whitespace-pre-wrap bg-muted/30 p-3 rounded overflow-auto max-h-64">
								{storyboardScenes[currentScene].content}
							</pre>
						</div>
					) : scene ? (
						<div className="space-y-3">
							<h3 className="font-medium">Scene Code</h3>
							<pre className="text-xs text-muted-foreground whitespace-pre-wrap bg-muted/30 p-3 rounded overflow-auto max-h-64">
								{scene}
							</pre>
						</div>
					) : (
						<div className="text-center text-muted-foreground py-8">No animation loaded</div>
					)}
				</div>
			</div>

			{/* Manifest Info */}
			{manifestData && (
				<div className="px-4 py-2 bg-muted/30 border-t border-border text-xs text-muted-foreground">
					<span className="mr-4">Duration: {manifestData.duration}s</span>
					<span>Scenes: {manifestData.scenes.length}</span>
				</div>
			)}

			{error && (
				<div className="px-4 py-2 bg-red-500/20 text-red-400 text-xs border-t border-red-500/30">
					{error}
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
				🎬 Show Animation
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

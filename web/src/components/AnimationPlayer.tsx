import { useState } from "react";
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
	scenes: string[];
	duration: number;
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

	return (
		<div className={`animation-player bg-muted/20 rounded-lg overflow-hidden ${className ?? ""}`}>
			{/* Header */}
			<div className="flex items-center justify-between px-4 py-2 bg-muted/30 border-b border-border">
				<div className="flex items-center gap-2">
					<span className="text-sm font-medium">🎬 Animation</span>
					{manifestData && <span className="text-xs text-muted-foreground">({manifestData.topic})</span>}
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
				{storyboardData?.scenes.length ? (
					<SceneRenderer storyboard={storyboard ?? ""} />
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
						<div className="text-xs font-medium text-muted-foreground">Scene Code</div>
						<pre className="text-xs text-muted-foreground whitespace-pre-wrap bg-muted/30 p-3 rounded overflow-auto max-h-64">
							{scene}
						</pre>
					</div>
				)}
				</div>

			{/* Manifest Info */}
			{manifestData && (
				<div className="px-4 py-2 bg-muted/30 border-t border-border text-xs text-muted-foreground">
					<span className="mr-4">Duration: {manifestData.duration}s</span>
					<span>Scenes: {manifestData.scenes.length}</span>
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

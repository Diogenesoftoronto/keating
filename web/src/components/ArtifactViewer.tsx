import { useState, useEffect } from "react";
import { MermaidRenderer } from "./MermaidRenderer";
import { AnimationPlayer } from "./AnimationPlayer";
import { KeatingStorage, type LessonPlan, type LessonMap, type Animation, type BenchmarkResult, type EvolutionResult } from "../keating/storage";

interface ArtifactViewerProps {
	storage: KeatingStorage;
	artifactId?: string;
	onClose?: () => void;
}

type ArtifactType = "plan" | "map" | "animation" | "benchmark" | "evolution" | "verification";

interface Artifact {
	id: string;
	type: ArtifactType;
	label: string;
	createdAt: number;
	data: unknown;
}

export function ArtifactViewer({ storage, artifactId, onClose }: ArtifactViewerProps) {
	const [artifacts, setArtifacts] = useState<Artifact[]>([]);
	const [selected, setSelected] = useState<Artifact | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		async function loadArtifacts() {
			setLoading(true);
			try {
				const [plans, maps, animations, benchmarks, evolutions, verifications] = await Promise.all([
					storage.getLessonPlans(),
					storage.getLessonMaps(),
					storage.getAnimations(),
					storage.getBenchmarks(),
					storage.getEvolutions(),
					storage.getVerifications(),
				]);

				const all: Artifact[] = [
					...plans.map((p) => ({ id: p.id, type: "plan" as const, label: `Plan: ${p.topic}`, createdAt: p.createdAt, data: p })),
					...maps.map((m) => ({ id: m.id, type: "map" as const, label: `Map: ${m.topic}`, createdAt: m.createdAt, data: m })),
					...animations.map((a) => ({ id: a.id, type: "animation" as const, label: `Animation: ${a.topic}`, createdAt: a.createdAt, data: a })),
					...benchmarks.map((b) => ({ id: b.id, type: "benchmark" as const, label: `Benchmark: ${b.topic || "general"}`, createdAt: b.createdAt, data: b })),
					...evolutions.map((e) => ({ id: e.id, type: "evolution" as const, label: `Evolution: ${e.topic || "general"}`, createdAt: e.createdAt, data: e })),
					...verifications.map((v) => ({ id: v.id, type: "verification" as const, label: `Verification: ${v.topic}`, createdAt: v.createdAt, data: v })),
				];

				all.sort((a, b) => b.createdAt - a.createdAt);
				setArtifacts(all);

				// If artifactId provided, select it
				if (artifactId) {
					const found = all.find((a) => a.id === artifactId);
					if (found) setSelected(found);
				}
			} catch (err) {
				console.error("Failed to load artifacts:", err);
			}
			setLoading(false);
		}

		loadArtifacts();
	}, [storage, artifactId]);

	if (loading) {
		return (
			<div className="p-8 text-center text-muted-foreground">
				<div className="animate-pulse">Loading artifacts...</div>
			</div>
		);
	}

	if (selected) {
		return (
			<div className="artifact-detail">
				{/* Header */}
				<div className="flex items-center justify-between mb-4 pb-2 border-b border-border">
					<div>
						<button onClick={() => setSelected(null)} className="text-sm text-muted-foreground hover:underline">
							← Back to list
						</button>
						<h2 className="text-lg font-semibold mt-1">{selected.label}</h2>
						<p className="text-xs text-muted-foreground">
							{new Date(selected.createdAt).toLocaleString()}
						</p>
					</div>
					{onClose && (
						<button onClick={onClose} className="text-sm text-muted-foreground hover:underline">
							Close
						</button>
					)}
				</div>

				{/* Content */}
				<div className="artifact-content">
					{selected.type === "plan" && <PlanViewer plan={selected.data as LessonPlan} />}
					{selected.type === "map" && <MapView map={selected.data as LessonMap} />}
					{selected.type === "animation" && <AnimationViewer animation={selected.data as Animation} />}
					{selected.type === "benchmark" && <BenchmarkViewer benchmark={selected.data as BenchmarkResult} />}
					{selected.type === "evolution" && <EvolutionViewer evolution={selected.data as EvolutionResult} />}
					{selected.type === "verification" && <VerificationViewer data={selected.data} />}
				</div>
			</div>
		);
	}

	return (
		<div className="artifact-list">
			<div className="flex items-center justify-between mb-4 pb-2 border-b border-border">
				<h2 className="text-lg font-semibold">📚 Keating Artifacts</h2>
				{onClose && (
					<button onClick={onClose} className="text-sm text-muted-foreground hover:underline">
						Close
					</button>
				)}
			</div>

			{artifacts.length === 0 ? (
				<p className="text-muted-foreground text-sm">No artifacts yet. Use /plan, /map, /animate, /bench, or /evolve to create some.</p>
			) : (
				<div className="space-y-2">
					{artifacts.map((artifact) => (
						<button
							key={artifact.id}
							onClick={() => setSelected(artifact)}
							className="w-full text-left p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
						>
							<div className="flex items-center justify-between">
								<span className="font-medium">{artifact.label}</span>
								<span className="text-xs text-muted-foreground">
									{new Date(artifact.createdAt).toLocaleDateString()}
								</span>
							</div>
							<div className="text-xs text-muted-foreground mt-1">
								{artifact.type}
							</div>
						</button>
					))}
				</div>
			)}
		</div>
	);
}

// Individual viewers
function PlanViewer({ plan }: { plan: LessonPlan }) {
	return (
		<div className="prose prose-sm dark:prose-invert max-w-none">
			<pre className="whitespace-pre-wrap bg-muted/30 p-4 rounded-lg overflow-auto text-xs">
				{plan.content}
			</pre>
		</div>
	);
}

function MapView({ map }: { map: LessonMap }) {
	return (
		<div>
			<MermaidRenderer content={map.mmdContent} className="bg-background" />
			{map.svgContent && (
				<details className="mt-4">
					<summary className="text-sm text-muted-foreground cursor-pointer">View SVG</summary>
					<div dangerouslySetInnerHTML={{ __html: map.svgContent }} className="mt-2" />
				</details>
			)}
		</div>
	);
}

function AnimationViewer({ animation }: { animation: Animation }) {
	return (
		<AnimationPlayer
			storyboard={animation.storyboard}
			scene={animation.scene}
			manifest={animation.manifest}
		/>
	);
}

function BenchmarkViewer({ benchmark }: { benchmark: BenchmarkResult }) {
	return (
		<div className="space-y-4">
			<div className="flex items-center gap-4">
				<div className="text-3xl font-bold text-primary">{benchmark.score.toFixed(1)}</div>
				<div className="text-sm text-muted-foreground">/ 100</div>
			</div>
			<pre className="whitespace-pre-wrap bg-muted/30 p-4 rounded-lg overflow-auto text-xs">
				{benchmark.report}
			</pre>
			{benchmark.trace && (
				<details>
					<summary className="text-sm text-muted-foreground cursor-pointer">View Trace</summary>
					<pre className="mt-2 whitespace-pre-wrap bg-muted/20 p-3 rounded text-xs overflow-auto max-h-96">
						{benchmark.trace}
					</pre>
				</details>
			)}
		</div>
	);
}

function EvolutionViewer({ evolution }: { evolution: EvolutionResult }) {
	return (
		<div className="space-y-4">
			<div className="flex items-center gap-4">
				<div className="text-3xl font-bold text-primary">{evolution.bestScore.toFixed(1)}</div>
				<div className="text-sm text-muted-foreground">/ 100 best score</div>
			</div>
			<pre className="whitespace-pre-wrap bg-muted/30 p-4 rounded-lg overflow-auto text-xs">
				{evolution.report}
			</pre>
			{evolution.trace && (
				<details>
					<summary className="text-sm text-muted-foreground cursor-pointer">View Trace</summary>
					<pre className="mt-2 whitespace-pre-wrap bg-muted/20 p-3 rounded text-xs overflow-auto max-h-96">
						{evolution.trace}
					</pre>
				</details>
			)}
		</div>
	);
}

function VerificationViewer({ data }: { data: unknown }) {
	const verification = data as { topic: string; checklist: string };
	return (
		<pre className="whitespace-pre-wrap bg-muted/30 p-4 rounded-lg overflow-auto text-xs">
			{verification.checklist}
		</pre>
	);
}

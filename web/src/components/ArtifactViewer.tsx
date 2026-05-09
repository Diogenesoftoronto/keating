import { useState, useEffect, useMemo } from "react";
import { MermaidRenderer } from "./MermaidRenderer";
import { AnimationPlayer } from "./AnimationPlayer";
import { KeatingStorage, type LessonPlan, type LessonMap, type Animation, type BenchmarkResult, type EvolutionResult, type Verification, type PromptEvolutionResult, type ImprovementAttemptRecord } from "../keating/storage";

interface ArtifactViewerProps {
	storage: KeatingStorage;
	artifactId?: string;
	onClose?: () => void;
}

type ArtifactType = "plan" | "map" | "animation" | "benchmark" | "evolution" | "verification" | "prompt-evolution" | "improvement";

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
	const [query, setQuery] = useState("");

	const filteredArtifacts = useMemo(() => {
		const normalizedQuery = query.trim().toLowerCase();
		if (!normalizedQuery) return artifacts;
		return artifacts.filter((artifact) => {
			const text = [
				artifact.label,
				artifact.type,
				new Date(artifact.createdAt).toLocaleString(),
				JSON.stringify(artifact.data),
			].join(" ").toLowerCase();
			return text.includes(normalizedQuery);
		});
	}, [artifacts, query]);

	useEffect(() => {
		async function loadArtifacts() {
			setLoading(true);
			try {
				const [plans, maps, animations, benchmarks, evolutions, verifications, promptEvolutions, improvements] = await Promise.all([
					storage.getLessonPlans(),
					storage.getLessonMaps(),
					storage.getAnimations(),
					storage.getBenchmarks(),
					storage.getEvolutions(),
					storage.getVerifications(),
					storage.getPromptEvolutions(),
					storage.getImprovementAttempts(),
				]);

				const all: Artifact[] = [
					...plans.map((p) => ({ id: p.id, type: "plan" as const, label: `Plan: ${p.topic}`, createdAt: p.createdAt, data: p })),
					...maps.map((m) => ({ id: m.id, type: "map" as const, label: `Map: ${m.topic}`, createdAt: m.createdAt, data: m })),
					...animations.map((a) => ({ id: a.id, type: "animation" as const, label: `Animation: ${a.topic}`, createdAt: a.createdAt, data: a })),
					...benchmarks.map((b) => ({ id: b.id, type: "benchmark" as const, label: `Benchmark: ${b.topic || "general"}`, createdAt: b.createdAt, data: b })),
					...evolutions.map((e) => ({ id: e.id, type: "evolution" as const, label: `Evolution: ${e.topic || "general"}`, createdAt: e.createdAt, data: e })),
					...verifications.map((v) => ({ id: v.id, type: "verification" as const, label: `Verification: ${v.topic}`, createdAt: v.createdAt, data: v })),
					...promptEvolutions.map((p) => ({ id: p.id, type: "prompt-evolution" as const, label: `Prompt Evo: ${p.promptName}`, createdAt: p.createdAt, data: p })),
					...improvements.map((i) => ({ id: i.id, type: "improvement" as const, label: `Improve: ${i.proposalId}`, createdAt: i.createdAt, data: i })),
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
					{selected.type === "prompt-evolution" && <PromptEvolutionViewer promptEvolution={selected.data as PromptEvolutionResult} />}
					{selected.type === "improvement" && <ImprovementViewer improvement={selected.data as ImprovementAttemptRecord} />}
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
				<div className="space-y-3">
					<input
						className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
						value={query}
						placeholder="Search artifacts"
						onChange={(event) => setQuery(event.target.value)}
					/>
					{filteredArtifacts.length === 0 ? (
						<p className="py-8 text-center text-sm text-muted-foreground">No artifacts match your search</p>
					) : (
						<div className="space-y-2">
							{filteredArtifacts.map((artifact) => (
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
			)}
		</div>
	);
}

// Individual viewers
const mermaidFencePattern = /```mermaid[^\n]*\n([\s\S]*?)```/gi;

function splitMermaidBlocks(content: string) {
	const parts: Array<{ type: "markdown" | "mermaid"; content: string }> = [];
	let lastIndex = 0;

	for (const match of content.matchAll(mermaidFencePattern)) {
		const index = match.index ?? 0;
		const markdown = content.slice(lastIndex, index);
		if (markdown.trim()) parts.push({ type: "markdown", content: markdown });
		parts.push({ type: "mermaid", content: match[1].trim() });
		lastIndex = index + match[0].length;
	}

	const trailingMarkdown = content.slice(lastIndex);
	if (trailingMarkdown.trim()) parts.push({ type: "markdown", content: trailingMarkdown });

	return parts;
}

function ArtifactMarkdownViewer({ content }: { content: string }) {
	const parts = splitMermaidBlocks(content);

	if (parts.length === 0) {
		return (
			<div className="prose prose-sm dark:prose-invert max-w-none">
				<markdown-block content={content}></markdown-block>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{parts.map((part, index) => {
				if (part.type === "mermaid") {
					return (
						<div key={index} className="overflow-auto rounded-lg border border-border bg-background p-4">
							<MermaidRenderer content={part.content} />
						</div>
					);
				}

				return (
					<div key={index} className="prose prose-sm dark:prose-invert max-w-none">
						<markdown-block content={part.content}></markdown-block>
					</div>
				);
			})}
		</div>
	);
}

function PlanViewer({ plan }: { plan: LessonPlan }) {
	return (
		<ArtifactMarkdownViewer content={plan.content} />
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
			<ArtifactMarkdownViewer content={benchmark.report} />
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
			<ArtifactMarkdownViewer content={evolution.report} />
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

function PromptEvolutionViewer({ promptEvolution }: { promptEvolution: PromptEvolutionResult }) {
	return (
		<div className="space-y-4">
			<div className="flex items-center gap-4">
				<div className="text-3xl font-bold text-primary">{promptEvolution.bestScore.toFixed(1)}</div>
				<div className="text-sm text-muted-foreground">best prompt score</div>
			</div>
			<ArtifactMarkdownViewer content={promptEvolution.report} />
			<details>
				<summary className="text-sm text-muted-foreground cursor-pointer">View Prompt</summary>
				<pre className="mt-2 whitespace-pre-wrap bg-muted/20 p-3 rounded text-xs overflow-auto max-h-96">
					{promptEvolution.bestPrompt}
				</pre>
			</details>
		</div>
	);
}

function ImprovementViewer({ improvement }: { improvement: ImprovementAttemptRecord }) {
	const content = `# Improvement Attempt

- Proposal: ${improvement.proposalId}
- Baseline: ${improvement.baselineScore.toFixed(2)}
- After: ${improvement.afterScore === null ? "not measured" : improvement.afterScore.toFixed(2)}
- Delta: ${improvement.scoreDelta === null ? "not measured" : improvement.scoreDelta.toFixed(2)}
- Status: ${improvement.accepted ? "accepted" : "rejected"}
- Targets: ${improvement.targets}

## Hypothesis
${improvement.hypothesis}`;

	return <ArtifactMarkdownViewer content={content} />;
}

function VerificationViewer({ data }: { data: unknown }) {
	const verification = data as Verification;
	return <ArtifactMarkdownViewer content={verification.checklist} />;
}

import { useState, useEffect, useMemo } from "react";
import {
	BookOpen,
	ChevronRight,
	Eye,
	EyeOff,
	GitBranch,
	Map as MapIcon,
	MessageSquare,
	PanelRightClose,
	Play,
	Search,
	Settings2,
	Sparkles,
	Wrench,
} from "lucide-react";
import { MermaidRenderer } from "./MermaidRenderer";
import { AnimationPlayer } from "./AnimationPlayer";
import { MarkdownBlock } from "./MarkdownBlock";
import { KeatingStorage, type LessonPlan, type LessonMap, type Animation, type BenchmarkResult, type EvolutionResult, type Verification, type PromptEvolutionResult, type ImprovementAttemptRecord } from "../keating/storage";
import { sessions, getInitPromise } from "../hooks/keating-storage";
import type { SessionMetadata } from "../types/session";

interface ArtifactViewerProps {
	storage: KeatingStorage;
	artifactId?: string;
	onClose?: () => void;
}

type ArtifactType = "plan" | "map" | "animation" | "benchmark" | "evolution" | "verification" | "prompt-evolution" | "improvement";

type ArtifactAudience = "user" | "agent";

// ── Audience classification ──────────────────────────────────────────
// User-facing: teaching materials the learner directly benefits from
// Agent-facing: internal optimization/self-improvement artifacts

const AUDIENCE_MAP: Record<ArtifactType, ArtifactAudience> = {
	plan: "user",
	map: "user",
	animation: "user",
	verification: "user",
	benchmark: "agent",
	evolution: "agent",
	"prompt-evolution": "agent",
	improvement: "agent",
};

const TYPE_META: Record<ArtifactType, { label: string; icon: React.ReactNode }> = {
	plan: { label: "Lesson Plan", icon: <BookOpen size={14} /> },
	map: { label: "Concept Map", icon: <MapIcon size={14} /> },
	animation: { label: "Animation", icon: <Play size={14} /> },
	verification: { label: "Verification", icon: <ChevronRight size={14} /> },
	benchmark: { label: "Benchmark", icon: <Sparkles size={14} /> },
	evolution: { label: "Evolution", icon: <Settings2 size={14} /> },
	"prompt-evolution": { label: "Prompt Evo", icon: <Sparkles size={14} /> },
	improvement: { label: "Improvement", icon: <Wrench size={14} /> },
};

interface Artifact {
	id: string;
	type: ArtifactType;
	label: string;
	createdAt: number;
	sessionId?: string;
	data: unknown;
}

const SHOW_AGENT_KEY = "keating:artifact-show-agent";

function readShowAgent(): boolean {
	if (typeof localStorage === "undefined") return false;
	try {
		return localStorage.getItem(SHOW_AGENT_KEY) === "1";
	} catch {
		return false;
	}
}

function writeShowAgent(value: boolean): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(SHOW_AGENT_KEY, value ? "1" : "0");
	} catch {
		// ignore
	}
}

function formatArtifactDate(ts: number): string {
	const d = new Date(ts);
	const now = new Date();
	const diffMs = now.getTime() - d.getTime();
	const diffMins = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMs / 3600000);
	const diffDays = Math.floor(diffMs / 86400000);

	if (diffMins < 1) return "Just now";
	if (diffMins < 60) return `${diffMins}m ago`;
	if (diffHours < 24) return `${diffHours}h ago`;
	if (diffDays === 1) return "Yesterday";
	if (diffDays < 7) return `${diffDays}d ago`;
	return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function artifactPreviewText(artifact: Artifact): string {
	const data = artifact.data as Record<string, unknown>;
	switch (artifact.type) {
		case "plan":
			return `Phases: ${(data?.metadata as { phaseCount?: number })?.phaseCount ?? "—"} | Domain: ${(data?.metadata as { domain?: string })?.domain ?? "—"}`;
		case "map":
			return data?.mmdContent ? `${String(data.mmdContent).split("\n").length} nodes` : "Concept map";
		case "animation":
			return "Storyboard + scene";
		case "benchmark":
			return `Score: ${(data as unknown as BenchmarkResult).score.toFixed(1)}/100`;
		case "evolution":
			return `Best: ${(data as unknown as EvolutionResult).bestScore.toFixed(1)}/100`;
		case "verification":
			return data?.checklist ? `${String(data.checklist).split("\n").filter((l) => l.startsWith("- [")).length} checks` : "Checklist";
		case "prompt-evolution":
			return `Best score: ${(data as unknown as PromptEvolutionResult).bestScore.toFixed(1)}`;
		case "improvement":
			return (data as unknown as ImprovementAttemptRecord).accepted ? "Accepted" : "Rejected";
		default:
			return "";
	}
}

export function ArtifactViewer({ storage, artifactId, onClose }: ArtifactViewerProps) {
	const [artifacts, setArtifacts] = useState<Artifact[]>([]);
	const [selected, setSelected] = useState<Artifact | null>(null);
	const [loading, setLoading] = useState(true);
	const [query, setQuery] = useState("");
	const [showAgentArtifacts, setShowAgentArtifacts] = useState(() => readShowAgent());
	const [sessionMap, setSessionMap] = useState<Map<string, SessionMetadata>>(new Map());

	// Load artifacts
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
					...plans.map((p) => ({ id: p.id, type: "plan" as const, label: p.topic, createdAt: p.createdAt, sessionId: p.sessionId, data: p })),
					...maps.map((m) => ({ id: m.id, type: "map" as const, label: m.topic, createdAt: m.createdAt, sessionId: m.sessionId, data: m })),
					...animations.map((a) => ({ id: a.id, type: "animation" as const, label: a.topic, createdAt: a.createdAt, sessionId: a.sessionId, data: a })),
					...benchmarks.map((b) => ({ id: b.id, type: "benchmark" as const, label: b.topic || "general", createdAt: b.createdAt, sessionId: b.sessionId, data: b })),
					...evolutions.map((e) => ({ id: e.id, type: "evolution" as const, label: e.topic || "general", createdAt: e.createdAt, sessionId: e.sessionId, data: e })),
					...verifications.map((v) => ({ id: v.id, type: "verification" as const, label: v.topic, createdAt: v.createdAt, sessionId: v.sessionId, data: v })),
					...promptEvolutions.map((p) => ({ id: p.id, type: "prompt-evolution" as const, label: p.promptName, createdAt: p.createdAt, sessionId: p.sessionId, data: p })),
					...improvements.map((i) => ({ id: i.id, type: "improvement" as const, label: i.proposalId, createdAt: i.createdAt, sessionId: i.sessionId, data: i })),
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

	// Load session metadata for grouping
	useEffect(() => {
		async function loadSessions() {
			try {
				await getInitPromise();
				const meta = await sessions.getAllMetadata();
				const map = new Map(meta.map((m) => [m.id, m]));
				setSessionMap(map);
			} catch {
				// sessions store may not be available in all contexts
			}
		}
		loadSessions();
	}, []);

	const filteredArtifacts = useMemo(() => {
		const normalizedQuery = query.trim().toLowerCase();
		let result = artifacts;
		if (!showAgentArtifacts) {
			result = result.filter((a) => AUDIENCE_MAP[a.type] === "user");
		}
		if (normalizedQuery) {
			result = result.filter((a) => {
				const text = [a.label, a.type, new Date(a.createdAt).toLocaleString(), JSON.stringify(a.data)].join(" ").toLowerCase();
				return text.includes(normalizedQuery);
			});
		}
		return result;
	}, [artifacts, query, showAgentArtifacts]);

	const agentArtifactCount = useMemo(
		() => artifacts.filter((a) => AUDIENCE_MAP[a.type] === "agent").length,
		[artifacts],
	);

	// Group by sessionId (or "__other__" for unassociated)
	const groupedBySession = useMemo(() => {
		const groups = new Map<string, Artifact[]>();
		for (const artifact of filteredArtifacts) {
			const key = artifact.sessionId ?? "__other__";
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key)!.push(artifact);
		}
		return groups;
	}, [filteredArtifacts]);

	// Sort groups: newest session first, then "__other__" at bottom
	const sortedGroupKeys = useMemo(() => {
		const keys = Array.from(groupedBySession.keys());
		keys.sort((a, b) => {
			if (a === "__other__") return 1;
			if (b === "__other__") return -1;
			// Sort by most recent artifact in each group
			const groupA = groupedBySession.get(a)!;
			const groupB = groupedBySession.get(b)!;
			return groupB[0].createdAt - groupA[0].createdAt;
		});
		return keys;
	}, [groupedBySession]);

	const toggleShowAgent = () => {
		const next = !showAgentArtifacts;
		setShowAgentArtifacts(next);
		writeShowAgent(next);
	};

	if (loading) {
		return (
			<div className="p-8 text-center text-muted-foreground">
				<div className="animate-pulse">Loading artifacts...</div>
			</div>
		);
	}

	if (selected) {
		return (
			<div className="artifact-detail text-foreground">
				<div className="mb-4 pb-2 border-b border-border">
					<button onClick={() => setSelected(null)} className="text-sm text-muted-foreground hover:underline">
						← Back to list
					</button>
					<h2 className="text-lg font-semibold mt-1 text-foreground truncate">{selected.label}</h2>
					<div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
						<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted">
							{TYPE_META[selected.type].icon}
							{TYPE_META[selected.type].label}
						</span>
						<span>{new Date(selected.createdAt).toLocaleString()}</span>
						{AUDIENCE_MAP[selected.type] === "agent" && (
							<span className="text-[10px] uppercase tracking-wider text-amber-500">Agent</span>
						)}
					</div>
				</div>
				<div className="artifact-content text-foreground">
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
		<div className="artifact-list text-foreground">
			{artifacts.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					No artifacts yet. Use /plan, /map, /animate, /bench, or /evolve to create some.
				</p>
			) : (
				<div className="space-y-4">
					{/* Search + Toggle */}
					<div className="flex items-center gap-2">
						<label className="flex min-h-9 flex-1 items-center gap-2 rounded-md border border-border bg-background px-3 text-xs">
							<Search size={14} className="shrink-0 text-muted-foreground" />
							<input
								className="min-w-0 flex-1 bg-transparent py-2 outline-none placeholder:text-muted-foreground"
								value={query}
								placeholder="Search artifacts"
								onChange={(event) => setQuery(event.target.value)}
							/>
						</label>
						{onClose && (
							<button
								type="button"
								className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
								aria-label="Close artifact panel"
								title="Close panel"
								onClick={onClose}
							>
								<PanelRightClose size={16} />
							</button>
						)}
						{agentArtifactCount > 0 && (
							<button
								type="button"
								onClick={toggleShowAgent}
								title={showAgentArtifacts ? "Hide agent artifacts" : "Show agent artifacts"}
								className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
									showAgentArtifacts
										? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
										: "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
								}`}
							>
								{showAgentArtifacts ? <Eye size={13} /> : <EyeOff size={13} />}
								{showAgentArtifacts ? `Hide ${agentArtifactCount} agent` : `Show ${agentArtifactCount} agent`}
							</button>
						)}
					</div>

					{filteredArtifacts.length === 0 ? (
						<div className="py-8 text-center text-sm text-muted-foreground">
							{artifacts.length > 0 ? "No artifacts match your search" : "No artifacts yet"}
						</div>
					) : (
						<div className="space-y-6">
							{sortedGroupKeys.map((groupKey) => {
								const groupArtifacts = groupedBySession.get(groupKey)!;
								const isOther = groupKey === "__other__";
								const sessionMeta = !isOther ? sessionMap.get(groupKey) : undefined;

								return (
									<section key={groupKey}>
										{/* Session header */}
										<div className="mb-2 flex items-center gap-2 min-w-0">
											{isOther ? (
												<>
													<span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
														Other artifacts
													</span>
													<span className="text-[10px] text-muted-foreground">
														(no session)
													</span>
												</>
											) : sessionMeta ? (
												<>
													<MessageSquare size={12} className="shrink-0 text-muted-foreground" />
													<span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground truncate min-w-0">
														{sessionMeta.title}
													</span>
													<span className="text-[10px] text-muted-foreground shrink-0">
														{formatArtifactDate(new Date(sessionMeta.lastModified ?? sessionMeta.createdAt).getTime())} · {sessionMeta.messageCount} messages
													</span>
													{sessionMeta.parentSessionId && (
														<GitBranch size={10} className="shrink-0 text-primary" />
													)}
												</>
											) : (
												<span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
													Unknown session
												</span>
											)}
											<span className="ml-auto text-[10px] text-muted-foreground shrink-0">
												{groupArtifacts.length} artifact{groupArtifacts.length === 1 ? "" : "s"}
											</span>
										</div>

										{/* Artifact list */}
										<div className="space-y-1.5">
											{groupArtifacts.map((artifact) => {
												const meta = TYPE_META[artifact.type];
												const isAgent = AUDIENCE_MAP[artifact.type] === "agent";
												return (
													<button
														key={artifact.id}
														onClick={() => setSelected(artifact)}
														className={`group w-full text-left rounded-lg border p-2.5 transition-colors ${
															isAgent
																? "border-border/50 bg-muted/20 hover:bg-muted/40"
																: "border-border bg-muted/30 hover:bg-muted/50"
														}`}
													>
														<div className="flex items-start gap-2.5">
															<span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-background border border-border text-muted-foreground">
																{meta.icon}
															</span>
															<div className="min-w-0 flex-1">
																<div className="flex items-center gap-2">
																	<span className="text-sm font-medium truncate text-foreground">
																		{artifact.label}
																	</span>
																	{isAgent && (
																		<span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
																		Agent
																	</span>
																	)}
																</div>
												<div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground min-w-0">
														<span className="shrink-0">{meta.label}</span>
														<span className="shrink-0">·</span>
														<span className="shrink-0">{formatArtifactDate(artifact.createdAt)}</span>
														<span className="shrink-0">·</span>
														<span className="truncate">{artifactPreviewText(artifact)}</span>
													</div>
															</div>
														</div>
													</button>
												);
											})}
										</div>
									</section>
								);
							})}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

// ── Sub-viewers (unchanged from before) ───────────────────────────────────

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
				<MarkdownBlock content={content} />
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
						<MarkdownBlock content={part.content} />
					</div>
				);
			})}
		</div>
	);
}

// A lesson plan is its own artifact. Quizzes are created separately by the
// agent — after the learner has actually gone through the lesson — and render
// as standalone interactive cards in chat, so there is no quiz tab here.
function PlanViewer({ plan }: { plan: LessonPlan }) {
	return (
		<div className="space-y-4">
			<div className="rounded-lg border border-border bg-muted/20 p-3">
				<p className="text-sm font-medium text-foreground">Lesson artifact</p>
				<p className="text-xs text-muted-foreground">
					Work through the lesson below. When you're ready, ask for a quiz and the tutor will craft one from what you covered.
				</p>
			</div>
			<ArtifactMarkdownViewer content={plan.content} />
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
		<AnimationPlayer storyboard={animation.storyboard} scene={animation.scene} manifest={animation.manifest} />
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
					<pre className="mt-2 whitespace-pre-wrap bg-muted/20 p-3 rounded text-xs overflow-auto max-h-96">{benchmark.trace}</pre>
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
					<pre className="mt-2 whitespace-pre-wrap bg-muted/20 p-3 rounded text-xs overflow-auto max-h-96">{evolution.trace}</pre>
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
				<pre className="mt-2 whitespace-pre-wrap bg-muted/20 p-3 rounded text-xs overflow-auto max-h-96">{promptEvolution.bestPrompt}</pre>
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

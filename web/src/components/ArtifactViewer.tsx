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
	RotateCcw,
	Search,
	Settings2,
	Sparkles,
	Wrench,
} from "lucide-react";
import { MermaidRenderer } from "./MermaidRenderer";
import { AnimationPlayer } from "./AnimationPlayer";
import { MarkdownBlock } from "./MarkdownBlock";
import { QuizRenderer, type QuizResult } from "./QuizRenderer";
import { KeatingStorage, type LessonPlan, type LessonMap, type Animation, type BenchmarkResult, type EvolutionResult, type Verification, type PromptEvolutionResult, type ImprovementAttemptRecord } from "../keating/storage";
import { sessions, getInitPromise } from "../hooks/keating-storage";
import type { SessionMetadata } from "../types/session";
import type { Quiz, QuizQuestion } from "../keating/core";

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
										<div className="mb-2 flex items-center gap-2">
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
													<span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground truncate">
														{sessionMeta.title}
													</span>
													<span className="text-[10px] text-muted-foreground">
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
											<span className="ml-auto text-[10px] text-muted-foreground">
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
																<div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
																	<span>{meta.label}</span>
																	<span>·</span>
																	<span>{formatArtifactDate(artifact.createdAt)}</span>
																	<span>·</span>
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

interface PlanQuizSection {
	index: number;
	title: string;
	purpose: string;
	bullets: string[];
}

type PlanViewerMode = "lesson" | "quiz";

function stripMarkdown(text: string): string {
	return text
		.replace(/^\s*[-*]\s+/, "")
		.replace(/\*\*/g, "")
		.replace(/`/g, "")
		.trim();
}

function localSlug(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 80) || "lesson-plan";
}

function shuffleWithSeed<T>(items: T[], seed: number): T[] {
	const copy = [...items];
	let state = Math.max(1, seed | 0);
	for (let i = copy.length - 1; i > 0; i--) {
		state = (state * 1103515245 + 12345) & 0x7fffffff;
		const j = state % (i + 1);
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
}

function optionSet(correct: string, distractors: string[], seed: number, fallbackLabel = "None of the above"): string[] {
	const seen = new Set<string>();
	const options = [correct, ...distractors, fallbackLabel]
		.map(stripMarkdown)
		.filter((item) => {
			if (item.length < 3 || seen.has(item.toLowerCase())) return false;
			seen.add(item.toLowerCase());
			return true;
		})
		.slice(0, 4);
	while (options.length < 4) {
		options.push(`Related but not the best answer ${options.length}`);
	}
	return shuffleWithSeed(options, seed);
}

function extractPlanSummary(content: string): string {
	const summary = content.match(/^- Summary:\s*(.+)$/im)?.[1]?.trim();
	if (summary) return stripMarkdown(summary);
	const firstParagraph = content
		.split(/\n{2,}/)
		.map((part) => stripMarkdown(part))
		.find((part) => part && !part.startsWith("#") && !part.startsWith("- Domain:"));
	return firstParagraph ?? "the central idea of this lesson";
}

function extractPlanSections(content: string): PlanQuizSection[] {
	const sections: PlanQuizSection[] = [];
	const headingPattern = /^##\s+(.+)$/gm;
	const matches = Array.from(content.matchAll(headingPattern));

	for (let i = 0; i < matches.length; i++) {
		const match = matches[i];
		const title = stripMarkdown(match[1] ?? "");
		const start = (match.index ?? 0) + match[0].length;
		const end = i + 1 < matches.length ? matches[i + 1].index ?? content.length : content.length;
		const body = content.slice(start, end).trim();
		const lines = body.split("\n").map((line) => line.trim()).filter(Boolean);
		const purpose = stripMarkdown(lines.find((line) => !line.startsWith("- ")) ?? "");
		const bullets = lines.filter((line) => line.startsWith("- ")).map(stripMarkdown);
		if (title && (purpose || bullets.length > 0)) {
			sections.push({ index: i, title, purpose, bullets });
		}
	}

	return sections;
}

function buildPlanQuiz(plan: LessonPlan, seed: number, focusSectionIndexes: number[] = []): Quiz | null {
	const sections = extractPlanSections(plan.content).filter((section) => section.bullets.length > 0 || section.purpose);
	if (sections.length < 2) return null;

	const summary = extractPlanSummary(plan.content);
	const slug = localSlug(plan.topic);
	const allBullets = sections.flatMap((section) => section.bullets.map((bullet) => ({ section, bullet })));
	const orderedSections = [
		...sections.filter((section) => focusSectionIndexes.includes(section.index)),
		...sections.filter((section) => !focusSectionIndexes.includes(section.index)),
	];
	const questions: QuizQuestion[] = [];
	const sectionLimit = focusSectionIndexes.length > 0 ? 7 : 6;

	questions.push({
		id: `${slug}-plan-summary-${seed}`,
		type: "multiple_choice",
		level: "recall",
		question: `Which statement best captures the main point of this lesson plan?`,
		options: optionSet(
			summary,
			[
				`The lesson is mainly a list of unrelated facts about ${plan.topic}.`,
				`The lesson avoids practice and only asks the learner to read.`,
				`The lesson is only concerned with provider setup and app navigation.`,
			],
			seed + 1,
		),
		correctAnswer: summary,
		explanation: `This comes from the saved lesson summary for ${plan.topic}.`,
	});

	for (const section of orderedSections.slice(0, sectionLimit)) {
		const correct = section.bullets[seed % section.bullets.length] ?? section.purpose;
		const distractors = allBullets
			.filter((item) => item.section.index !== section.index)
			.map((item) => item.bullet);
		questions.push({
			id: `${slug}-plan-section-${section.index}-${seed}`,
			type: "multiple_choice",
			level: section.index < 2 ? "comprehension" : section.title.toLowerCase().includes("practice") ? "application" : "analysis",
			question: `In the "${section.title}" part of the plan, which move should the tutor make?`,
			options: optionSet(correct, distractors, seed + section.index + 10),
			correctAnswer: correct,
			explanation: `The "${section.title}" section says: ${correct}`,
		});
	}

	const multiSelectSections = orderedSections.filter((section) => section.bullets.length >= 2);
	const multiSection = multiSelectSections[seed % multiSelectSections.length];
	if (multiSection) {
		const correctAnswers = multiSection.bullets.slice(0, 2);
		const distractors = allBullets
			.filter((item) => item.section.index !== multiSection.index)
			.map((item) => item.bullet);
		questions.push({
			id: `${slug}-plan-multi-${multiSection.index}-${seed}`,
			type: "multi_select",
			level: "application",
			question: `Select the two actions that belong in "${multiSection.title}".`,
			options: optionSet(correctAnswers[0], [correctAnswers[1], ...distractors], seed + 100, "Skip this action"),
			correctAnswer: correctAnswers.join(", "),
			correctAnswers,
			explanation: `Both selected actions come directly from "${multiSection.title}".`,
		});
	}

	const transfer = sections.find((section) => /transfer|reflection/i.test(section.title)) ?? sections.at(-1);
	if (transfer) {
		questions.push({
			id: `${slug}-plan-transfer-${transfer.index}-${seed}`,
			type: "short_answer",
			level: "transfer",
			question: `Use your own words: how would you apply the "${transfer.title}" part of this plan after taking the lesson?`,
			correctAnswer: transfer.bullets[0] ?? transfer.purpose,
			explanation: `A strong answer should connect back to this saved lesson move: ${transfer.bullets[0] ?? transfer.purpose}`,
			rubric: "2pts: names the relevant move. 3pts: applies it to a new example. 4pts: applies it and names a limit.",
		});
	}

	return {
		topic: plan.topic,
		slug: `${slug}-lesson-plan`,
		generatedAt: new Date().toISOString(),
		questions,
		totalPoints: questions.reduce((sum, q) => sum + (q.rubric ? 3 : q.type === "multi_select" ? 2 : 1), 0),
		adaptiveRules: [
			{ level: "recall", threshold: 0.5 },
			{ level: "comprehension", threshold: 0.5 },
			{ level: "application", threshold: 0.5 },
			{ level: "analysis", threshold: 0.5 },
			{ level: "transfer", threshold: 0.5 },
		],
	};
}

function missedSectionIndexes(result: QuizResult | null): number[] {
	if (!result) return [];
	const missed = new Set<number>();
	for (const [questionId, credit] of Object.entries(result.partialCredits)) {
		if (credit >= 1) continue;
		const match = questionId.match(/-plan-(?:section|multi|transfer)-(\d+)-/);
		if (match) missed.add(Number(match[1]));
	}
	return Array.from(missed);
}

function PlanViewer({ plan }: { plan: LessonPlan }) {
	const [mode, setMode] = useState<PlanViewerMode>("lesson");
	const [quizSeed, setQuizSeed] = useState(() => Math.floor(Date.now() % 100000));
	const [lastResult, setLastResult] = useState<QuizResult | null>(null);
	const focusSections = useMemo(() => missedSectionIndexes(lastResult), [lastResult]);
	const quiz = useMemo(() => buildPlanQuiz(plan, quizSeed, focusSections), [plan, quizSeed, focusSections]);

	const redoQuiz = () => {
		setQuizSeed((seed) => seed + 17);
		setMode("quiz");
	};

	return (
		<div className="space-y-4">
			<div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="min-w-0">
					<p className="text-sm font-medium text-foreground">Lesson artifact</p>
					<p className="text-xs text-muted-foreground">
						Read the plan or take a quiz generated from this saved lesson.
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<div className="inline-flex rounded-md border border-border bg-background p-1">
						<button
							type="button"
							onClick={() => setMode("lesson")}
							className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
								mode === "lesson" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
							}`}
						>
							Lesson
						</button>
						<button
							type="button"
							onClick={() => setMode("quiz")}
							disabled={!quiz}
							className={`rounded px-3 py-1.5 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 ${
								mode === "quiz" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
							}`}
						>
							Quiz
						</button>
					</div>
					<button
						type="button"
						onClick={redoQuiz}
						disabled={!quiz}
						className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40"
					>
						<RotateCcw size={13} />
						Redo quiz
					</button>
				</div>
			</div>

			{mode === "lesson" && <ArtifactMarkdownViewer content={plan.content} />}

			{mode === "quiz" && (
				quiz ? (
					<div className="space-y-3">
						{focusSections.length > 0 && (
							<div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
								This redo is weighted toward the sections missed in the last attempt.
							</div>
						)}
						<QuizRenderer
							key={`${plan.id}-${quizSeed}-${focusSections.join(".")}`}
							quiz={quiz}
							onSubmit={(result) => {
								setLastResult(result);
								window.dispatchEvent(
									new CustomEvent("keating:quiz-submitted", {
										detail: {
											quizId: quiz.slug,
											topic: quiz.topic,
											artifactId: plan.id,
											total: quiz.questions.length,
											questions: quiz.questions.map((q) => ({
												id: q.id,
												question: q.question,
												correctAnswer: q.correctAnswer,
												type: q.type,
											})),
											answers: result.answers,
											score: result.score,
											weightedScore: result.weightedScore,
											confidence: result.confidence,
											partialCredits: result.partialCredits,
											flagged: result.flagged,
											timing: result.timing,
										},
									}),
								);
							}}
						/>
					</div>
				) : (
					<div className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
						This lesson plan does not have enough structured sections to build an interactive quiz.
					</div>
				)
			)}
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

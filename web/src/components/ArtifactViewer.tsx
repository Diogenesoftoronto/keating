import { useState, useEffect, useMemo } from "react";
import {
	BookOpen,
	ChevronRight,
	Download,
	Eye,
	EyeOff,
	GitBranch,
	Layers,
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
import { FlashcardRenderer } from "./FlashcardRenderer";
import { MarkdownBlock } from "./MarkdownBlock";
import { sanitizeSvg } from "../lib/sanitize-svg";
import { downloadTextFile } from "../lib/browser-download";
import { KeatingStorage, type LessonPlan, type LessonMap, type Animation, type BenchmarkResult, type EvolutionResult, type Verification, type PromptEvolutionResult, type ImprovementAttemptRecord, type FlashcardDeck } from "../keating/storage";
import { sessions, getInitPromise } from "../hooks/keating-storage";
import type { SessionMetadata } from "../types/session";
import "./selection-library.css";
import { css, cx } from "../../styled-system/css";

interface ArtifactViewerProps {
	storage: KeatingStorage;
	artifactId?: string;
	onClose?: () => void;
}

type ArtifactType = "plan" | "map" | "animation" | "deck" | "benchmark" | "evolution" | "verification" | "prompt-evolution" | "improvement";

type ArtifactAudience = "user" | "agent";

// ── Audience classification ──────────────────────────────────────────
// User-facing: teaching materials the learner directly benefits from
// Agent-facing: internal optimization/self-improvement artifacts

const AUDIENCE_MAP: Record<ArtifactType, ArtifactAudience> = {
	plan: "user",
	map: "user",
	animation: "user",
	deck: "user",
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
	deck: { label: "Flashcards", icon: <Layers size={14} /> },
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
		case "deck":
			return `${(data as unknown as FlashcardDeck).cards.length} cards`;
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

function slugPart(value: string): string {
	const slug = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64);
	return slug || "artifact";
}

function artifactDownload(artifact: Artifact): { filename: string; content: string; type: string } {
	const stem = `keating-${artifact.type}-${slugPart(artifact.label)}`;
	switch (artifact.type) {
		case "plan":
			return { filename: `${stem}.md`, content: (artifact.data as LessonPlan).content, type: "text/markdown;charset=utf-8" };
		case "map": {
			const map = artifact.data as LessonMap;
			return {
				filename: `${stem}.${map.svgContent ? "svg" : "mmd"}`,
				content: map.svgContent ?? map.mmdContent,
				type: map.svgContent ? "image/svg+xml;charset=utf-8" : "text/plain;charset=utf-8",
			};
		}
		case "animation": {
			const animation = artifact.data as Animation;
			return {
				filename: `${stem}.json`,
				content: `${JSON.stringify({
					topic: animation.topic,
					storyboard: animation.storyboard,
					scene: animation.scene,
					manifest: safeJsonParse(animation.manifest),
					renderer: animation.renderer,
					createdAt: animation.createdAt,
				}, null, 2)}\n`,
				type: "application/json;charset=utf-8",
			};
		}
		case "deck":
			return { filename: `${stem}.json`, content: `${JSON.stringify(artifact.data, null, 2)}\n`, type: "application/json;charset=utf-8" };
		case "benchmark":
			return { filename: `${stem}.md`, content: (artifact.data as BenchmarkResult).report, type: "text/markdown;charset=utf-8" };
		case "evolution":
			return { filename: `${stem}.md`, content: (artifact.data as EvolutionResult).report, type: "text/markdown;charset=utf-8" };
		case "verification":
			return { filename: `${stem}.md`, content: (artifact.data as Verification).checklist, type: "text/markdown;charset=utf-8" };
		case "prompt-evolution":
			return { filename: `${stem}.md`, content: (artifact.data as PromptEvolutionResult).report, type: "text/markdown;charset=utf-8" };
		case "improvement":
			return { filename: `${stem}.md`, content: improvementMarkdown(artifact.data as ImprovementAttemptRecord), type: "text/markdown;charset=utf-8" };
	}
}

function safeJsonParse(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

function improvementMarkdown(improvement: ImprovementAttemptRecord): string {
	return `# Improvement Attempt

- Proposal: ${improvement.proposalId}
- Baseline: ${improvement.baselineScore.toFixed(2)}
- After: ${improvement.afterScore === null ? "not measured" : improvement.afterScore.toFixed(2)}
- Delta: ${improvement.scoreDelta === null ? "not measured" : improvement.scoreDelta.toFixed(2)}
- Status: ${improvement.accepted ? "accepted" : "rejected"}
- Targets: ${improvement.targets}

## Hypothesis
${improvement.hypothesis}
`;
}

export function ArtifactViewer({ storage, artifactId, onClose }: ArtifactViewerProps) {
	const [artifacts, setArtifacts] = useState<Artifact[]>([]);
	const [selected, setSelected] = useState<Artifact | null>(null);
	const [loading, setLoading] = useState(true);
	const [query, setQuery] = useState("");
	const [kind, setKind] = useState<string>("all");
	const [showAgentArtifacts, setShowAgentArtifacts] = useState(() => readShowAgent());
	const [sessionMap, setSessionMap] = useState<Map<string, SessionMetadata>>(new Map());

	// Load artifacts
	useEffect(() => {
		async function loadArtifacts() {
			setLoading(true);
			try {
				const [plans, maps, animations, decks, benchmarks, evolutions, verifications, promptEvolutions, improvements] = await Promise.all([
					storage.getLessonPlans(),
					storage.getLessonMaps(),
					storage.getAnimations(),
					storage.getDecks(),
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
					...decks.map((d) => ({ id: d.id, type: "deck" as const, label: d.title, createdAt: d.updatedAt, sessionId: d.sessionId, data: d })),
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
		let result = kind === "all" ? artifacts : artifacts.filter(artifact => artifact.type === kind);
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
	}, [artifacts, query, showAgentArtifacts, kind]);

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

	const downloadSelected = (artifact: Artifact) => {
		const file = artifactDownload(artifact);
		downloadTextFile(file.filename, file.content, file.type);
	};

	const downloadVisibleArtifacts = () => {
		downloadTextFile(
			"keating-visible-artifacts.json",
			`${JSON.stringify(filteredArtifacts.map((artifact) => ({
				id: artifact.id,
				type: artifact.type,
				label: artifact.label,
				createdAt: artifact.createdAt,
				sessionId: artifact.sessionId,
				data: artifact.data,
			})), null, 2)}\n`,
			"application/json;charset=utf-8",
		);
	};

	if (loading) {
		return (
			<div className={css({ padding: "2rem", textAlign: "center", color: "var(--muted-foreground)" })}>
				<div className={css({ animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite" })}>Loading artifacts...</div>
			</div>
		);
	}

	if (selected) {
		return (
			<div className={cx("artifact-detail", css({ minWidth: 0, maxWidth: "100%", color: "var(--foreground)" }))}>
				<div className={css({ marginBottom: "1rem", paddingBottom: "0.5rem", borderBottomWidth: "1px", borderColor: "var(--border)" })}>
					<div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" })}>
						<button onClick={() => setSelected(null)} className={css({ fontSize: "0.875rem", color: "var(--muted-foreground)", _hover: { textDecoration: "underline" } })}>
							← Back to list
						</button>
						<div className={css({ display: "flex", alignItems: "center", gap: "0.75rem", flexShrink: 0 })}>
						<button
							type="button"
							onClick={() => downloadSelected(selected)}
							className={css({
								display: "inline-flex",
								height: "2rem",
								alignItems: "center",
								gap: "0.375rem",
								borderRadius: "0.375rem",
								borderWidth: "1px",
								borderColor: "var(--border)",
								paddingInline: "0.625rem",
								fontSize: "0.75rem",
								fontWeight: 500,
								color: "var(--muted-foreground)",
								transitionProperty: "color, background-color, border-color, text-decoration-color, fill, stroke",
								transitionDuration: "150ms",
								_hover: { background: "var(--accent)", color: "var(--accent-foreground)" },
							})}
						>
							<Download size={14} />
							Download
						</button>
						{onClose && <button type="button" className="library-icon" aria-label="Close artifact panel" title="Close artifact panel" onClick={onClose}><PanelRightClose size={18}/></button>}
						</div>
					</div>
					<h2 className={css({ marginTop: "0.25rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "1.125rem", fontWeight: 600, color: "var(--foreground)" })}>{selected.label}</h2>
					<div className={css({ marginTop: "0.25rem", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.375rem 0.5rem", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
						<span className={css({ display: "inline-flex", alignItems: "center", gap: "0.25rem", borderRadius: "0.25rem", background: "var(--muted)", paddingInline: "0.375rem", paddingBlock: "0.125rem" })}>
							{TYPE_META[selected.type].icon}
							{TYPE_META[selected.type].label}
						</span>
						<span>{new Date(selected.createdAt).toLocaleString()}</span>
						{AUDIENCE_MAP[selected.type] === "agent" && (
							<span className={css({ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.05em", color: "#f59e0b" })}>Agent</span>
						)}
					</div>
				</div>
				<div
					className={cx("artifact-content", css({
						minWidth: 0,
						maxWidth: "100%",
						overflowX: "auto",
						overflowY: "visible",
						overscrollBehaviorX: "contain",
						touchAction: "pan-x pan-y",
						color: "var(--foreground)",
					}))}
					role="region"
					aria-label={`${selected.label} artifact content`}
					tabIndex={0}
				>
					{selected.type === "plan" && <PlanViewer plan={selected.data as LessonPlan} />}
					{selected.type === "map" && <MapView map={selected.data as LessonMap} />}
					{selected.type === "animation" && <AnimationViewer animation={selected.data as Animation} />}
					{selected.type === "deck" && <DeckViewer deck={selected.data as FlashcardDeck} />}
					{selected.type === "benchmark" && <BenchmarkViewer benchmark={selected.data as BenchmarkResult} />}
					{selected.type === "evolution" && <EvolutionViewer evolution={selected.data as EvolutionResult} />}
					{selected.type === "verification" && <VerificationViewer data={selected.data} />}
					{selected.type === "prompt-evolution" && <PromptEvolutionViewer promptEvolution={selected.data as PromptEvolutionResult} />}
					{selected.type === "improvement" && <ImprovementViewer improvement={selected.data as ImprovementAttemptRecord} />}
				</div>
			</div>
		);
	}

 return <section className="material-library" aria-label="Learning materials">
  <header className="material-library__header"><div><h2>Your materials</h2><p>Plans, maps and practice from your conversations.</p></div>
   {onClose && <button className="library-icon" type="button" aria-label="Close artifact panel" onClick={onClose}><PanelRightClose size={18}/></button>}
  </header>
  <label className="library-search"><Search size={18} aria-hidden="true"/><input aria-label="Search materials" value={query} placeholder="Find a material" onChange={event => setQuery(event.target.value)}/></label>
  <div className="material-library__filters" aria-label="Material type">
   {(["all", "plan", "map", "deck", "animation"] as const).map(type => <button type="button" key={type} aria-pressed={kind === type} onClick={() => setKind(type)}>{type === "all" ? "All" : TYPE_META[type].label}</button>)}
  </div>
  <details className="material-library__tools"><summary>Library options</summary>
   <label><input type="checkbox" checked={showAgentArtifacts} onChange={toggleShowAgent}/> Include tutor reports ({agentArtifactCount})</label>
   <button type="button" onClick={downloadVisibleArtifacts} disabled={!filteredArtifacts.length}>Download these materials</button>
  </details>
  {!filteredArtifacts.length ? <div className="library-message"><BookOpen size={24}/><h3>{artifacts.length ? "No matching materials" : "Your learning starts here"}</h3><p>{artifacts.length ? "Try a different search or material type." : "Ask your tutor for a lesson plan, concept map or flashcards. You can return to them here."}</p></div> :
   <div>{sortedGroupKeys.map(groupKey => <section key={groupKey}>
    <h3 className="library-group">{sessionMap.get(groupKey)?.title || "Saved materials"}</h3>
    {groupedBySession.get(groupKey)!.map(artifact => <button type="button" className="material-library__row" key={artifact.id} onClick={() => setSelected(artifact)}>
     <span className="material-library__type" aria-hidden="true">{TYPE_META[artifact.type].icon}</span>
     <span><strong>{artifact.label}</strong><small>{TYPE_META[artifact.type].label} · {formatArtifactDate(artifact.createdAt)}{artifact.type === "deck" ? " · " + artifactPreviewText(artifact) : ""}</small></span><ChevronRight size={16} aria-hidden="true"/>
    </button>)}
   </section>)}</div>}
 </section>;
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
			<div className={css({ minWidth: 0, maxWidth: "none", fontSize: "0.875rem", lineHeight: "1.714" })}>
				<MarkdownBlock content={content} />
			</div>
		);
	}
	return (
		<div className={css({ minWidth: 0, maxWidth: "100%", "& > * + *": { marginTop: "1rem" } })}>
			{parts.map((part, index) => {
				if (part.type === "mermaid") {
					return (
						<div key={index} className={css({ overflow: "auto", borderRadius: "0.5rem", borderWidth: "1px", borderColor: "var(--border)", background: "var(--background)", padding: "1rem" })}>
							<MermaidRenderer content={part.content} />
						</div>
					);
				}
				return (
					<div key={index} className={css({ minWidth: 0, maxWidth: "none", fontSize: "0.875rem", lineHeight: "1.714" })}>
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
		<div className={css({ "& > * + *": { marginTop: "1rem" } })}>
			<div className={css({ borderRadius: "0.5rem", borderWidth: "1px", borderColor: "var(--border)", background: "color-mix(in srgb, var(--muted) 20%, transparent)", padding: "0.75rem" })}>
				<p className={css({ fontSize: "0.875rem", fontWeight: 500, color: "var(--foreground)" })}>Lesson artifact</p>
				<p className={css({ fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
					Work through the lesson below. When you're ready, ask for a quiz and the tutor will craft one from what you covered.
				</p>
			</div>
			<ArtifactMarkdownViewer content={plan.content} />
		</div>
	);
}

function MapView({ map }: { map: LessonMap }) {
	const safeSvg = useMemo(() => (map.svgContent ? sanitizeSvg(map.svgContent) : ""), [map.svgContent]);
	return (
		<div className={css({ minWidth: 0, maxWidth: "100%", overflowX: "auto", overscrollBehaviorX: "contain", touchAction: "pan-x pan-y" })}>
			<MermaidRenderer content={map.mmdContent} className={css({ background: "var(--background)" })} />
			{safeSvg && (
				<details className={css({ marginTop: "1rem" })}>
					<summary className={css({ cursor: "pointer", fontSize: "0.875rem", color: "var(--muted-foreground)" })}>View SVG</summary>
					<div dangerouslySetInnerHTML={{ __html: safeSvg }} className={css({ marginTop: "0.5rem" })} />
				</details>
			)}
		</div>
	);
}

function AnimationViewer({ animation }: { animation: Animation }) {
	return (
		<AnimationPlayer storyboard={animation.storyboard} scene={animation.scene} manifest={animation.manifest} renderer={animation.renderer} />
	);
}

function DeckViewer({ deck }: { deck: FlashcardDeck }) {
	return (
		<div className={css({ "& > * + *": { marginTop: "1rem" } })}>
			<div className={css({ borderRadius: "0.5rem", borderWidth: "1px", borderColor: "var(--border)", background: "color-mix(in srgb, var(--muted) 20%, transparent)", padding: "0.75rem" })}>
				<p className={css({ fontSize: "0.875rem", fontWeight: 500, color: "var(--foreground)" })}>{deck.cards.length} flashcards</p>
				{deck.description && <p className={css({ fontSize: "0.75rem", color: "var(--muted-foreground)" })}>{deck.description}</p>}
			</div>
			<FlashcardRenderer deck={deck} />
		</div>
	);
}

function BenchmarkViewer({ benchmark }: { benchmark: BenchmarkResult }) {
	return (
		<div className={css({ "& > * + *": { marginTop: "1rem" } })}>
			<div className={css({ display: "flex", alignItems: "center", gap: "1rem" })}>
				<div className={css({ fontSize: "1.875rem", lineHeight: "2.25rem", fontWeight: 700, color: "var(--primary)" })}>{benchmark.score.toFixed(1)}</div>
				<div className={css({ fontSize: "0.875rem", color: "var(--muted-foreground)" })}>/ 100</div>
			</div>
			<ArtifactMarkdownViewer content={benchmark.report} />
			{benchmark.trace && (
				<details>
					<summary className={css({ cursor: "pointer", fontSize: "0.875rem", color: "var(--muted-foreground)" })}>View Trace</summary>
					<pre className={css({ marginTop: "0.5rem", maxHeight: "24rem", overflow: "auto", whiteSpace: "pre-wrap", borderRadius: "0.25rem", background: "color-mix(in srgb, var(--muted) 20%, transparent)", padding: "0.75rem", fontSize: "0.75rem" })}>{benchmark.trace}</pre>
				</details>
			)}
		</div>
	);
}

function EvolutionViewer({ evolution }: { evolution: EvolutionResult }) {
	return (
		<div className={css({ "& > * + *": { marginTop: "1rem" } })}>
			<div className={css({ display: "flex", alignItems: "center", gap: "1rem" })}>
				<div className={css({ fontSize: "1.875rem", lineHeight: "2.25rem", fontWeight: 700, color: "var(--primary)" })}>{evolution.bestScore.toFixed(1)}</div>
				<div className={css({ fontSize: "0.875rem", color: "var(--muted-foreground)" })}>/ 100 best score</div>
			</div>
			<ArtifactMarkdownViewer content={evolution.report} />
			{evolution.trace && (
				<details>
					<summary className={css({ cursor: "pointer", fontSize: "0.875rem", color: "var(--muted-foreground)" })}>View Trace</summary>
					<pre className={css({ marginTop: "0.5rem", maxHeight: "24rem", overflow: "auto", whiteSpace: "pre-wrap", borderRadius: "0.25rem", background: "color-mix(in srgb, var(--muted) 20%, transparent)", padding: "0.75rem", fontSize: "0.75rem" })}>{evolution.trace}</pre>
				</details>
			)}
		</div>
	);
}

function PromptEvolutionViewer({ promptEvolution }: { promptEvolution: PromptEvolutionResult }) {
	return (
		<div className={css({ "& > * + *": { marginTop: "1rem" } })}>
			<div className={css({ display: "flex", alignItems: "center", gap: "1rem" })}>
				<div className={css({ fontSize: "1.875rem", lineHeight: "2.25rem", fontWeight: 700, color: "var(--primary)" })}>{promptEvolution.bestScore.toFixed(1)}</div>
				<div className={css({ fontSize: "0.875rem", color: "var(--muted-foreground)" })}>best prompt score</div>
			</div>
			<ArtifactMarkdownViewer content={promptEvolution.report} />
			<details>
				<summary className={css({ cursor: "pointer", fontSize: "0.875rem", color: "var(--muted-foreground)" })}>View Prompt</summary>
				<pre className={css({ marginTop: "0.5rem", maxHeight: "24rem", overflow: "auto", whiteSpace: "pre-wrap", borderRadius: "0.25rem", background: "color-mix(in srgb, var(--muted) 20%, transparent)", padding: "0.75rem", fontSize: "0.75rem" })}>{promptEvolution.bestPrompt}</pre>
			</details>
		</div>
	);
}

function ImprovementViewer({ improvement }: { improvement: ImprovementAttemptRecord }) {
	return <ArtifactMarkdownViewer content={improvementMarkdown(improvement)} />;
}

function VerificationViewer({ data }: { data: unknown }) {
	const verification = data as Verification;
	return <ArtifactMarkdownViewer content={verification.checklist} />;
}

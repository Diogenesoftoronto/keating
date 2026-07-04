import { Suspense, useEffect, useRef, useState } from "react";
import { usePostHog } from "@posthog/react";
import {
  BarChart3,
  BookOpen,
  Bug,
  ChevronDown,
  ChevronRight,
  Cpu,
  LibraryBig,
  Map as MapIcon,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  Settings,
  Share2,
  Sparkles,
  Volume2,
  VolumeX,
  Wrench,
  X,
} from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useKeatingAgent } from "../hooks/useKeatingAgent";
import { keatingStorage, sessions } from "../hooks/keating-storage";
import { useSeo } from "../hooks/useSeo";
import { useMediaQuery } from "../hooks/use-media-query";
import { ChatIntro } from "../components/ChatIntro";
import { ArtifactBrowserOverlay } from "../components/ArtifactBrowserOverlay";
import { ArtifactSidePanel } from "../components/ArtifactSidePanel";
import { AssistantChatPanel } from "../components/AssistantChatPanel";
import { ForkBanner } from "../components/ForkBanner";
import { MermaidRenderer } from "../components/MermaidRenderer";
import { MarkdownBlock } from "../components/MarkdownBlock";
import { SandboxView } from "../components/SandboxView";
import { ThemeToggle } from "../components/ThemeToggle";
import {
  loadKeatingUiSettings,
  subscribeKeatingUiSettings,
} from "../keating/ui-settings";
import type {
  LessonPlan,
  LessonMap,
  Animation,
  BenchmarkResult,
  EvolutionResult,
  Verification,
  PromptEvolutionResult,
  ImprovementAttemptRecord,
  FlashcardDeck,
} from "../keating/storage";

const GITHUB_ISSUE_URL = "https://github.com/Diogenesoftoronto/keating/issues/new";

// ── Inline artifact types ──────────────────────────────────────────────
// Mirrors the storage record unions but kept narrow so the inline renderer
// stays declarative — every artifact card knows how to draw itself from its
// own data without falling back to the side panel viewer.
type InlineArtifact =
  | { id: string; type: "plan"; createdAt: number; data: LessonPlan }
  | { id: string; type: "map"; createdAt: number; data: LessonMap }
  | { id: string; type: "animation"; createdAt: number; data: Animation }
  | { id: string; type: "deck"; createdAt: number; data: FlashcardDeck }
  | { id: string; type: "verification"; createdAt: number; data: Verification }
  | { id: string; type: "benchmark"; createdAt: number; data: BenchmarkResult }
  | { id: string; type: "evolution"; createdAt: number; data: EvolutionResult }
  | { id: string; type: "prompt-evolution"; createdAt: number; data: PromptEvolutionResult }
  | { id: string; type: "improvement"; createdAt: number; data: ImprovementAttemptRecord };

const ARTIFACT_TYPE_META: Record<
  InlineArtifact["type"],
  { label: string; icon: React.ReactNode }
> = {
  plan: { label: "Lesson Plan", icon: <BookOpen size={14} /> },
  map: { label: "Concept Map", icon: <MapIcon size={14} /> },
  animation: { label: "Animation", icon: <Play size={14} /> },
  deck: { label: "Flashcards", icon: <LibraryBig size={14} /> },
  verification: { label: "Verification", icon: <ChevronRight size={14} /> },
  benchmark: { label: "Benchmark", icon: <Sparkles size={14} /> },
  evolution: { label: "Evolution", icon: <Sparkles size={14} /> },
  "prompt-evolution": { label: "Prompt Evo", icon: <Sparkles size={14} /> },
  improvement: { label: "Improvement", icon: <Wrench size={14} /> },
};

// The mermaid fence may carry extra metadata after the opening backticks
// (` ```mermaid `, ` ```mermaid title=… `) — the (.*?) tolerates both.
const MERMAID_FENCE_PATTERN = /```mermaid[^\n]*\n([\s\S]*?)```/gi;

function splitMermaidBlocks(content: string): Array<
  { type: "markdown" | "mermaid"; content: string }
> {
  const parts: Array<{ type: "markdown" | "mermaid"; content: string }> = [];
  let lastIndex = 0;
  for (const match of content.matchAll(MERMAID_FENCE_PATTERN)) {
    const index = match.index ?? 0;
    const markdown = content.slice(lastIndex, index);
    if (markdown.trim()) parts.push({ type: "markdown", content: markdown });
    parts.push({ type: "mermaid", content: match[1].trim() });
    lastIndex = index + match[0].length;
  }
  const trailing = content.slice(lastIndex);
  if (trailing.trim()) parts.push({ type: "markdown", content: trailing });
  return parts;
}

// Inline mermaid diagram. Mirrors the rendering used inside `ArtifactViewer`'s
// `ArtifactMarkdownViewer` but lives in this page so the chat shell can render
// diagrams without delegating to a child component.
function InlineMermaidDiagram({ source }: { source: string }) {
  return (
    <div className="my-3 overflow-auto rounded-lg border border-border bg-muted/30 p-4">
      <MermaidRenderer content={source} />
    </div>
  );
}

// Renders arbitrary lesson/artifact markdown with mermaid fences promoted to
// inline diagrams. Used by the inline artifact cards below.
function InlineMarkdownWithDiagrams({ content }: { content: string }) {
  const parts = splitMermaidBlocks(content);
  if (parts.length === 0) {
    return (
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <MarkdownBlock content={content} />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {parts.map((part, i) =>
        part.type === "mermaid" ? (
          <InlineMermaidDiagram key={i} source={part.content} />
        ) : (
          <div key={i} className="prose prose-sm dark:prose-invert max-w-none">
            <MarkdownBlock content={part.content} />
          </div>
        ),
      )}
    </div>
  );
}

function InlineArtifactCard({
  artifact,
  onDismiss,
  onOpenInBrowser,
}: {
  artifact: InlineArtifact;
  onDismiss: () => void;
  onOpenInBrowser: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const meta = ARTIFACT_TYPE_META[artifact.type];
  const heading = (() => {
    switch (artifact.type) {
      case "plan":
        return artifact.data.topic;
      case "map":
        return artifact.data.topic;
      case "animation":
        return artifact.data.topic;
      case "deck":
        return artifact.data.title;
      case "verification":
        return artifact.data.topic;
      case "benchmark":
        return artifact.data.topic ?? "general";
      case "evolution":
        return artifact.data.topic ?? "general";
      case "prompt-evolution":
        return artifact.data.promptName;
      case "improvement":
        return artifact.data.proposalId;
    }
  })();
  const subline = (() => {
    switch (artifact.type) {
      case "benchmark":
        return `Score ${artifact.data.score.toFixed(2)}`;
      case "evolution":
        return `Best score ${artifact.data.bestScore.toFixed(2)}`;
      case "prompt-evolution":
        return `Best score ${artifact.data.bestScore.toFixed(2)}`;
      case "improvement":
        return `${artifact.data.accepted ? "Accepted" : "Rejected"} · Δ${(artifact.data.scoreDelta ?? 0).toFixed(2)}`;
      case "deck":
        return `${artifact.data.cards.length} cards`;
      case "verification":
        return `${(artifact.data.checklist.match(/- \[ \]/g)?.length ?? 0)} checks`;
      default:
        return null;
    }
  })();

  return (
    <article className="rounded-lg border border-border bg-card text-card-foreground shadow-sm">
      <header className="flex items-start gap-3 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          aria-label={expanded ? "Collapse artifact" : "Expand artifact"}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-0.5">
              {meta.icon}
              {meta.label}
            </span>
            {subline && <span className="text-muted-foreground">· {subline}</span>}
          </div>
          <h3 className="mt-0.5 truncate text-sm font-semibold">{heading}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onOpenInBrowser}
            className="inline-flex h-7 items-center rounded-md border border-border px-2 text-xs hover:bg-accent hover:text-accent-foreground"
            title="Open in artifact browser"
          >
            Open
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            aria-label="Dismiss artifact"
            title="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      </header>
      {expanded && (
        <div className="px-4 py-3 text-sm">
          {renderInlineArtifactBody(artifact)}
        </div>
      )}
    </article>
  );
}

function renderInlineArtifactBody(artifact: InlineArtifact) {
  switch (artifact.type) {
    case "plan":
      return <InlineMarkdownWithDiagrams content={artifact.data.content} />;
    case "map":
      return <InlineMermaidDiagram source={artifact.data.mmdContent} />;
    case "animation":
      return (
        <div className="space-y-3">
          <div className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
            {artifact.data.scene ? "Scene ready" : "Storyboard only"} ·{" "}
            {artifact.data.manifest ? "manifest attached" : "no manifest"}
          </div>
          <InlineMarkdownWithDiagrams content={artifact.data.storyboard} />
        </div>
      );
    case "deck":
      return (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {artifact.data.cards.length} cards · open in the browser for spaced
            repetition review.
          </p>
          <ul className="space-y-1 text-sm">
            {artifact.data.cards.slice(0, 5).map((c) => (
              <li
                key={c.id}
                className="rounded-md border border-border bg-background px-3 py-2"
              >
                <div className="text-xs uppercase text-muted-foreground">
                  {c.front}
                </div>
                <div className="text-sm">{c.back}</div>
              </li>
            ))}
            {artifact.data.cards.length > 5 && (
              <li className="text-xs text-muted-foreground">
                +{artifact.data.cards.length - 5} more…
              </li>
            )}
          </ul>
        </div>
      );
    case "verification":
      return (
        <InlineMarkdownWithDiagrams content={artifact.data.checklist} />
      );
    case "benchmark":
      return <InlineMarkdownWithDiagrams content={artifact.data.report} />;
    case "evolution":
      return <InlineMarkdownWithDiagrams content={artifact.data.report} />;
    case "prompt-evolution":
      return <InlineMarkdownWithDiagrams content={artifact.data.report} />;
    case "improvement":
      return (
        <div className="space-y-2">
          <p className="text-sm">{artifact.data.hypothesis}</p>
          <div className="rounded-md border border-border bg-background p-3 text-xs">
            <div className="font-medium">Targets</div>
            <div className="mt-1 text-muted-foreground">
              {artifact.data.targets || "(unspecified)"}
            </div>
          </div>
        </div>
      );
  }
}

function InlineArtifacts({
  artifacts,
  onDismiss,
  onOpenInBrowser,
}: {
  artifacts: InlineArtifact[];
  onDismiss: (id: string) => void;
  onOpenInBrowser: (id: string) => void;
}) {
  if (artifacts.length === 0) return null;
  return (
    <section
      aria-label="Inline artifacts"
      className="border-t border-border bg-muted/20 px-3 py-3 sm:px-4"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-medium">
            {artifacts.length} inline artifact
            {artifacts.length === 1 ? "" : "s"}
          </span>
          <span>Rendered directly in the chat page</span>
        </div>
        {artifacts.map((artifact) => (
          <InlineArtifactCard
            key={`${artifact.type}:${artifact.id}`}
            artifact={artifact}
            onDismiss={() => onDismiss(artifact.id)}
            onOpenInBrowser={() => onOpenInBrowser(artifact.id)}
          />
        ))}
      </div>
    </section>
  );
}

async function findLatestArtifact<T extends { id: string; createdAt: number }>(
  list: T[],
  id?: string,
): Promise<T | null> {
  if (!list.length) return null;
  if (id) return list.find((x) => x.id === id) ?? null;
  return list.slice().sort((a, b) => b.createdAt - a.createdAt)[0];
}

async function loadArtifactByType(
  type: InlineArtifact["type"],
  id?: string,
): Promise<InlineArtifact | null> {
  switch (type) {
    case "plan": {
      const data = await findLatestArtifact(
        await keatingStorage.getLessonPlans(),
        id,
      );
      return data
        ? { id: data.id, type: "plan", createdAt: data.createdAt, data }
        : null;
    }
    case "map": {
      const data = await findLatestArtifact(
        await keatingStorage.getLessonMaps(),
        id,
      );
      return data
        ? { id: data.id, type: "map", createdAt: data.createdAt, data }
        : null;
    }
    case "animation": {
      const data = await findLatestArtifact(
        await keatingStorage.getAnimations(),
        id,
      );
      return data
        ? { id: data.id, type: "animation", createdAt: data.createdAt, data }
        : null;
    }
    case "deck": {
      const data = await findLatestArtifact(
        await keatingStorage.getDecks(),
        id,
      );
      return data
        ? { id: data.id, type: "deck", createdAt: data.updatedAt, data }
        : null;
    }
    case "verification": {
      const data = await findLatestArtifact(
        await keatingStorage.getVerifications(),
        id,
      );
      return data
        ? {
            id: data.id,
            type: "verification",
            createdAt: data.createdAt,
            data,
          }
        : null;
    }
    case "benchmark": {
      const data = await findLatestArtifact(
        await keatingStorage.getBenchmarks(),
        id,
      );
      return data
        ? { id: data.id, type: "benchmark", createdAt: data.createdAt, data }
        : null;
    }
    case "evolution": {
      const data = await findLatestArtifact(
        await keatingStorage.getEvolutions(),
        id,
      );
      return data
        ? { id: data.id, type: "evolution", createdAt: data.createdAt, data }
        : null;
    }
    case "prompt-evolution": {
      const data = await findLatestArtifact(
        await keatingStorage.getPromptEvolutions(),
        id,
      );
      return data
        ? {
            id: data.id,
            type: "prompt-evolution",
            createdAt: data.createdAt,
            data,
          }
        : null;
    }
    case "improvement": {
      const data = await findLatestArtifact(
        await keatingStorage.getImprovementAttempts(),
        id,
      );
      return data
        ? {
            id: data.id,
            type: "improvement",
            createdAt: data.createdAt,
            data,
          }
        : null;
    }
  }
}

// Resolve the most recently created artifact from the `keating:artifact-created`
// event. The event payload may carry an `id`/`type` directly, or only the tool
// name + result. We pull the freshest record of that type out of storage.
async function resolveInlineArtifact(
  detail: Record<string, unknown>,
): Promise<InlineArtifact | null> {
  const explicitId = typeof detail.id === "string" ? detail.id : undefined;
  const explicitType =
    typeof detail.type === "string" ? detail.type : undefined;
  const toolName =
    typeof detail.toolName === "string" ? detail.toolName : undefined;
  const result =
    detail.result && typeof detail.result === "object"
      ? (detail.result as Record<string, unknown>)
      : undefined;
  const resultId =
    (result && typeof result.id === "string" ? result.id : undefined) ??
    (result && typeof result.artifactId === "string"
      ? result.artifactId
      : undefined);

  const toolToType: Record<string, InlineArtifact["type"]> = {
    plan: "plan",
    map: "map",
    animate: "animation",
    animation: "animation",
    verify: "verification",
    bench: "benchmark",
    benchmark: "benchmark",
    evolve: "evolution",
    evolution: "evolution",
    prompt_evolve: "prompt-evolution",
    "prompt-evolve": "prompt-evolution",
    quiz: "plan",
    deck: "deck",
    auto_improve: "improvement",
    improvement: "improvement",
  };

  const candidates: Array<{ type: InlineArtifact["type"]; id?: string }> = [];
  if (explicitType && toolToType[explicitType]) {
    candidates.push({ type: toolToType[explicitType], id: explicitId });
  }
  if (toolName && toolToType[toolName]) {
    candidates.push({ type: toolToType[toolName], id: resultId });
  }

  for (const cand of candidates) {
    const artifact = await loadArtifactByType(cand.type, cand.id);
    if (artifact) return artifact;
  }
  return null;
}

function ChatContent() {
  useSeo({
    title: "Keating Chat — Socratic AI Tutor Session",
    description:
      "Start a Socratic tutoring session with Keating. Diagnose what you know, reconstruct understanding from memory, and test transfer to new contexts.",
    canonical: "https://keating.help/chat",
  });
  const posthog = usePostHog();
  const navigate = useNavigate();
  const {
    isPending,
    openSettings,
    newSession,
    shareSession,
    chatPanelRef,
    dialogs,
    sessionSidebar,
    speechEnabled,
    persistentStorageStatus,
    persistentBannerDismissed,
    retryPersistentStorage,
    dismissPersistentBanner,
    toggleSpeech,
    forkingSessionId,
    forkInfo,
    openOriginalSession,
    mobileSidebarOpen,
    toggleMobileSidebar,
  } = useKeatingAgent();
  const [introDismissed, setIntroDismissed] = useState(
    () =>
      localStorage.getItem("keating_chat_intro") === "dismissed" ||
      sessionStorage.getItem("keating_chat_intro") === "dismissed",
  );
  const [artifactBrowserOpen, setArtifactBrowserOpen] = useState(false);
  const isWideViewport = useMediaQuery("(min-width: 1024px)");
  const [uiSettings, setUiSettings] = useState(() => loadKeatingUiSettings());
  const [shareState, setShareState] = useState<
    "idle" | "sharing" | "copied" | "error"
  >("idle");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [nodePodOpen, setNodePodOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  // Close mobile menu on click outside or escape
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileMenuOpen(false);
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (
        mobileMenuRef.current &&
        !mobileMenuRef.current.contains(e.target as Node)
      ) {
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener("keydown", handleEscape);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [mobileMenuOpen]);

  const dismissIntro = () => {
    setIntroDismissed(true);
    localStorage.setItem("keating_chat_intro", "dismissed");
    posthog.capture('chat_intro_dismissed');
  };

  // Returning users with saved sessions shouldn't be gated by the intro.
  useEffect(() => {
    if (introDismissed) return;
    let cancelled = false;
    sessions
      .getAllMetadata()
      .then((items) => {
        if (cancelled || items.length === 0) return;
        setIntroDismissed(true);
        localStorage.setItem("keating_chat_intro", "dismissed");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [introDismissed]);

  useEffect(() => subscribeKeatingUiSettings(setUiSettings), []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.add("chat-shell-active");
    return () => document.body.classList.remove("chat-shell-active");
  }, []);

  const [artifactTarget, setArtifactTarget] = useState<string | undefined>(
    undefined,
  );
  const [inlineArtifacts, setInlineArtifacts] = useState<InlineArtifact[]>([]);

  useEffect(() => {
    const openArtifacts = () => {
      if (uiSettings.autoOpenArtifacts) setArtifactBrowserOpen(true);
    };
    const openArtifactTarget = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.id) {
        setArtifactTarget(detail.id);
        setArtifactBrowserOpen(true);
      }
    };
    const captureInlineArtifact = async (e: Event) => {
      const detail = (e as CustomEvent).detail ?? {};
      const next = await resolveInlineArtifact(detail);
      if (!next) return;
      setInlineArtifacts((prev) => {
        if (prev.some((a) => a.id === next.id && a.type === next.type)) return prev;
        return [...prev, next];
      });
      if (uiSettings.autoOpenArtifacts) setArtifactBrowserOpen(true);
    };
    window.addEventListener("keating:artifact-created", openArtifacts);
    window.addEventListener("keating:artifact-created", captureInlineArtifact);
    window.addEventListener("keating:open-artifact", openArtifactTarget);
    return () => {
      window.removeEventListener("keating:artifact-created", openArtifacts);
      window.removeEventListener("keating:artifact-created", captureInlineArtifact);
      window.removeEventListener("keating:open-artifact", openArtifactTarget);
    };
  }, [uiSettings.autoOpenArtifacts]);

  const handleShare = async () => {
    setShareState("sharing");
    setShareMessage(null);
    try {
      const result = await shareSession();
      setShareUrl(result.url);
      const linkType = result.mode === "portable-short"
        ? "Portable share link"
        : result.mode === "compressed-hash"
          ? "Snapshot share link"
          : "Local share link";
      setShareMessage(
        `${linkType} ready${result.fallback ? " after portable storage was unavailable" : ""}. It was copied if your browser allowed clipboard access.`,
      );
      setShareState("copied");
      posthog.capture('session_shared', { share_mode: result.mode, fallback: result.fallback });
      window.setTimeout(() => setShareState("idle"), 1600);
    } catch (error) {
      console.warn("Failed to share session:", error);
      setShareMessage(
        error instanceof Error
          ? error.message
          : "Could not create a share link yet.",
      );
      setShareState("error");
      window.setTimeout(() => setShareState("idle"), 2200);
    }
  };

  // NOTE: responsive Tailwind display variants (e.g. `hidden md:inline-flex`) are
  // NOT reliable here. Tailwind is compiled twice — once via `@import "tailwindcss"`
  // in app.css and again transitively through `@earendil-works/pi-web-ui/app.css`.
  // The second copy re-emits base `.hidden`/`.inline-flex` AFTER the first copy's
  // `md:/lg:` variants, so (same layer, same specificity) base wins and the variant
  // is dead at every width. We instead drive show/hide from unlayered CSS in
  // app.css via `.chat-only-desktop` (header icons, md+) and `.chat-only-compact`
  // (overflow-menu duplicates, < md). Unlayered rules beat Tailwind's @layer
  // utilities regardless of import order, so this is deterministic.
  const actionButtonClass =
    "chat-action-button shrink-0 items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50";
  const showPersistenceBanner = persistentStorageStatus === "declined" && !persistentBannerDismissed;

  return (
    <div className={`chat-page-shell w-full flex flex-col bg-background text-foreground overflow-hidden ${forkingSessionId ? "session-forking" : ""}`}>
      {/* Header */}
      <nav
        className="chat-header flex items-center gap-2 border-b border-border shrink-0 px-2 sm:px-4 py-2 h-14 relative"
        aria-label="Chat navigation"
      >
        <button
          type="button"
          className={`${actionButtonClass} inline-flex lg:hidden`}
          title={mobileSidebarOpen ? "Close sessions panel" : "Open sessions panel"}
          aria-label={mobileSidebarOpen ? "Close sessions panel" : "Open sessions panel"}
          aria-pressed={mobileSidebarOpen}
          onClick={toggleMobileSidebar}
        >
          {mobileSidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
        <Link
          to="/"
          className="chat-brand inline-flex min-w-0 shrink-0 items-center gap-2 rounded-md px-2 py-1"
          aria-label="Go to Keating home"
        >
          <img
            src="/brand/logo-lockup.png"
            alt="Keating"
            className="h-6 w-auto object-contain"
          />
        </Link>
        <span className="chat-mode-badge chat-only-desktop">MODE: SOCRATIC</span>

        {/* Actions */}
        <div className="chat-actions ml-auto flex min-w-0 items-center justify-end gap-1 overflow-hidden sm:flex-1">
          <button
            className={`${actionButtonClass} chat-only-desktop`}
            title="New session"
            aria-label="New session"
            disabled={isPending}
            onClick={newSession}
          >
            <Plus size={16} />
          </button>
          <button
            className={`${actionButtonClass} inline-flex`}
            title="Settings"
            aria-label="Settings"
            onClick={openSettings}
          >
            <Settings size={16} />
          </button>
          <span className="chat-only-desktop">
            <ThemeToggle />
          </span>
          <button
            className={`${actionButtonClass} chat-only-desktop ${shareState === "copied" ? "text-primary" : ""} ${shareState === "error" ? "text-destructive" : ""}`}
            title={
              shareState === "copied"
                ? "Copied share link"
                : shareState === "error"
                  ? "Could not share yet"
                  : "Share session"
            }
            aria-label="Share session"
            disabled={isPending || shareState === "sharing"}
            onClick={handleShare}
          >
            <Share2 size={16} />
          </button>
          <button
            className={`${actionButtonClass} chat-only-desktop ${speechEnabled ? "text-primary" : ""}`}
            title={speechEnabled ? "Disable speech" : "Enable speech"}
            aria-pressed={speechEnabled}
            onClick={toggleSpeech}
          >
            {speechEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
          <button
            className={`${actionButtonClass} chat-only-desktop`}
            title="Artifacts"
            aria-label="Artifacts"
            onClick={() => setArtifactBrowserOpen(true)}
          >
            <LibraryBig size={16} />
          </button>
          {import.meta.env.DEV && (
            <button
              className={`${actionButtonClass} chat-only-desktop`}
              title="NodePod runtime"
              aria-label="NodePod runtime"
              onClick={() => setNodePodOpen(true)}
            >
              <Cpu size={16} />
            </button>
          )}
          <button
            className={`${actionButtonClass} chat-only-desktop`}
            title="Learning usage"
            aria-label="Learning usage"
            onClick={() => navigate({ to: "/usage" })}
          >
            <BarChart3 size={16} />
          </button>
          <a
            className={`${actionButtonClass} chat-only-desktop`}
            title="Report an issue"
            aria-label="Report an issue on GitHub"
            href={GITHUB_ISSUE_URL}
            target="_blank"
            rel="noreferrer"
          >
            <Bug size={16} />
          </a>
          <button
            className={`${actionButtonClass} inline-flex`}
            title="Menu"
            aria-label="More menu"
            aria-expanded={mobileMenuOpen}
            aria-haspopup="menu"
            onClick={() => setMobileMenuOpen((o) => !o)}
          >
            {mobileMenuOpen ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>

        {/* Overflow menu */}
        {mobileMenuOpen && (
          <div
            ref={mobileMenuRef}
            role="menu"
            className="absolute right-2 top-full z-50 mt-1 w-56 rounded-md border border-border bg-background shadow-lg font-terminal"
            style={{ fontSize: "0.875rem" }}
          >
            <div className="flex flex-col p-1">
              <button
                className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors chat-only-compact"
                disabled={isPending}
                onClick={() => {
                  setMobileMenuOpen(false);
                  newSession();
                }}
              >
                <Plus size={14} />
                New session
              </button>
              <button
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors chat-only-compact ${shareState === "copied" ? "text-primary" : ""} ${shareState === "error" ? "text-destructive" : ""}`}
                onClick={() => {
                  setMobileMenuOpen(false);
                  handleShare();
                }}
                disabled={isPending || shareState === "sharing"}
              >
                <Share2 size={14} />
                {shareState === "copied" ? "Link copied" : "Share session"}
              </button>
              <button
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors chat-only-compact ${speechEnabled ? "text-primary" : ""}`}
                onClick={() => {
                  setMobileMenuOpen(false);
                  toggleSpeech();
                }}
              >
                {speechEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
                {speechEnabled ? "Disable speech" : "Enable speech"}
              </button>
              <ThemeToggle
                className="chat-only-compact"
                variant="menu"
                onToggled={() => setMobileMenuOpen(false)}
              />
              <button
                className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors chat-only-compact"
                onClick={() => {
                  setMobileMenuOpen(false);
                  setArtifactBrowserOpen(true);
                }}
              >
                <LibraryBig size={14} />
                Artifacts
              </button>
              {import.meta.env.DEV && (
                <button
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors chat-only-compact"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setNodePodOpen(true);
                  }}
                >
                  <Cpu size={14} />
                  NodePod runtime
                </button>
              )}
              <button
                className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors chat-only-compact"
                onClick={() => {
                  setMobileMenuOpen(false);
                  navigate({ to: "/usage" });
                }}
              >
                <BarChart3 size={14} />
                Learning usage
              </button>
              <div className="my-1 border-t border-border chat-only-compact" />
              <Link
                to="/"
                className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                Home
              </Link>
              <Link
                to="/tutorial"
                className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                Tutorial
              </Link>
              <Link
                to="/blog"
                className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                Blog
              </Link>
              <Link
                to="/paper"
                className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                Paper
              </Link>
              <a
                href="https://github.com/Diogenesoftoronto/keating"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                GitHub
              </a>
              <a
                href={GITHUB_ISSUE_URL}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors chat-only-compact"
                onClick={() => setMobileMenuOpen(false)}
              >
                Report issue
              </a>
            </div>
          </div>
        )}
      </nav>

      {forkInfo && (
        <ForkBanner
          parentTitle={forkInfo.parentTitle}
          onOpenOriginal={openOriginalSession}
        />
      )}

      {showPersistenceBanner && (
        <div className="shrink-0 border-b border-border bg-amber-500/10 px-3 py-2">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-medium text-amber-800 dark:text-amber-200">
              <span className="hidden sm:inline">Browser storage persistence is not enabled. Sessions still save locally, but the browser may clear them under storage pressure.</span>
              <span className="sm:hidden">Storage persistence is not enabled.</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                className="inline-flex h-6 items-center rounded bg-primary px-2 text-[10px] font-medium text-primary-foreground hover:bg-primary/90"
                onClick={retryPersistentStorage}
              >
                Try again
              </button>
              <button
                type="button"
                className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                onClick={dismissPersistentBanner}
                aria-label="Dismiss persistence warning"
              >
                <X size={12} />
              </button>
            </div>
          </div>
        </div>
      )}

      {introDismissed ? (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {sessionSidebar}
          <AssistantChatPanel
            ref={chatPanelRef}
            className="chat-page-panel flex-1 min-w-0"
            speechEnabled={speechEnabled}
          />
          {isWideViewport && artifactBrowserOpen && (
            <div className="shrink-0 border-l border-border h-full">
              <ArtifactSidePanel
                open={artifactBrowserOpen}
                artifactId={artifactTarget}
                onClose={() => {
                  setArtifactBrowserOpen(false);
                  setArtifactTarget(undefined);
                }}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="relative flex-1 overflow-hidden">
          <ChatIntro />
          <button
            onClick={dismissIntro}
            className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 px-6 py-2.5 border-2 border-primary text-primary font-terminal text-sm hover:bg-primary hover:text-primary-foreground transition-colors"
          >
            [ GET STARTED → ]
          </button>
        </div>
      )}

      {inlineArtifacts.length > 0 && introDismissed && (
        <InlineArtifacts
          artifacts={inlineArtifacts}
          onDismiss={(id) =>
            setInlineArtifacts((prev) => prev.filter((a) => a.id !== id))
          }
          onOpenInBrowser={(id) => {
            setArtifactTarget(id);
            setArtifactBrowserOpen(true);
          }}
        />
      )}

      {(shareUrl || shareMessage) && (
        <div className="border-t border-border bg-background px-4 py-3 text-sm">
          <div className="mx-auto flex max-w-4xl flex-col gap-2 sm:flex-row sm:items-center">
            <span
              className={
                shareState === "error"
                  ? "text-destructive"
                  : "text-muted-foreground"
              }
            >
              {shareMessage}
            </span>
            {shareUrl && (
              <input
                className="min-w-0 flex-1 rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs text-foreground"
                readOnly
                value={shareUrl}
                onFocus={(event) => event.currentTarget.select()}
              />
            )}
            <button
              className="inline-flex h-8 items-center justify-center rounded-md border border-border px-3 text-xs hover:bg-accent"
              onClick={() => {
                setShareUrl(null);
                setShareMessage(null);
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <ArtifactBrowserOverlay
        open={artifactBrowserOpen && !isWideViewport}
        artifactId={artifactTarget}
        onClose={() => {
          setArtifactBrowserOpen(false);
          setArtifactTarget(undefined);
        }}
      />
      <SandboxView open={nodePodOpen} onClose={() => setNodePodOpen(false)} />
      {dialogs}
    </div>
  );
}

export function Chat() {
  return (
    <Suspense
      fallback={
        <div className="chat-page-shell w-full flex flex-col bg-background text-foreground overflow-hidden">
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            Initializing…
          </div>
        </div>
      }
    >
      <ChatContent />
    </Suspense>
  );
}

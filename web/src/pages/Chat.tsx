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
import { css, cx } from "../../styled-system/css";
import { useKeatingAgent } from "../hooks/useKeatingAgent";
import { keatingStorage, sessions } from "../hooks/keating-storage";
import { useSeo } from "../hooks/useSeo";
import { useMediaQuery } from "../hooks/use-media-query";
import { ChatIntro } from "../components/ChatIntro";
import { ArtifactBrowserOverlay } from "../components/ArtifactBrowserOverlay";
import { ArtifactSidePanel } from "../components/ArtifactSidePanel";
import { AssistantChatPanel } from "../components/AssistantChatPanel";
import { ResponseComparisonPanel } from "../components/ResponseComparisonPanel";
import { ForkBanner } from "../components/ForkBanner";
import { MermaidRenderer } from "../components/MermaidRenderer";
import { MarkdownBlock } from "../components/MarkdownBlock";
import { SandboxView } from "../components/SandboxView";
import { ThemeToggle } from "../components/ThemeToggle";
import {
  loadKeatingUiSettings,
  saveKeatingUiSettings,
  subscribeKeatingUiSettings,
  shareModeExposesDataPublicly,
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

const proseBlockClass = css({
  maxWidth: "none",
  "& p": { marginBlock: "0.75rem" },
  "& ul, & ol": { marginBlock: "0.75rem", paddingInlineStart: "1.5rem" },
  "& code": {
    fontFamily: "var(--mono-body)",
    fontSize: "0.875em",
  },
});

const iconButtonClass = css({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "0.375rem",
  color: "var(--muted-foreground)",
  transitionProperty: "color, background-color, border-color, opacity",
  transitionDuration: "150ms",
  _hover: {
    backgroundColor: "var(--accent)",
    color: "var(--accent-foreground)",
  },
});

const actionButtonPandaClass = css({
  flexShrink: 0,
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  fontWeight: 500,
  transitionProperty: "color, background-color, border-color, opacity",
  transitionDuration: "150ms",
  _hover: {
    backgroundColor: "var(--accent)",
    color: "var(--accent-foreground)",
  },
  _disabled: {
    pointerEvents: "none",
    opacity: 0.5,
  },
});

const menuItemClass = css({
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  borderRadius: "0.375rem",
  paddingInline: "0.75rem",
  paddingBlock: "0.5rem",
  textAlign: "left",
  fontSize: "0.875rem",
  transitionProperty: "color, background-color, border-color",
  transitionDuration: "150ms",
  _hover: {
    backgroundColor: "var(--accent)",
    color: "var(--accent-foreground)",
  },
});

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
    <div
      className={css({
        marginBlock: "0.75rem",
        overflow: "auto",
        borderRadius: "0.5rem",
        border: "1px solid var(--border)",
        backgroundColor: "color-mix(in srgb, var(--muted) 30%, transparent)",
        padding: "1rem",
      })}
    >
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
      <div className={proseBlockClass}>
        <MarkdownBlock content={content} />
      </div>
    );
  }
  return (
    <div className={css({ display: "grid", gap: "0.75rem" })}>
      {parts.map((part, i) =>
        part.type === "mermaid" ? (
          <InlineMermaidDiagram key={i} source={part.content} />
        ) : (
          <div key={i} className={proseBlockClass}>
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
    <article
      className={css({
        borderRadius: "0.5rem",
        border: "1px solid var(--border)",
        backgroundColor: "var(--card)",
        color: "var(--card-foreground)",
        boxShadow: "var(--shadow-card)",
      })}
    >
      <header
        className={css({
          display: "flex",
          alignItems: "flex-start",
          gap: "0.75rem",
          borderBottom: "1px solid var(--border)",
          paddingInline: "1rem",
          paddingBlock: "0.75rem",
        })}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={cx(
            iconButtonClass,
            css({ marginTop: "0.125rem", width: "1.5rem", height: "1.5rem", flexShrink: 0 }),
          )}
          aria-label={expanded ? "Collapse artifact" : "Expand artifact"}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <div className={css({ minWidth: 0, flex: 1 })}>
          <div
            className={css({
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              fontSize: "0.75rem",
              fontWeight: 500,
              color: "var(--muted-foreground)",
            })}
          >
            <span
              className={css({
                display: "inline-flex",
                alignItems: "center",
                gap: "0.25rem",
                borderRadius: "0.375rem",
                border: "1px solid var(--border)",
                backgroundColor: "color-mix(in srgb, var(--muted) 40%, transparent)",
                paddingInline: "0.5rem",
                paddingBlock: "0.125rem",
              })}
            >
              {meta.icon}
              {meta.label}
            </span>
            {subline && (
              <span className={css({ color: "var(--muted-foreground)" })}>
                · {subline}
              </span>
            )}
          </div>
          <h3
            className={css({
              marginTop: "0.125rem",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: "0.875rem",
              fontWeight: 600,
            })}
          >
            {heading}
          </h3>
        </div>
        <div
          className={css({
            display: "flex",
            flexShrink: 0,
            alignItems: "center",
            gap: "0.25rem",
          })}
        >
          <button
            type="button"
            onClick={onOpenInBrowser}
            className={cx(
              iconButtonClass,
              css({
                height: "1.75rem",
                border: "1px solid var(--border)",
                paddingInline: "0.5rem",
                fontSize: "0.75rem",
              }),
            )}
            title="Open in artifact browser"
          >
            Open
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className={cx(iconButtonClass, css({ width: "1.75rem", height: "1.75rem" }))}
            aria-label="Dismiss artifact"
            title="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      </header>
      {expanded && (
        <div className={css({ paddingInline: "1rem", paddingBlock: "0.75rem", fontSize: "0.875rem" })}>
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
        <div className={css({ display: "grid", gap: "0.75rem" })}>
          <div
            className={css({
              borderRadius: "0.375rem",
              border: "1px solid var(--border)",
              backgroundColor: "color-mix(in srgb, var(--muted) 20%, transparent)",
              padding: "0.75rem",
              fontSize: "0.75rem",
              color: "var(--muted-foreground)",
            })}
          >
            {artifact.data.scene ? "Scene ready" : "Storyboard only"} ·{" "}
            {artifact.data.manifest ? "manifest attached" : "no manifest"}
          </div>
          <InlineMarkdownWithDiagrams content={artifact.data.storyboard} />
        </div>
      );
    case "deck":
      return (
        <div className={css({ display: "grid", gap: "0.5rem" })}>
          <p className={css({ fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
            {artifact.data.cards.length} cards · open in the browser for spaced
            repetition review.
          </p>
          <ul className={css({ display: "grid", gap: "0.25rem", fontSize: "0.875rem" })}>
            {artifact.data.cards.slice(0, 5).map((c) => (
              <li
                key={c.id}
                className={css({
                  borderRadius: "0.375rem",
                  border: "1px solid var(--border)",
                  backgroundColor: "var(--background)",
                  paddingInline: "0.75rem",
                  paddingBlock: "0.5rem",
                })}
              >
                <div
                  className={css({
                    fontSize: "0.75rem",
                    textTransform: "uppercase",
                    color: "var(--muted-foreground)",
                  })}
                >
                  {c.front}
                </div>
                <div className={css({ fontSize: "0.875rem" })}>{c.back}</div>
              </li>
            ))}
            {artifact.data.cards.length > 5 && (
              <li className={css({ fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
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
        <div className={css({ display: "grid", gap: "0.5rem" })}>
          <p className={css({ fontSize: "0.875rem" })}>{artifact.data.hypothesis}</p>
          <div
            className={css({
              borderRadius: "0.375rem",
              border: "1px solid var(--border)",
              backgroundColor: "var(--background)",
              padding: "0.75rem",
              fontSize: "0.75rem",
            })}
          >
            <div className={css({ fontWeight: 500 })}>Targets</div>
            <div className={css({ marginTop: "0.25rem", color: "var(--muted-foreground)" })}>
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
      className={css({
        borderTop: "1px solid var(--border)",
        backgroundColor: "color-mix(in srgb, var(--muted) 20%, transparent)",
        paddingInline: "0.75rem",
        paddingBlock: "0.75rem",
        sm: { paddingInline: "1rem" },
      })}
    >
      <div
        className={css({
          marginInline: "auto",
          display: "flex",
          maxWidth: "56rem",
          flexDirection: "column",
          gap: "0.75rem",
        })}
      >
        <div
          className={css({
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: "0.75rem",
            color: "var(--muted-foreground)",
          })}
        >
          <span className={css({ fontWeight: 500 })}>
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
    activeSessionId,
    responseComparison,
    chooseResponse,
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
    "idle" | "confirm" | "sharing" | "copied" | "error"
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
  const toggleArtifactBrowser = (source: "toolbar" | "mobile_menu") => {
    setArtifactBrowserOpen((open) => {
      const next = !open;
      if (!next) setArtifactTarget(undefined);
      posthog.capture(next ? 'artifact_browser_opened' : 'artifact_browser_closed', { source });
      return next;
    });
  };

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
        if (uiSettings.limitInlineArtifactPreviews) return [next];
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
  }, [uiSettings.autoOpenArtifacts, uiSettings.limitInlineArtifactPreviews]);

  const performShare = async () => {
    setShareState("sharing");
    setShareMessage(null);
    setShareUrl(null);
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
      posthog.capture('session_shared', { share_mode: result.mode, fallback: result.fallback, session_id: activeSessionId });
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

  // Gate the first public share behind a one-time confirmation. `portable-short`
  // and `compressed-hash` both make the transcript readable by anyone with the
  // link, so warn once, remember the acknowledgement in settings, and never nag
  // again. `local-short` stays on-device, so it shares immediately.
  const handleShare = async () => {
    const settings = loadKeatingUiSettings();
    const exposesPublicly = shareModeExposesDataPublicly(settings.shareLinkMode);
    if (exposesPublicly && !settings.shareWarningAcknowledged) {
      setShareUrl(null);
      setShareMessage(
        "Heads up: this share link makes the whole session readable by anyone who has it. Share again to confirm — you won't be asked next time.",
      );
      setShareState("confirm");
      return;
    }
    await performShare();
  };

  // Second click after the warning: remember the acknowledgement so the prompt
  // never shows again, then create the link.
  const confirmShare = async () => {
    const settings = loadKeatingUiSettings();
    if (!settings.shareWarningAcknowledged) {
      saveKeatingUiSettings({ ...settings, shareWarningAcknowledged: true });
    }
    await performShare();
  };

  // NOTE: responsive Tailwind display variants (e.g. `hidden md:inline-flex`) are
  // NOT reliable here because pi-web-ui ships its own compiled utilities. We
  // drive show/hide from Panda globalCss via `.chat-only-desktop` (header icons,
  // md+) and `.chat-only-compact` (overflow-menu duplicates, < md).
  const actionButtonClass = cx("chat-action-button", actionButtonPandaClass);
  const showPersistenceBanner = persistentStorageStatus === "declined" && !persistentBannerDismissed;

  return (
    <div
      className={cx(
        "chat-page-shell",
        forkingSessionId ? "session-forking" : "",
        css({
          display: "flex",
          width: "100%",
          flexDirection: "column",
          overflow: "hidden",
          backgroundColor: "var(--background)",
          color: "var(--foreground)",
        }),
      )}
    >
      {/* Header */}
      <nav
        className={cx(
          "chat-header",
          css({
            position: "relative",
            display: "flex",
            height: "3.5rem",
            flexShrink: 0,
            alignItems: "center",
            gap: "0.5rem",
            borderBottom: "1px solid var(--border)",
            paddingInline: "0.5rem",
            paddingBlock: "0.5rem",
            sm: { paddingInline: "1rem" },
          }),
        )}
        aria-label="Chat navigation"
      >
        <button
          type="button"
          className={cx(actionButtonClass, css({ display: "inline-flex", lg: { display: "none" } }))}
          title={mobileSidebarOpen ? "Close sessions panel" : "Open sessions panel"}
          aria-label={mobileSidebarOpen ? "Close sessions panel" : "Open sessions panel"}
          aria-pressed={mobileSidebarOpen}
          onClick={toggleMobileSidebar}
        >
          {mobileSidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
        <Link
          to="/"
          className={cx(
            "chat-brand",
            css({
              display: "inline-flex",
              minWidth: 0,
              flexShrink: 0,
              alignItems: "center",
              gap: "0.5rem",
              borderRadius: "0.375rem",
              paddingInline: "0.5rem",
              paddingBlock: "0.25rem",
            }),
          )}
          aria-label="Go to Keating home"
        >
          <img
            src="/brand/logo-lockup.png"
            alt="Keating"
            className={css({ height: "1.5rem", width: "auto", objectFit: "contain" })}
          />
        </Link>
        <span className="chat-mode-badge chat-only-desktop">MODE: SOCRATIC</span>

        {/* Actions */}
        <div
          className={cx(
            "chat-actions",
            css({
              marginLeft: "auto",
              display: "flex",
              minWidth: 0,
              alignItems: "center",
              justifyContent: "flex-end",
              gap: "0.25rem",
              overflow: "hidden",
              sm: { flex: 1 },
            }),
          )}
        >
          <button
            className={cx(actionButtonClass, "chat-only-desktop")}
            title="New session"
            aria-label="New session"
            disabled={isPending}
            onClick={newSession}
          >
            <Plus size={16} />
          </button>
          <button
            className={cx(actionButtonClass, css({ display: "inline-flex" }))}
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
            className={cx(
              actionButtonClass,
              "chat-only-desktop",
              shareState === "copied" ? css({ color: "var(--primary)" }) : "",
              shareState === "error" ? css({ color: "var(--destructive)" }) : "",
            )}
            title={
              shareState === "copied"
                ? "Copied share link"
                : shareState === "error"
                  ? "Could not share yet"
                  : shareState === "confirm"
                    ? "Confirm public share"
                    : "Share session"
            }
            aria-label="Share session"
            disabled={isPending || shareState === "sharing"}
            onClick={shareState === "confirm" ? confirmShare : handleShare}
          >
            <Share2 size={16} />
          </button>
          <button
            className={cx(
              actionButtonClass,
              "chat-only-desktop",
              speechEnabled ? css({ color: "var(--primary)" }) : "",
            )}
            title={speechEnabled ? "Disable speech" : "Enable speech"}
            aria-pressed={speechEnabled}
            onClick={() => {
              posthog.capture('speech_toggled', { enabled: !speechEnabled });
              toggleSpeech();
            }}
          >
            {speechEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
          <button
            className={cx(
              actionButtonClass,
              "chat-only-desktop",
              artifactBrowserOpen ? css({ color: "var(--primary)" }) : "",
            )}
            title={artifactBrowserOpen ? "Close artifacts" : "Open artifacts"}
            aria-label={artifactBrowserOpen ? "Close artifacts" : "Open artifacts"}
            aria-pressed={artifactBrowserOpen}
            onClick={() => toggleArtifactBrowser("toolbar")}
          >
            <LibraryBig size={16} />
          </button>
          {import.meta.env.DEV && (
            <button
              className={cx(actionButtonClass, "chat-only-desktop")}
              title="NodePod runtime"
              aria-label="NodePod runtime"
              onClick={() => setNodePodOpen(true)}
            >
              <Cpu size={16} />
            </button>
          )}
          <button
            className={cx(actionButtonClass, "chat-only-desktop")}
            title="Learning usage"
            aria-label="Learning usage"
            onClick={() => navigate({ to: "/usage" })}
          >
            <BarChart3 size={16} />
          </button>
          <a
            className={cx(actionButtonClass, "chat-only-desktop")}
            title="Report an issue"
            aria-label="Report an issue on GitHub"
            href={GITHUB_ISSUE_URL}
            target="_blank"
            rel="noreferrer"
          >
            <Bug size={16} />
          </a>
          <button
            className={cx(actionButtonClass, css({ display: "inline-flex" }))}
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
            className={cx(
              "font-terminal",
              css({
                position: "absolute",
                right: "0.5rem",
                top: "100%",
                zIndex: 50,
                marginTop: "0.25rem",
                width: "14rem",
                borderRadius: "0.375rem",
                border: "1px solid var(--border)",
                backgroundColor: "var(--background)",
                boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
                fontSize: "0.875rem",
              }),
            )}
          >
            <div className={css({ display: "flex", flexDirection: "column", padding: "0.25rem" })}>
              <button
                className={cx(menuItemClass, "chat-only-compact")}
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
                className={cx(
                  menuItemClass,
                  "chat-only-compact",
                  shareState === "copied" ? css({ color: "var(--primary)" }) : "",
                  shareState === "error" ? css({ color: "var(--destructive)" }) : "",
                )}
              onClick={() => {
                setMobileMenuOpen(false);
                if (shareState === "confirm") confirmShare();
                else handleShare();
              }}
              disabled={isPending || shareState === "sharing"}
            >
              <Share2 size={14} />
              {shareState === "copied"
                ? "Link copied"
                : shareState === "confirm"
                  ? "Confirm public share"
                  : "Share session"}
            </button>
              <button
                className={cx(
                  menuItemClass,
                  "chat-only-compact",
                  speechEnabled ? css({ color: "var(--primary)" }) : "",
                )}
                onClick={() => {
                  setMobileMenuOpen(false);
                  posthog.capture('speech_toggled', { enabled: !speechEnabled });
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
                className={cx(menuItemClass, "chat-only-compact")}
                onClick={() => {
                  setMobileMenuOpen(false);
                  toggleArtifactBrowser("mobile_menu");
                }}
              >
                <LibraryBig size={14} />
                {artifactBrowserOpen ? "Close artifacts" : "Open artifacts"}
              </button>
              {import.meta.env.DEV && (
                <button
                  className={cx(menuItemClass, "chat-only-compact")}
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
                className={cx(menuItemClass, "chat-only-compact")}
                onClick={() => {
                  setMobileMenuOpen(false);
                  navigate({ to: "/usage" });
                }}
              >
                <BarChart3 size={14} />
                Learning usage
              </button>
              <div
                className={cx(
                  "chat-only-compact",
                  css({ marginBlock: "0.25rem", borderTop: "1px solid var(--border)" }),
                )}
              />
              <Link
                to="/"
                className={menuItemClass}
                onClick={() => setMobileMenuOpen(false)}
              >
                Home
              </Link>
              <Link
                to="/tutorial"
                className={menuItemClass}
                onClick={() => setMobileMenuOpen(false)}
              >
                Tutorial
              </Link>
              <Link
                to="/blog"
                className={menuItemClass}
                onClick={() => setMobileMenuOpen(false)}
              >
                Blog
              </Link>
              <Link
                to="/paper"
                className={menuItemClass}
                onClick={() => setMobileMenuOpen(false)}
              >
                Paper
              </Link>
              <a
                href="https://github.com/Diogenesoftoronto/keating"
                target="_blank"
                rel="noreferrer"
                className={menuItemClass}
                onClick={() => setMobileMenuOpen(false)}
              >
                GitHub
              </a>
              <a
                href={GITHUB_ISSUE_URL}
                target="_blank"
                rel="noreferrer"
                className={cx(menuItemClass, "chat-only-compact")}
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
        <div
          className={css({
            flexShrink: 0,
            borderBottom: "1px solid var(--border)",
            backgroundColor: "rgb(245 158 11 / 0.1)",
            paddingInline: "0.75rem",
            paddingBlock: "0.5rem",
          })}
        >
          <div
            className={css({
              marginInline: "auto",
              display: "flex",
              maxWidth: "48rem",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.75rem",
            })}
          >
            <div
              className={css({
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                fontSize: "0.75rem",
                fontWeight: 500,
                color: "rgb(146 64 14)",
                _dark: { color: "rgb(253 230 138)" },
              })}
            >
              <span className={css({ display: "none", sm: { display: "inline" } })}>Browser storage persistence is not enabled. Sessions still save locally, but the browser may clear them under storage pressure.</span>
              <span className={css({ sm: { display: "none" } })}>Storage persistence is not enabled.</span>
            </div>
            <div className={css({ display: "flex", flexShrink: 0, alignItems: "center", gap: "0.5rem" })}>
              <button
                type="button"
                className={css({
                  display: "inline-flex",
                  height: "1.5rem",
                  alignItems: "center",
                  borderRadius: "0.25rem",
                  backgroundColor: "var(--primary)",
                  paddingInline: "0.5rem",
                  fontSize: "10px",
                  fontWeight: 500,
                  color: "var(--primary-foreground)",
                  _hover: { backgroundColor: "color-mix(in srgb, var(--primary) 90%, transparent)" },
                })}
                onClick={retryPersistentStorage}
              >
                Try again
              </button>
              <button
                type="button"
                className={cx(iconButtonClass, css({ width: "1.5rem", height: "1.5rem" }))}
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
        <div className={css({ display: "flex", minHeight: 0, flex: 1, overflow: "hidden" })}>
          {sessionSidebar}
          <AssistantChatPanel
            ref={chatPanelRef}
            className={cx("chat-page-panel", css({ minWidth: 0, flex: 1 }))}
            speechEnabled={speechEnabled}
            responseComparison={responseComparison ? (
              <ResponseComparisonPanel
                comparison={responseComparison}
                onChoose={chooseResponse}
              />
            ) : null}
          />
          {isWideViewport && artifactBrowserOpen && (
            <div
              className={css({
                height: "100%",
                flexShrink: 0,
                borderLeft: "1px solid var(--border)",
              })}
            >
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
        <div className={css({ position: "relative", flex: 1, overflow: "hidden" })}>
          <ChatIntro />
          <button
            onClick={dismissIntro}
            className={cx(
              "font-terminal",
              css({
                position: "absolute",
                bottom: "1.5rem",
                left: "50%",
                zIndex: 20,
                transform: "translateX(-50%)",
                border: "2px solid var(--primary)",
                paddingInline: "1.5rem",
                paddingBlock: "0.625rem",
                fontSize: "0.875rem",
                color: "var(--primary)",
                transitionProperty: "color, background-color, border-color",
                transitionDuration: "150ms",
                _hover: {
                  backgroundColor: "var(--primary)",
                  color: "var(--primary-foreground)",
                },
              }),
            )}
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
        <div
          className={css({
            borderTop: "1px solid var(--border)",
            backgroundColor: "var(--background)",
            paddingInline: "1rem",
            paddingBlock: "0.75rem",
            fontSize: "0.875rem",
          })}
        >
          <div
            className={css({
              marginInline: "auto",
              display: "flex",
              maxWidth: "56rem",
              flexDirection: "column",
              gap: "0.5rem",
              sm: { flexDirection: "row", alignItems: "center" },
            })}
          >
            <span
              className={
                shareState === "error"
                  ? css({ color: "var(--destructive)" })
                  : css({ color: "var(--muted-foreground)" })
              }
            >
              {shareMessage}
            </span>
            {shareUrl && (
              <input
                className={css({
                  minWidth: 0,
                  flex: 1,
                  borderRadius: "0.375rem",
                  border: "1px solid var(--border)",
                  backgroundColor: "var(--muted)",
                  paddingInline: "0.75rem",
                  paddingBlock: "0.5rem",
                  fontFamily: "var(--mono-body)",
                  fontSize: "0.75rem",
                  color: "var(--foreground)",
                })}
                readOnly
                value={shareUrl}
                onFocus={(event) => event.currentTarget.select()}
              />
            )}
            {shareState === "confirm" && (
              <button
                className={css({
                  display: "inline-flex",
                  height: "2rem",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "0.375rem",
                  border: "1px solid var(--border)",
                  backgroundColor: "var(--primary)",
                  paddingInline: "0.75rem",
                  fontSize: "0.75rem",
                  color: "var(--primary-foreground)",
                  _hover: { backgroundColor: "color-mix(in srgb, var(--primary) 90%, transparent)" },
                })}
                onClick={confirmShare}
              >
                Share publicly
              </button>
            )}
            <button
              className={css({
                display: "inline-flex",
                height: "2rem",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "0.375rem",
                border: "1px solid var(--border)",
                paddingInline: "0.75rem",
                fontSize: "0.75rem",
                _hover: { backgroundColor: "var(--accent)" },
              })}
              onClick={() => {
                setShareState("idle");
                setShareUrl(null);
                setShareMessage(null);
              }}
            >
              {shareState === "confirm" ? "Cancel" : "Dismiss"}
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
        <div
          className={cx(
            "chat-page-shell",
            css({
              display: "flex",
              width: "100%",
              flexDirection: "column",
              overflow: "hidden",
              backgroundColor: "var(--background)",
              color: "var(--foreground)",
            }),
          )}
        >
          <div
            className={css({
              display: "flex",
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.875rem",
              color: "var(--muted-foreground)",
            })}
          >
            Initializing…
          </div>
        </div>
      }
    >
      <ChatContent />
    </Suspense>
  );
}

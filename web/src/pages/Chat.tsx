import { APP_ORIGIN } from "../lib/hosted-navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { usePostHog } from "@posthog/react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  LibraryBig,
  Map as MapIcon,
  Play,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import { useSearch } from "@tanstack/react-router";
import { css, cx } from "../../styled-system/css";
import { useKeatingAgent } from "../hooks/useKeatingAgent";
import { ChatHeader } from "./chat/ChatHeader";
import { useSessionSharing } from "./chat/useSessionSharing";
import { useChatActivationTracking } from "./chat/useChatActivationTracking";
import {
  CourseContextBanner,
  PersistentStorageBanner,
  ShareStatusBanner,
} from "./chat/ChatBanners";
import { JudgementDiagnostics } from "../components/JudgementDiagnostics";
import { getInitPromise, keatingStorage, sessions } from "../hooks/keating-storage";
import { ChatOnboarding, hasCompletedChatOnboarding } from "../components/ChatOnboarding";
import { TourSpotlight } from "../components/tour/TourSpotlight";
import { hasSeenInterfaceTour, subscribeInterfaceTourRequests } from "../keating/interface-tour";
import { hasNotOrganicProductSession, promptNotOrganicAccess } from "../components/NotOrganicAccessPromptDialog";
import { notOrganicCheckoutReturn } from "../notorganic-provider/checkout-return";
import { beginNotOrganicAuthorization } from "../notorganic-provider";
import { useSeo } from "../hooks/useSeo";
import { useMediaQuery } from "../hooks/use-media-query";
import { isCanvasFeatureEnabled } from "../lib/feature-flags";
import { ArtifactBrowserOverlay } from "../components/ArtifactBrowserOverlay";
import { ArtifactSidePanel } from "../components/ArtifactSidePanel";
import { AssistantChatPanel } from "../components/AssistantChatPanel";
import { ResponseComparisonPanel } from "../components/ResponseComparisonPanel";
import { ForkBanner } from "../components/ForkBanner";
import { MermaidRenderer } from "../components/MermaidRenderer";
import { MarkdownBlock } from "../components/MarkdownBlock";
import { SandboxView } from "../components/SandboxView";
import {
  loadKeatingUiSettings,
  subscribeKeatingUiSettings,
  type KeatingUiSettings,
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
import {
  courseChatContext,
  courseCollaborationStarterPrompts,
} from "../keating/course-collaboration";

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
  | {
      id: string;
      type: "prompt-evolution";
      createdAt: number;
      data: PromptEvolutionResult;
    }
  | {
      id: string;
      type: "improvement";
      createdAt: number;
      data: ImprovementAttemptRecord;
    };

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

function splitMermaidBlocks(
  content: string,
): Array<{ type: "markdown" | "mermaid"; content: string }> {
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
        return `${artifact.data.checklist.match(/- \[ \]/g)?.length ?? 0} checks`;
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
            css({
              marginTop: "0.125rem",
              width: "1.5rem",
              height: "1.5rem",
              flexShrink: 0,
            }),
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
                backgroundColor:
                  "color-mix(in srgb, var(--muted) 40%, transparent)",
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
            className={cx(
              iconButtonClass,
              css({ width: "1.75rem", height: "1.75rem" }),
            )}
            aria-label="Dismiss artifact"
            title="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      </header>
      {expanded && (
        <div
          className={css({
            paddingInline: "1rem",
            paddingBlock: "0.75rem",
            fontSize: "0.875rem",
          })}
        >
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
              backgroundColor:
                "color-mix(in srgb, var(--muted) 20%, transparent)",
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
          <p
            className={css({
              fontSize: "0.75rem",
              color: "var(--muted-foreground)",
            })}
          >
            {artifact.data.cards.length} cards · open in the browser for spaced
            repetition review.
          </p>
          <ul
            className={css({
              display: "grid",
              gap: "0.25rem",
              fontSize: "0.875rem",
            })}
          >
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
              <li
                className={css({
                  fontSize: "0.75rem",
                  color: "var(--muted-foreground)",
                })}
              >
                +{artifact.data.cards.length - 5} more…
              </li>
            )}
          </ul>
        </div>
      );
    case "verification":
      return <InlineMarkdownWithDiagrams content={artifact.data.checklist} />;
    case "benchmark":
      return <InlineMarkdownWithDiagrams content={artifact.data.report} />;
    case "evolution":
      return <InlineMarkdownWithDiagrams content={artifact.data.report} />;
    case "prompt-evolution":
      return <InlineMarkdownWithDiagrams content={artifact.data.report} />;
    case "improvement":
      return (
        <div className={css({ display: "grid", gap: "0.5rem" })}>
          <p className={css({ fontSize: "0.875rem" })}>
            {artifact.data.hypothesis}
          </p>
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
            <div
              className={css({
                marginTop: "0.25rem",
                color: "var(--muted-foreground)",
              })}
            >
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

/**
 * Artifact browser and inline artifact previews for the active session. Both
 * reset when the session changes, and stay closed when the canvas is off.
 */
function useChatArtifacts({
  canvasEnabled,
  activeSessionId,
  uiSettings,
}: {
  canvasEnabled: boolean;
  activeSessionId: string;
  uiSettings: Pick<KeatingUiSettings, "autoOpenArtifacts" | "limitInlineArtifactPreviews">;
}) {
  const posthog = usePostHog();
  const [artifactBrowserOpen, setArtifactBrowserOpen] = useState(false);
  const [artifactTarget, setArtifactTarget] = useState<string | undefined>(
    undefined,
  );
  const [inlineArtifacts, setInlineArtifacts] = useState<InlineArtifact[]>([]);

  useEffect(() => {
    // Artifact previews are transient branch state. Never carry a parent's
    // canvas selection into a fork or a sibling session.
    setArtifactBrowserOpen(false);
    setArtifactTarget(undefined);
    setInlineArtifacts([]);
  }, [activeSessionId]);

  const toggleArtifactBrowser = (source: "toolbar" | "mobile_menu") => {
    if (!canvasEnabled) return;
    setArtifactBrowserOpen((open) => {
      const next = !open;
      if (!next) setArtifactTarget(undefined);
      posthog.capture(
        next ? "artifact_browser_opened" : "artifact_browser_closed",
        { source, canvas_enabled: true },
      );
      return next;
    });
  };

  useEffect(() => {
    if (!canvasEnabled) {
      setArtifactBrowserOpen(false);
      setArtifactTarget(undefined);
      setInlineArtifacts([]);
      return;
    }
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
        if (prev.some((a) => a.id === next.id && a.type === next.type))
          return prev;
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
      window.removeEventListener(
        "keating:artifact-created",
        captureInlineArtifact,
      );
      window.removeEventListener("keating:open-artifact", openArtifactTarget);
    };
  }, [canvasEnabled, uiSettings.autoOpenArtifacts, uiSettings.limitInlineArtifactPreviews]);

  return {
    artifactBrowserOpen,
    setArtifactBrowserOpen,
    artifactTarget,
    setArtifactTarget,
    inlineArtifacts,
    setInlineArtifacts,
    toggleArtifactBrowser,
  };
}

function ChatContent() {
  const canvasEnabled = isCanvasFeatureEnabled();
  useSeo({
    title: "Keating Chat — Socratic AI Tutor Session",
    description:
      "Start a Socratic tutoring session with Keating. Diagnose what you know, reconstruct understanding from memory, and test transfer to new contexts.",
    canonical: `${APP_ORIGIN}/`,
  });
  const search = useSearch({ strict: false }) as {
    course?: string;
    courseMode?: "create" | "edit";
    ask?: string;
  };
  const [onboardingGoal, setOnboardingGoal] = useState<string>();
  const pendingPrompt = search.ask?.trim() || onboardingGoal;
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const checkoutReturnHandled = useRef(false);
  useEffect(() => {
    if (checkoutReturnHandled.current) return;
    const returned = notOrganicCheckoutReturn(window.location.href);
    if (!returned) return;
    checkoutReturnHandled.current = true;
    void promptNotOrganicAccess({ force: true, allowSignIn: true, checkoutReturned: true }).finally(() => {
      const current = notOrganicCheckoutReturn(window.location.href);
      if (current) window.history.replaceState(window.history.state, "", current.cleanHref);
    });
  }, []);
  // Replaying the tour from Settings arrives as a request, because Settings has
  // to close before there is anything to point at.
  useEffect(() => subscribeInterfaceTourRequests(() => setShowTour(true)), []);
  useEffect(() => {
    if (hasCompletedChatOnboarding() || search.ask || search.course) return;
    let cancelled = false;
    void getInitPromise().then(() => sessions.getAllMetadata()).then(metadata => {
      if (!cancelled && !hasCompletedChatOnboarding() && metadata.length === 0) setShowOnboarding(true);
    }).catch(() => { /* Storage problems must not prevent reaching chat. */ });
    return () => { cancelled = true; };
  }, [search.ask, search.course]);
  const courseContext = useMemo(
    () => courseChatContext(search),
    [search.course, search.courseMode],
  );
  const coursePrompts = useMemo(
    () =>
      courseContext
        ? courseCollaborationStarterPrompts(courseContext)
        : undefined,
    [courseContext],
  );
  const {
    isPending,
    openSettings,
    modelLabel,
    openModelSelector,
    chooseKeatingModel,
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
    teachingAdjustment,
    responseComparison,
    chooseResponse,
  } = useKeatingAgent({ courseContext });
  const isWideViewport = useMediaQuery("(min-width: 1024px)");
  const [uiSettings, setUiSettings] = useState(() => loadKeatingUiSettings());
  const {
    shareState,
    shareUrl,
    shareMessage,
    handleShare,
    confirmShare,
    dismissShare,
  } = useSessionSharing({ activeSessionId, shareSession });
  const [nodePodOpen, setNodePodOpen] = useState(false);

  useChatActivationTracking(activeSessionId);

  useEffect(() => subscribeKeatingUiSettings(setUiSettings), []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.add("chat-shell-active");
    return () => document.body.classList.remove("chat-shell-active");
  }, []);

  const {
    artifactBrowserOpen,
    setArtifactBrowserOpen,
    artifactTarget,
    setArtifactTarget,
    inlineArtifacts,
    setInlineArtifacts,
    toggleArtifactBrowser,
  } = useChatArtifacts({ canvasEnabled, activeSessionId, uiSettings });

  const showPersistenceBanner =
    persistentStorageStatus === "declined" && !persistentBannerDismissed;

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
      <ChatHeader
        isPending={isPending}
        modelLabel={modelLabel}
        activeSessionId={activeSessionId}
        mobileSidebarOpen={mobileSidebarOpen}
        speechEnabled={speechEnabled}
        canvasEnabled={canvasEnabled}
        artifactBrowserOpen={artifactBrowserOpen}
        shareState={shareState}
        toggleMobileSidebar={toggleMobileSidebar}
        openModelSelector={openModelSelector}
        openSettings={openSettings}
        toggleArtifactBrowser={toggleArtifactBrowser}
        newSession={newSession}
        handleShare={handleShare}
        confirmShare={confirmShare}
        toggleSpeech={toggleSpeech}
        onOpenNodePod={() => setNodePodOpen(true)}
      />

      {courseContext && (
        <CourseContextBanner courseContext={courseContext} />
      )}

      {forkInfo && (
        <ForkBanner
          parentTitle={forkInfo.parentTitle}
          onOpenOriginal={openOriginalSession}
        />
      )}

      {showPersistenceBanner && (
        <PersistentStorageBanner
          onRetry={retryPersistentStorage}
          onDismiss={dismissPersistentBanner}
        />
      )}

      <JudgementDiagnostics sessionId={activeSessionId} teachingAdjustment={teachingAdjustment} />
      {showOnboarding && <div className={css({ flex: 1, minHeight: 0, overflowY: "auto", paddingInline: "1rem" })}>
        <ChatOnboarding
          onUseKeating={chooseKeatingModel}
          onConnectAccount={() => beginNotOrganicAuthorization()}
          isSignedIn={hasNotOrganicProductSession}
          onChooseModel={openModelSelector}
          onSkip={() => setShowOnboarding(false)}
          onComplete={goal => { setOnboardingGoal(goal); setShowOnboarding(false); }}
          {...(hasSeenInterfaceTour() ? {} : { onStartTour: () => setShowTour(true) })}
        />
      </div>}
      <div
        className={css({
          display: "flex",
          minHeight: 0,
          flex: 1,
          overflow: "hidden",
        })}
        style={showOnboarding ? { display: "none" } : undefined}
      >
        {sessionSidebar}
        <AssistantChatPanel
          ref={chatPanelRef}
          className={cx("chat-page-panel", css({ minWidth: 0, flex: 1 }))}
          speechEnabled={speechEnabled}
          initialPrompts={coursePrompts}
          {...(pendingPrompt ? { pendingPrompt } : {})}
          emptyStateTitle={
            courseContext?.mode === "create"
              ? "What course should we build together?"
              : courseContext
                ? "What should we change in this course?"
                : undefined
          }
          emptyStateDescription={
            courseContext
              ? "Choose a starting point or describe the learners and the change you have in mind. Keating will inspect, propose, and wait for your direction before writing."
              : undefined
          }
          responseComparison={
            responseComparison ? (
              <ResponseComparisonPanel
                comparison={responseComparison}
                onChoose={chooseResponse}
              />
            ) : null
          }
        />
        {canvasEnabled && isWideViewport && artifactBrowserOpen && (
          <div
            className={cx("artifact-side-panel", css({
              height: "100%",
              flexShrink: 0,
              borderLeft: "1px solid var(--border)",
            }))}
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

      {/* Rendered only once the chat is actually on screen, so the tour has real
          elements to point at rather than the hidden panel behind onboarding. */}
      {showTour && !showOnboarding && (
        <TourSpotlight
          onFinish={() => setShowTour(false)}
          onSkip={() => setShowTour(false)}
        />
      )}

      {canvasEnabled && inlineArtifacts.length > 0 && (
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
        <ShareStatusBanner
          shareState={shareState}
          shareUrl={shareUrl}
          shareMessage={shareMessage}
          onConfirm={confirmShare}
          onDismiss={dismissShare}
        />
      )}

      <ArtifactBrowserOverlay
        open={canvasEnabled && artifactBrowserOpen && !isWideViewport}
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

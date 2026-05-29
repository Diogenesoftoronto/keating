import { Suspense, useEffect, useRef, useState } from "react";
import {
  BarChart3,
  Bug,
  History,
  LibraryBig,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Share2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useKeatingAgent } from "../hooks/useKeatingAgent";
import { useSeo } from "../hooks/useSeo";
import { ChatIntro } from "../components/ChatIntro";
import { ArtifactBrowserOverlay } from "../components/ArtifactBrowserOverlay";
import { ArtifactSidePanel } from "../components/ArtifactSidePanel";
import { AssistantChatPanel } from "../components/AssistantChatPanel";
import { ThemeToggle } from "../components/ThemeToggle";
import {
  loadKeatingUiSettings,
  subscribeKeatingUiSettings,
} from "../keating/ui-settings";

const GITHUB_ISSUE_URL = "https://github.com/Diogenesoftoronto/keating/issues/new";

function ChatContent() {
  useSeo({
    title: "Keating Chat — Socratic AI Tutor Session",
    description:
      "Start a Socratic tutoring session with Keating. Diagnose what you know, reconstruct understanding from memory, and test transfer to new contexts.",
    canonical: "https://keating.help/chat",
  });
  const navigate = useNavigate();
  const {
    isPending,
    openSettings,
    openSessions,
    newSession,
    shareSession,
    chatPanelRef,
    dialogs,
    sessionSidebar,
    speechEnabled,
    persistentStorageStatus,
    toggleSpeech,
    forkingSessionId,
    mobileSidebarOpen,
    toggleMobileSidebar,
    closeMobileSidebar,
  } = useKeatingAgent();
  const [introDismissed, setIntroDismissed] = useState(
    () => sessionStorage.getItem("keating_chat_intro") === "dismissed",
  );
  const [artifactBrowserOpen, setArtifactBrowserOpen] = useState(false);
  const [isWideViewport, setIsWideViewport] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 1024px)").matches,
  );
  const [uiSettings, setUiSettings] = useState(() => loadKeatingUiSettings());
  const [shareState, setShareState] = useState<
    "idle" | "sharing" | "copied" | "error"
  >("idle");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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
    sessionStorage.setItem("keating_chat_intro", "dismissed");
  };

  useEffect(() => subscribeKeatingUiSettings(setUiSettings), []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.add("chat-shell-active");
    return () => document.body.classList.remove("chat-shell-active");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const handler = (e: MediaQueryListEvent) => setIsWideViewport(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const [artifactTarget, setArtifactTarget] = useState<string | undefined>(
    undefined,
  );

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
    window.addEventListener("keating:artifact-created", openArtifacts);
    window.addEventListener("keating:open-artifact", openArtifactTarget);
    return () => {
      window.removeEventListener("keating:artifact-created", openArtifacts);
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

  const actionButtonClass =
    "chat-action-button inline-flex shrink-0 items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50";
  const showPersistenceBanner = persistentStorageStatus === "declined";

  return (
    <div className={`chat-page-shell w-full flex flex-col bg-background text-foreground overflow-hidden ${forkingSessionId ? "session-forking" : ""}`}>
      {/* Header */}
      <nav
        className="chat-header flex items-center gap-2 border-b border-border shrink-0 px-2 sm:px-4 py-2 h-14 relative"
        aria-label="Chat navigation"
      >
        <button
          type="button"
          className={`${actionButtonClass} md:hidden`}
          title={mobileSidebarOpen ? "Close sessions panel" : "Open sessions panel"}
          aria-label={mobileSidebarOpen ? "Close sessions panel" : "Open sessions panel"}
          aria-pressed={mobileSidebarOpen}
          onClick={toggleMobileSidebar}
        >
          {mobileSidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
        <Link
          to="/"
          className="chat-brand inline-flex min-w-0 shrink-0 items-center gap-2 rounded-md px-2 py-1 hover:bg-accent hover:text-accent-foreground"
          aria-label="Go to Keating home"
        >
          <img
            src="/logo.png"
            alt="Keating"
            className="h-7 w-7 rounded object-contain"
          />
          <span className="hidden md:block truncate text-base font-semibold">
            Keating
          </span>
        </Link>

        {/* Actions */}
        <div className="chat-actions ml-auto flex min-w-0 flex-1 items-center justify-end gap-1 overflow-hidden">
          <button
            className={actionButtonClass}
            title="New session"
            aria-label="New session"
            disabled={isPending}
            onClick={newSession}
          >
            <Plus size={16} />
          </button>
          <button
            className={`${actionButtonClass} hidden sm:inline-flex`}
            title="Settings"
            aria-label="Settings"
            onClick={openSettings}
          >
            <Settings size={16} />
          </button>
          <ThemeToggle className="hidden sm:inline-flex" />
          <button
            className={`${actionButtonClass} hidden md:inline-flex ${shareState === "copied" ? "text-primary" : ""} ${shareState === "error" ? "text-destructive" : ""}`}
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
            className={`${actionButtonClass} hidden md:inline-flex ${speechEnabled ? "text-primary" : ""}`}
            title={speechEnabled ? "Disable speech" : "Enable speech"}
            aria-pressed={speechEnabled}
            onClick={toggleSpeech}
          >
            {speechEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
          <button
            className={`${actionButtonClass} hidden md:inline-flex`}
            title="Artifacts"
            aria-label="Artifacts"
            onClick={() => setArtifactBrowserOpen(true)}
          >
            <LibraryBig size={16} />
          </button>
          <button
            className={`${actionButtonClass} hidden md:inline-flex`}
            title="Learning usage"
            aria-label="Learning usage"
            onClick={() => navigate({ to: "/usage" })}
          >
            <BarChart3 size={16} />
          </button>
          <a
            className={`${actionButtonClass} hidden md:inline-flex`}
            title="Report an issue"
            aria-label="Report an issue on GitHub"
            href={GITHUB_ISSUE_URL}
            target="_blank"
            rel="noreferrer"
          >
            <Bug size={16} />
          </a>
          <button
            className={actionButtonClass}
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
                className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors sm:hidden"
                onClick={() => {
                  setMobileMenuOpen(false);
                  openSettings();
                }}
              >
                <Settings size={14} />
                Settings
              </button>
              <div className="sm:hidden" />
              <button
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors md:hidden ${shareState === "copied" ? "text-primary" : ""} ${shareState === "error" ? "text-destructive" : ""}`}
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
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors md:hidden ${speechEnabled ? "text-primary" : ""}`}
                onClick={() => {
                  setMobileMenuOpen(false);
                  toggleSpeech();
                }}
              >
                {speechEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
                {speechEnabled ? "Disable speech" : "Enable speech"}
              </button>
              <button
                className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors md:hidden"
                onClick={() => {
                  setMobileMenuOpen(false);
                  setArtifactBrowserOpen(true);
                }}
              >
                <LibraryBig size={14} />
                Artifacts
              </button>
              <button
                className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors md:hidden"
                onClick={() => {
                  setMobileMenuOpen(false);
                  navigate({ to: "/usage" });
                }}
              >
                <BarChart3 size={14} />
                Learning usage
              </button>
              <div className="my-1 border-t border-border md:hidden" />
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
                className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors md:hidden"
                onClick={() => setMobileMenuOpen(false)}
              >
                Report issue
              </a>
            </div>
          </div>
        )}
      </nav>

      {showPersistenceBanner && (
        <div className="chat-persistence-banner shrink-0 border-b border-border">
          <div className="chat-persistence-track px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.25em]">
            <span>Session is not being persisted, all data will not be available outside of cache.</span>
            <span aria-hidden="true">Session is not being persisted, all data will not be available outside of cache.</span>
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

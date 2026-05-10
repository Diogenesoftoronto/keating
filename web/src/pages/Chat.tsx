import { Suspense, useEffect, useRef, useState } from "react";
import { BarChart3, History, LibraryBig, Menu, Plus, Settings, Share2, Volume2, VolumeX, X } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useKeatingAgent } from "../hooks/useKeatingAgent";
import { useSeo } from "../hooks/useSeo";
import { ChatIntro } from "../components/ChatIntro";
import { ArtifactBrowserOverlay } from "../components/ArtifactBrowserOverlay";
import { AssistantChatPanel } from "../components/AssistantChatPanel";
import { ThemeToggle } from "../components/ThemeToggle";
import { loadKeatingUiSettings, subscribeKeatingUiSettings } from "../keating/ui-settings";

function ChatContent() {
  useSeo({
    title: "Keating Chat — Socratic AI Tutor Session",
    description: "Start a Socratic tutoring session with Keating. Diagnose what you know, reconstruct understanding from memory, and test transfer to new contexts.",
    canonical: "https://keating.help/chat",
  });
  const navigate = useNavigate();
  const { title, isPending, openSettings, openSessions, newSession, shareSession, chatPanelRef, dialogs, speechEnabled, toggleSpeech } = useKeatingAgent();
  const [introDismissed, setIntroDismissed] = useState(
    () => sessionStorage.getItem("keating_chat_intro") === "dismissed"
  );
  const [artifactBrowserOpen, setArtifactBrowserOpen] = useState(false);
  const [uiSettings, setUiSettings] = useState(() => loadKeatingUiSettings());
  const [shareState, setShareState] = useState<"idle" | "sharing" | "copied" | "error">("idle");
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
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target as Node)) {
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

  const [artifactTarget, setArtifactTarget] = useState<string | undefined>(undefined);

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
      const url = await shareSession();
      setShareUrl(url);
      setShareMessage("Share link ready. It was copied if your browser allowed clipboard access.");
      setShareState("copied");
      window.setTimeout(() => setShareState("idle"), 1600);
    } catch (error) {
      console.warn("Failed to share session:", error);
      setShareMessage(error instanceof Error ? error.message : "Could not create a share link yet.");
      setShareState("error");
      window.setTimeout(() => setShareState("idle"), 2200);
    }
  };

  const actionButtonClass = "chat-action-button inline-flex shrink-0 items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50";

  return (
    <div className="chat-page-shell w-full flex flex-col bg-background text-foreground overflow-hidden">
      {/* Header */}
      <div className="chat-header flex items-center gap-2 border-b border-border shrink-0 px-2 sm:px-4 py-2 h-14 relative">
        <Link
          to="/"
          className="chat-brand inline-flex min-w-0 shrink-0 items-center gap-2 rounded-md px-2 py-1 hover:bg-accent hover:text-accent-foreground"
          aria-label="Go to Keating home"
        >
          {/* Mobile: just the logo, no text */}
          <img src="/logo.png" alt="Keating" className="h-7 w-7 rounded object-contain sm:hidden" />
          {/* Desktop: show text title */}
          <span className="hidden sm:inline truncate text-base font-semibold sm:text-lg">{title}</span>
        </Link>

        {/* Desktop actions */}
        <div className="chat-actions no-scrollbar ml-auto hidden sm:flex min-w-0 flex-1 items-center justify-end gap-1 overflow-x-auto">
          <ThemeToggle />
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
            className={actionButtonClass}
            title="Session history"
            aria-label="Session history"
            disabled={isPending}
            onClick={openSessions}
          >
            <History size={16} />
          </button>
          <button
            className={`${actionButtonClass} ${shareState === "copied" ? "text-primary" : ""} ${shareState === "error" ? "text-destructive" : ""}`}
            title={shareState === "copied" ? "Copied share link" : shareState === "error" ? "Could not share yet" : "Share session"}
            aria-label="Share session"
            disabled={isPending || shareState === "sharing"}
            onClick={handleShare}
          >
            <Share2 size={16} />
          </button>
          <button
            className={actionButtonClass}
            title="Learning usage"
            aria-label="Learning usage"
            onClick={() => navigate({ to: "/usage" })}
          >
            <BarChart3 size={16} />
          </button>
          <button
            className={`${actionButtonClass} ${speechEnabled ? "text-primary" : ""}`}
            title={speechEnabled ? "Disable speech" : "Enable speech"}
            aria-pressed={speechEnabled}
            onClick={toggleSpeech}
          >
            {speechEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
          <button
            className={actionButtonClass}
            title="Settings"
            aria-label="Settings"
            onClick={openSettings}
          >
            <Settings size={16} />
          </button>
          <button
            className={actionButtonClass}
            title="Artifacts"
            aria-label="Artifacts"
            onClick={() => setArtifactBrowserOpen(true)}
          >
            <LibraryBig size={16} />
          </button>
        </div>

        {/* Mobile actions: reduced set + hamburger */}
        <div className="chat-actions no-scrollbar ml-auto flex sm:hidden min-w-0 flex-1 items-center justify-end gap-1 overflow-x-auto">
          <ThemeToggle />
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
            className={actionButtonClass}
            title="Artifacts"
            aria-label="Artifacts"
            onClick={() => setArtifactBrowserOpen(true)}
          >
            <LibraryBig size={16} />
          </button>
          <button
            className={actionButtonClass}
            title="Menu"
            aria-label="Menu"
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((o) => !o)}
          >
            {mobileMenuOpen ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>

        {/* Mobile dropdown menu */}
        {mobileMenuOpen && (
          <div
            ref={mobileMenuRef}
            className="absolute right-2 top-full z-50 mt-1 w-56 rounded-md border border-border bg-background shadow-lg font-terminal"
            style={{ fontSize: "0.875rem" }}
          >
            <div className="flex flex-col p-1">
              <button
                className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                onClick={() => { setMobileMenuOpen(false); openSessions(); }}
                disabled={isPending}
              >
                <History size={14} />
                Session history
              </button>
              <button
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors ${shareState === "copied" ? "text-primary" : ""} ${shareState === "error" ? "text-destructive" : ""}`}
                onClick={() => { setMobileMenuOpen(false); handleShare(); }}
                disabled={isPending || shareState === "sharing"}
              >
                <Share2 size={14} />
                {shareState === "copied" ? "Link copied" : "Share session"}
              </button>
              <button
                className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                onClick={() => { setMobileMenuOpen(false); navigate({ to: "/usage" }); }}
              >
                <BarChart3 size={14} />
                Learning usage
              </button>
              <button
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors ${speechEnabled ? "text-primary" : ""}`}
                onClick={() => { setMobileMenuOpen(false); toggleSpeech(); }}
              >
                {speechEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
                {speechEnabled ? "Disable speech" : "Enable speech"}
              </button>
              <button
                className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                onClick={() => { setMobileMenuOpen(false); openSettings(); }}
              >
                <Settings size={14} />
                Settings
              </button>
            </div>
          </div>
        )}
      </div>

      {introDismissed ? (
        <AssistantChatPanel
          ref={chatPanelRef}
          className="chat-page-panel"
        />
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
            <span className={shareState === "error" ? "text-destructive" : "text-muted-foreground"}>
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
        open={artifactBrowserOpen}
        artifactId={artifactTarget}
        onClose={() => { setArtifactBrowserOpen(false); setArtifactTarget(undefined); }}
      />
      {dialogs}
    </div>
  );
}

export function Chat() {
  return (
    <Suspense fallback={
      <div className="chat-page-shell w-full flex flex-col bg-background text-foreground overflow-hidden">
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Initializing…
        </div>
      </div>
    }>
      <ChatContent />
    </Suspense>
  );
}

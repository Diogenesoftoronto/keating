import { Suspense, useState } from "react";
import { BarChart3, History, LibraryBig, Plus, Settings, Share2, Volume2, VolumeX } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useKeatingAgent } from "../hooks/useKeatingAgent";
import { ChatIntro } from "../components/ChatIntro";
import { ArtifactBrowserOverlay } from "../components/ArtifactBrowserOverlay";
import { AssistantChatPanel } from "../components/AssistantChatPanel";

// Types for the custom components
import "../lit-components";

// Register model-selector and providers-models-tab web components
import "../components/model-selector";
import "../components/providers-models-tab";
import "../components/settings";
import "@mariozechner/mini-lit/dist/ThemeToggle.js";

function ChatContent() {
  const navigate = useNavigate();
  const { title, isPending, openSettings, openSessions, newSession, shareSession, chatPanelRef, sessionManagerDialog, speechEnabled, toggleSpeech } = useKeatingAgent();
  const [introDismissed, setIntroDismissed] = useState(
    () => sessionStorage.getItem("keating_chat_intro") === "dismissed"
  );
  const [artifactBrowserOpen, setArtifactBrowserOpen] = useState(false);
  const [shareState, setShareState] = useState<"idle" | "sharing" | "copied" | "error">("idle");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareMessage, setShareMessage] = useState<string | null>(null);

  const dismissIntro = () => {
    setIntroDismissed(true);
    sessionStorage.setItem("keating_chat_intro", "dismissed");
  };

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

  return (
    <div className="chat-page-shell w-full flex flex-col bg-background text-foreground overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border shrink-0 px-4 py-2 h-14">
        <span className="text-lg font-semibold">{title}</span>
        <div className="flex items-center gap-1">
          <theme-toggle></theme-toggle>
          <button
            className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground h-8 w-8 disabled:pointer-events-none disabled:opacity-50"
            title="New session"
            aria-label="New session"
            disabled={isPending}
            onClick={newSession}
          >
            <Plus size={16} />
          </button>
          <button
            className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground h-8 w-8 disabled:pointer-events-none disabled:opacity-50"
            title="Session history"
            aria-label="Session history"
            disabled={isPending}
            onClick={openSessions}
          >
            <History size={16} />
          </button>
          <button
            className={`inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground h-8 w-8 disabled:pointer-events-none disabled:opacity-50 ${shareState === "copied" ? "text-primary" : ""} ${shareState === "error" ? "text-destructive" : ""}`}
            title={shareState === "copied" ? "Copied share link" : shareState === "error" ? "Could not share yet" : "Share session"}
            aria-label="Share session"
            disabled={isPending || shareState === "sharing"}
            onClick={handleShare}
          >
            <Share2 size={16} />
          </button>
          <button
            className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground h-8 w-8"
            title="Learning usage"
            aria-label="Learning usage"
            onClick={() => navigate({ to: "/usage" })}
          >
            <BarChart3 size={16} />
          </button>
          <button
            className={`inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground h-8 w-8 ${speechEnabled ? "text-primary" : ""}`}
            title={speechEnabled ? "Disable speech" : "Enable speech"}
            aria-pressed={speechEnabled}
            onClick={toggleSpeech}
          >
            {speechEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
          <button
            className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground h-8 w-8"
            title="Settings"
            onClick={openSettings}
          >
            <Settings size={16} />
          </button>
          <button
            className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground h-8 w-8"
            title="Artifacts"
            aria-label="Artifacts"
            onClick={() => setArtifactBrowserOpen(true)}
          >
            <LibraryBig size={16} />
          </button>
        </div>
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
            className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 px-6 py-2.5 border-2 border-[#10b981] text-[#10b981] font-terminal text-sm hover:bg-[#10b981] hover:text-[#0c0c0c] transition-colors"
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
        onClose={() => setArtifactBrowserOpen(false)}
      />
      {sessionManagerDialog}
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

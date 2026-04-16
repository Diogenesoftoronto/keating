import { Suspense } from "react";
import { Settings } from "lucide-react";
import { useKeatingAgent } from "../hooks/useKeatingAgent";

// Types for the custom components
import "../lit-components";

// Register model-selector and providers-models-tab web components
import "../components/model-selector";
import "../components/providers-models-tab";
import "../components/settings";
import "@mariozechner/mini-lit/dist/ThemeToggle.js";

function ChatContent() {
  const { title, openSettings, chatPanelRef } = useKeatingAgent();

  return (
    <div className="chat-page-shell w-full flex flex-col bg-background text-foreground overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border shrink-0 px-4 py-2 h-14">
        <span className="text-lg font-semibold">{title}</span>
        <div className="flex items-center gap-1">
          <theme-toggle></theme-toggle>
          <button
            className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground h-8 w-8"
            title="Settings"
            onClick={openSettings}
          >
            <Settings size={16} />
          </button>
        </div>
      </div>

      <pi-chat-panel
        ref={chatPanelRef}
        className="chat-page-panel"
      ></pi-chat-panel>
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

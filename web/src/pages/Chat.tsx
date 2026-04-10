import { useRef } from "react";
import type { ChatPanel } from "@mariozechner/pi-web-ui";
import { Settings } from "lucide-react";
import { ChatPanelComponent, ThemeToggleComponent } from "../lit-components";
import { useKeatingAgent } from "../hooks/useKeatingAgent";

// Register model-selector and providers-models-tab web components
import "../components/model-selector";
import "../components/providers-models-tab";
import "../components/settings";

export function Chat() {
  const chatPanelRef = useRef<ChatPanel>(null);
  const { title, openSettings, ready } = useKeatingAgent(chatPanelRef);

  return (
    <div className="w-full h-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border shrink-0 px-4 py-2 h-14">
        <span className="text-lg font-semibold">{title}</span>
        <div className="flex items-center gap-1">
          <ThemeToggleComponent />
          <button
            className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground h-8 w-8"
            title="Settings"
            onClick={openSettings}
          >
            <Settings size={16} />
          </button>
        </div>
      </div>

      {/* Loading placeholder — shown while agent initialises */}
      {!ready && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Initializing…
        </div>
      )}

      {/* Chat panel — kept in DOM from mount so setAgent can be called via ref.
          Hidden (not removed) until ready to avoid the uninitialized-state flash. */}
      <ChatPanelComponent
        ref={chatPanelRef}
        style={{ flex: 1, overflow: "hidden", display: ready ? "block" : "none" }}
      />
    </div>
  );
}

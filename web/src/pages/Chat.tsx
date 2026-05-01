import { Suspense, useState } from "react";
import { Settings, Volume2, VolumeX } from "lucide-react";
import { useKeatingAgent } from "../hooks/useKeatingAgent";
import { ChatIntro } from "../components/ChatIntro";

// Types for the custom components
import "../lit-components";

// Register model-selector and providers-models-tab web components
import "../components/model-selector";
import "../components/providers-models-tab";
import "../components/settings";
import "@mariozechner/mini-lit/dist/ThemeToggle.js";

function ChatContent() {
  const { title, openSettings, chatPanelRef, speechEnabled, toggleSpeech } = useKeatingAgent();
  const [introDismissed, setIntroDismissed] = useState(
    () => sessionStorage.getItem("keating_chat_intro") === "dismissed"
  );

  const dismissIntro = () => {
    setIntroDismissed(true);
    sessionStorage.setItem("keating_chat_intro", "dismissed");
  };

  return (
    <div className="chat-page-shell w-full flex flex-col bg-background text-foreground overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border shrink-0 px-4 py-2 h-14">
        <span className="text-lg font-semibold">{title}</span>
        <div className="flex items-center gap-1">
          <theme-toggle></theme-toggle>
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
        </div>
      </div>

      {introDismissed ? (
        <pi-chat-panel
          ref={chatPanelRef}
          className="chat-page-panel"
        ></pi-chat-panel>
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

import { useEffect, useRef, useState } from "react";
import { usePostHog } from "@posthog/react";
import { sectionTitle, sectionLede } from "../../styled-system/recipes";
import { ScrambleText } from "./ScrambleText";
import "./terminal-install.css";

type InstallTab = "npm" | "bun" | "pnpm" | "curl" | "agent";
const INSTALL_TABS: InstallTab[] = ["npm", "bun", "pnpm", "curl", "agent"];
const TAB_FILENAMES: Record<InstallTab, string> = {
  npm: "install.npm", bun: "install.bun", pnpm: "install.pnpm", curl: "install.curl", agent: "AGENT_INSTRUCTIONS.txt",
};
const TAB_COPY_TEXT: Record<InstallTab, string> = {
  npm: "npm install -g keating\nkeating setup\n# Requires Node.js 22.19+ and a configured provider",
  bun: "bun add -g keating\nkeating setup\n# Configure Gemini, OpenAI, or Anthropic after install",
  pnpm: "pnpm add -g keating\nkeating setup\n# Requires Node.js 22.19+ and a configured provider",
  curl: "curl -fsSL https://raw.githubusercontent.com/Diogenesoftoronto/keating/main/scripts/install/install.sh | bash\nkeating setup\n# Standalone install. No package manager needed.",
  agent: `Install the Keating hyperteacher CLI, then configure one supported provider.

Option 1: NPM (most common)
npm install -g keating

Option 2: Bun (fastest)
bun add -g keating

Option 3: PNPM (disk efficient)
pnpm add -g keating

Option 4: Curl (standalone)
curl -fsSL https://raw.githubusercontent.com/Diogenesoftoronto/keating/main/scripts/install/install.sh | bash

NPM and PNPM require Node.js 22.19 or newer.

Provider setup
Run: keating setup
Or set one of GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY.`,
};

/** Optional terminal installation, following the platform downloads. */
export function TerminalInstall() {
  const posthog = usePostHog();
  const [activeTab, setActiveTab] = useState<InstallTab>("npm");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current); }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(TAB_COPY_TEXT[activeTab]);
      setCopyState("copied");
      posthog?.capture("install_intent", { method: activeTab });
    } catch {
      setCopyState("failed");
    }
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopyState("idle"), 2500);
  }

  return (
    <section id="install" className="install terminal-install">
      <div className="wrap">
        <div className="install-layout">
          <div className="install-copy-panel">
            <h2 className={sectionTitle()}><ScrambleText text="Run it where you work." /></h2>
            <p className={sectionLede()}>Use the web classroom immediately, or install the open-source CLI. Provider credentials stay on your machine.</p>
            <div className="install-notes" aria-label="Install requirements">
              <span>Node.js 22.19+ for npm and pnpm</span>
              <span>Bun supported</span>
              <span>Gemini, OpenAI, or Anthropic</span>
            </div>
          </div>
          <div className="install-term">
            <div className="install-term-bar">
              <span className="d r" aria-hidden="true" /><span className="d y" aria-hidden="true" /><span className="d g" aria-hidden="true" />
              <span className="install-term-title">{TAB_FILENAMES[activeTab]}</span>
              <button type="button" className={`install-copy ${copyState === "copied" ? "copied" : ""}`} onClick={() => void handleCopy()} aria-label={copyState === "copied" ? "Copied" : "Copy install instructions"}>{copyState === "copied" ? "[COPIED!]" : "[COPY]"}</button>
            </div>
            <div className="install-term-tabs" aria-label="Install method">
              {INSTALL_TABS.map((tab) => <button key={tab} type="button" aria-pressed={activeTab === tab} className={`${activeTab === tab ? "active" : ""} ${tab === "agent" ? "agent-tab" : ""}`} onClick={() => { setActiveTab(tab); setCopyState("idle"); }}>[{tab.toUpperCase()}]</button>)}
            </div>
            <div className="install-term-body" aria-live="polite">
              <pre>{TAB_COPY_TEXT[activeTab]}</pre>
              {copyState === "failed" && <p role="status">Copy unavailable. Select the instructions above to copy them.</p>}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

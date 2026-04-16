import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Nav } from "../components/Nav";
import { Footer } from "../components/Footer";
import { BootSequence } from "../components/BootSequence";
import { Pretext } from "../components/Pretext";

type InstallTab = "npm" | "bun" | "pnpm" | "curl" | "agent";

const INSTALL_TABS: { id: InstallTab; label: string; isAgent?: boolean }[] = [
  { id: "npm", label: "[NPM]" },
  { id: "bun", label: "[BUN]" },
  { id: "pnpm", label: "[PNPM]" },
  { id: "curl", label: "[CURL]" },
  { id: "agent", label: "[AGENT]", isAgent: true },
];

const TAB_FILENAMES: Record<InstallTab, string> = {
  npm: "install.npm",
  bun: "install.bun",
  pnpm: "install.pnpm",
  curl: "install.curl",
  agent: "AGENT_INSTRUCTIONS.txt",
};

const TAB_COPY_TEXT: Record<InstallTab, string> = {
  npm: "$ npm install -g @interleavelove/keating\n# Requires Node.js 18+ and API key in ~/.keating/.env",
  bun: "$ bun add -g @interleavelove/keating\n# Fastest option. Requires Bun 1.0+ and API key",
  pnpm: "$ pnpm add -g @interleavelove/keating\n# Disk-efficient. Requires pnpm and API key",
  curl: "$ curl -fsSL https://raw.githubusercontent.com/Diogenesoftoronto/keating/main/scripts/install/install.sh | bash\n# Standalone install. No package manager needed.",
  agent: `Install Keating hyperteacher CLI with one of these methods. All require setting a Google API key for the AI backend.

Option 1: NPM (most common)
npm install -g @interleavelove/keating

Option 2: Bun (fastest)
bun add -g @interleavelove/keating

Option 3: PNPM (disk efficient)
pnpm add -g @interleavelove/keating

Option 4: Curl (standalone)
curl -fsSL https://raw.githubusercontent.com/Diogenesoftoronto/keating/main/scripts/install/install.sh | bash

Required: API Key Setup
1. Get a Gemini API key from Google AI Studio
2. Create ~/.keating/.env with: GOOGLE_API_KEY=your_key
3. Or set GOOGLE_API_KEY as environment variable`,
};

export function Landing() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<InstallTab>("npm");
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(TAB_COPY_TEXT[activeTab]).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="retro-layout retro-page">
      <BootSequence />
      <Nav showFeatures />

      {/* Hero — pt accounts for fixed nav (h-14 = 3.5rem) + extra breathing room */}
      <section className="pt-20 sm:pt-24 pb-12 sm:pb-20 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="coords mb-4">42.3601° N, 71.0589° W // WELLESLEY, MA</div>

          <div className="paper-fold distressed-border p-8 mb-8">
            <h1 className="text-4xl md:text-6xl font-bold mb-6 leading-none tracking-tight flex items-center gap-6">
              <img src="/logo.png" alt="Keating Logo" className="w-24 h-24 sm:w-32 sm:h-32 object-contain filter drop-shadow-md rounded" />
              <div>
                THE HYPERTEACHER
                <br />
                <span className="font-terminal text-accent text-5xl md:text-7xl">
                  THINK_FOR_YOURSELF
                </span>
              </div>
            </h1>
            <div className="max-w-2xl">
              <Pretext 
                text="Keating doesn't give answers. It forces you to reconstruct understanding from memory. No hand-holding. No spoon-feeding. Just the Socratic method powered by silicon."
                font="18px 'Inter', sans-serif"
                lineHeight={28}
                className="mb-6 opacity-90"
              />
            </div>
            <div className="stamp">COGNITIVE EMPOWERMENT</div>
          </div>

          {/* Terminal quote */}
          <div className="terminal-window p-4 mb-8 terminal-glow">
            <div className="flex items-center gap-2 mb-2 border-b border-[#00ff00]/30 pb-2">
              <span className="w-3 h-3 rounded-full bg-[#ff5f56]" />
              <span className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
              <span className="w-3 h-3 rounded-full bg-[#27ca40]" />
              <span className="ml-4 text-sm opacity-60">root@keating:~</span>
            </div>
            <p className="font-terminal text-xl md:text-2xl leading-relaxed typewriter">
              "That the powerful play goes on, and you may contribute a verse."
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-4">
            <button
              className="btn-retro px-8 py-4 font-bold text-lg min-h-[56px]"
              onClick={() => navigate({ to: "/chat" })}
            >
              INITIALIZE_SESSION →
            </button>
            <a
              href="#install"
              className="btn-retro px-8 py-4 font-bold text-lg text-center min-h-[56px] flex items-center justify-center"
            >
              BUILD_FROM_SOURCE
            </a>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20 px-6 border-t-2 border-[#1a1a1a]">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-4 mb-12">
            <span className="font-terminal text-accent">$ cat MANIFESTO.txt</span>
            <div className="flex-1 h-px bg-[#1a1a1a]/20" />
          </div>

          <div className="grid md:grid-cols-2 gap-8 pt-3">
            {[
              {
                n: "01",
                title: "DIAGNOSE",
                body: "Before teaching, Keating maps what you actually know. No wasted cycles on mastered concepts. Like a debugger for your knowledge graph.",
              },
              {
                n: "02",
                title: "RECONSTRUCT",
                body: "You don't memorize—you rebuild. From memory, from first principles. Struggle is the feature, not the bug. That's how neural pathways form.",
              },
              {
                n: "03",
                title: "TRANSFER",
                body: "Prove it in unfamiliar territory. Real understanding shows when you can apply knowledge in contexts you've never seen.",
              },
              {
                n: "04",
                title: "PRESERVE",
                body: "Penalize rote echoing. Reward novel analogies. Your voice matters, not the AI's. If you parrot, Keating will know.",
              },
            ].map(({ n, title, body }) => (
              <div key={n} className="paper-fold distressed-border p-6 tape">
                <div className="font-terminal text-2xl text-accent mb-3">
                  [{n}] {title}
                </div>
                <div className="text-sm">
                  <Pretext 
                    text={body}
                    font="14px 'Inter', sans-serif"
                    lineHeight={20}
                    justify={true}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 px-6 bg-[#1a1a1a] text-[#f4f1ea]">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-4 mb-12">
            <span className="font-terminal text-accent">$ ./keating --protocol</span>
            <div className="flex-1 h-px bg-[#f4f1ea]/20" />
          </div>

          <div className="space-y-6 font-terminal">
            {[
              {
                n: "01",
                title: "INPUT_QUERY",
                body: "Ask anything. Math, philosophy, code, art. Keating doesn't lecture—it investigates.",
              },
              {
                n: "02",
                title: "RUN_DIAGNOSTIC",
                body: "Instead of answering, Keating probes. What's solid? What's shaky? Where are the gaps?",
              },
              {
                n: "03",
                title: "FORCE_RECONSTRUCTION",
                body: "Guided questions. You rebuild the concept yourself. No shortcuts.",
              },
              {
                n: "04",
                title: "TEST_TRANSFER",
                body: "Apply to new context. Can you actually use this knowledge, or did you just memorize?",
              },
            ].map(({ n, title, body }) => (
              <div key={n} className="flex gap-4 p-4 border border-[#f4f1ea]/20">
                <div className="text-accent text-2xl">{n}</div>
                <div>
                  <div className="text-lg text-[#00ff00]">{title}</div>
                  <div className="text-sm text-[#f4f1ea]/60">{body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Install */}
      <section id="install" className="py-20 px-6 border-t-2 border-[#1a1a1a]">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-4 mb-8">
            <span className="font-terminal text-accent">$ ./install.sh</span>
            <div className="flex-1 h-px bg-[#1a1a1a]/20" />
          </div>

          {/* Tab buttons */}
          <div className="flex gap-2 mb-4 font-terminal flex-wrap">
            {INSTALL_TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              const isAgent = tab.isAgent;
              return (
                <button
                  key={tab.id}
                  className={[
                    "install-tab px-3 py-3 md:px-4 md:py-2 border-2 min-h-[44px] text-sm md:text-base transition",
                    isAgent
                      ? isActive
                        ? "border-[#10b981] bg-[#10b981] text-[#f4f1ea]"
                        : "border-[#10b981] text-[#10b981] hover:bg-[#10b981] hover:text-[#f4f1ea]"
                      : isActive
                      ? "border-[#1a1a1a] bg-[#1a1a1a] text-[#f4f1ea]"
                      : "border-[#1a1a1a] hover:bg-[#1a1a1a] hover:text-[#f4f1ea]",
                    isActive ? "active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Terminal window */}
          <div className="terminal-window p-4 terminal-glow mb-6 overflow-x-auto">
            <div className="flex items-center justify-between gap-2 mb-2 border-b border-[#00ff00]/30 pb-2 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-3 h-3 rounded-full bg-[#ff5f56] shrink-0" />
                <span className="w-3 h-3 rounded-full bg-[#ffbd2e] shrink-0" />
                <span className="w-3 h-3 rounded-full bg-[#27ca40] shrink-0" />
                <span className="ml-2 text-sm opacity-60 truncate">{TAB_FILENAMES[activeTab]}</span>
              </div>
              <button
                className={`copy-btn shrink-0 ml-4 px-3 py-1 border border-[#00ff00]/50 text-[#00ff00] font-terminal text-sm transition ${
                  copied ? "bg-[#00ff00]/30" : ""
                }`}
                onClick={handleCopy}
              >
                {copied ? "[COPIED!]" : "[COPY]"}
              </button>
            </div>

            {/* npm */}
            {activeTab === "npm" && (
              <code className="font-terminal text-base sm:text-lg block whitespace-pre-wrap break-all">
                <span className="text-[#00ff00]">$</span>{" "}npm install -g @interleavelove/keating{"\n"}
                <span className="text-[#888]"># Requires Node.js 18+ and API key in ~/.keating/.env</span>
              </code>
            )}

            {/* bun */}
            {activeTab === "bun" && (
              <code className="font-terminal text-base sm:text-lg block whitespace-pre-wrap break-all">
                <span className="text-[#00ff00]">$</span>{" "}bun add -g @interleavelove/keating{"\n"}
                <span className="text-[#888]"># Fastest option. Requires Bun 1.0+ and API key</span>
              </code>
            )}

            {/* pnpm */}
            {activeTab === "pnpm" && (
              <code className="font-terminal text-base sm:text-lg block whitespace-pre-wrap break-all">
                <span className="text-[#00ff00]">$</span>{" "}pnpm add -g @interleavelove/keating{"\n"}
                <span className="text-[#888]"># Disk-efficient. Requires pnpm and API key</span>
              </code>
            )}

            {/* curl */}
            {activeTab === "curl" && (
              <code className="font-terminal text-base sm:text-lg block whitespace-pre-wrap break-all">
                <span className="text-[#00ff00]">$</span>{" "}curl -fsSL https://raw.githubusercontent.com/Diogenesoftoronto/keating/main/scripts/install/install.sh <span className="text-[#00ff00]">|</span> bash{"\n"}
                <span className="text-[#888]"># Standalone install. No package manager needed.</span>
              </code>
            )}

            {/* agent */}
            {activeTab === "agent" && (
              <div className="font-terminal text-base leading-relaxed break-words">
                <p className="text-[#00ff00] mb-2">$ cat AGENT_INSTRUCTIONS.txt</p>
                <p className="text-[#f4f1ea] mb-4">
                  Install Keating hyperteacher CLI with one of these methods. All require setting a
                  Google API key for the AI backend.
                </p>
                <p className="text-accent mb-1">Option 1: NPM (most common)</p>
                <p className="text-[#f4f1ea]/80 mb-3 ml-4">npm install -g @interleavelove/keating</p>
                <p className="text-accent mb-1">Option 2: Bun (fastest)</p>
                <p className="text-[#f4f1ea]/80 mb-3 ml-4">bun add -g @interleavelove/keating</p>
                <p className="text-accent mb-1">Option 3: PNPM (disk efficient)</p>
                <p className="text-[#f4f1ea]/80 mb-3 ml-4">pnpm add -g @interleavelove/keating</p>
                <p className="text-accent mb-1">Option 4: Curl (standalone)</p>
                <p className="text-[#f4f1ea]/80 mb-3 ml-4">
                  curl -fsSL .../install.sh | bash
                </p>
                <p className="text-[#00ff00] mb-1">Required: API Key Setup</p>
                <p className="text-[#f4f1ea]/80 mb-1 ml-4">1. Get a Gemini API key from Google AI Studio</p>
                <p className="text-[#f4f1ea]/80 mb-1 ml-4">
                  2. Create ~/.keating/.env with: GOOGLE_API_KEY=your_key
                </p>
                <p className="text-[#f4f1ea]/80 ml-4">3. Or set GOOGLE_API_KEY as environment variable</p>
              </div>
            )}
          </div>

          <div className="marquee border-y-2 border-[#1a1a1a] py-2 bg-[#1a1a1a] text-[#f4f1ea]">
            <span className="font-terminal">
              *** AVAILABLE FOR macOS AND LINUX *** YOUR API KEYS STAY LOCAL *** NO CLOUD
              DEPENDENCY *** FREE AND OPEN SOURCE ***
            </span>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}

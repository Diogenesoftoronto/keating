import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { usePostHog } from "@posthog/react";
import { Nav } from "../components/Nav";
import { Footer } from "../components/Footer";
import { BootSequence } from "../components/BootSequence";
import { useSeo } from "../hooks/useSeo";

const KeatingHero3D = lazy(() => import("../components/three/KeatingHero3D"));

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

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
  npm: "$ npm install -g keating\n# Requires Node.js 18+ and API key in ~/.keating/.env",
  bun: "$ bun add -g keating\n# Fastest option. Requires Bun 1.0+ and API key",
  pnpm: "$ pnpm add -g keating\n# Disk-efficient. Requires pnpm and API key",
  curl: "$ curl -fsSL https://raw.githubusercontent.com/Diogenesoftoronto/keating/main/scripts/install/install.sh | bash\n# Standalone install. No package manager needed.",
  agent: `Install Keating hyperteacher CLI with one of these methods. All require setting a Google API key for the AI backend.

Option 1: NPM (most common)
npm install -g keating

Option 2: Bun (fastest)
bun add -g keating

Option 3: PNPM (disk efficient)
pnpm add -g keating

Option 4: Curl (standalone)
curl -fsSL https://raw.githubusercontent.com/Diogenesoftoronto/keating/main/scripts/install/install.sh | bash

Required: API Key Setup
1. Get a Gemini API key from Google AI Studio
2. Create ~/.keating/.env with: GEMINI_API_KEY=your_key
3. Or set GEMINI_API_KEY as environment variable`,
};

const TERM_LINES: { cls: string; text: string }[] = [
  { cls: "t-cmd", text: 'keating session --topic "recursion"' },
  { cls: "t-sys", text: "▸ diagnosing knowledge graph… 3 gaps mapped" },
  { cls: "t-you", text: "can you just explain it to me?" },
  { cls: "t-k", text: "no. you explain it to me. what happens when a function calls itself with no base case?" },
  { cls: "t-you", text: "…it never stops?" },
  { cls: "t-k", text: "closer. nothing runs forever. what runs out first — time, or memory?" },
  { cls: "t-you", text: "memory. each call stacks a new frame until it overflows." },
  { cls: "t-ok", text: "gap closed: call_stack. 2 remaining." },
];

function lineSpeed(cls: string): { perChar: number; pause: number } {
  if (cls === "t-cmd") return { perChar: 34, pause: 650 };
  if (cls === "t-sys" || cls === "t-ok") return { perChar: 6, pause: 420 };
  return { perChar: 16, pause: 650 };
}

/** Hero terminal that types out a sample session when scrolled into view. */
function TerminalDemo() {
  const bodyRef = useRef<HTMLDivElement>(null);
  // null → reduced motion / no IO support: render the full transcript statically
  const [progress, setProgress] = useState<{ line: number; chars: number } | null>(() => {
    if (typeof window === "undefined") return null;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
    if (!("IntersectionObserver" in window)) return null;
    return { line: -1, chars: 0 };
  });

  useEffect(() => {
    if (progress === null || progress.line >= 0) return;
    const el = bodyRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          setTimeout(() => setProgress({ line: 0, chars: 0 }), 500);
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [progress]);

  useEffect(() => {
    if (progress === null || progress.line < 0 || progress.line >= TERM_LINES.length) return;
    const { cls, text } = TERM_LINES[progress.line];
    const { perChar, pause } = lineSpeed(cls);
    const timer = setTimeout(
      () => {
        setProgress(
          progress.chars < text.length
            ? { line: progress.line, chars: progress.chars + 1 }
            : { line: progress.line + 1, chars: 0 },
        );
      },
      progress.chars < text.length ? perChar : pause,
    );
    return () => clearTimeout(timer);
  }, [progress]);

  const done = progress === null || progress.line >= TERM_LINES.length;

  return (
    <div className="term" aria-label="Example Keating session">
      <div className="term-bar">
        <span className="d r" />
        <span className="d y" />
        <span className="d g" />
        <span className="term-title">KEATING_TERMINAL — session 0x2F</span>
      </div>
      <div className="term-body" ref={bodyRef}>
        {TERM_LINES.map(({ cls, text }, i) => {
          const hidden = progress !== null && i > progress.line;
          const partial = progress !== null && i === progress.line;
          return (
            <div
              key={i}
              className={`t-line ${cls}`}
              style={hidden ? { visibility: "hidden" } : undefined}
            >
              {partial ? text.slice(0, progress.chars) : text}
            </div>
          );
        })}
        <div className="t-line">{done && <span className="t-caret" />}</div>
      </div>
      <div className="term-foot">
        <div>
          <span className="dot" />
          HARNESS ACTIVE
        </div>
        <div>GAPS: 2</div>
        <div>MODE: SOCRATIC</div>
      </div>
    </div>
  );
}

function HeroTerminal() {
  const navigate = useNavigate();
  const [use3d, setUse3d] = useState(false);
  useEffect(() => {
    // Client-only gate: skip the 3D monitor during SSR and on devices without WebGL.
    if (supportsWebGL()) setUse3d(true);
  }, []);

  if (!use3d) return <TerminalDemo />;
  return (
    <Suspense fallback={<TerminalDemo />}>
      <div className="term-3d" aria-label="Interactive Keating terminal on a retro CRT monitor">
        <KeatingHero3D onNavigate={() => navigate({ to: "/chat" })} />
      </div>
    </Suspense>
  );
}



const MANIFESTO_CARDS = [
  {
    n: "[01]",
    title: "DIAGNOSE",
    body: (
      <>
        Before teaching, Keating maps what you actually know. No wasted cycles on mastered
        concepts — <strong>like a debugger for your knowledge graph.</strong>
      </>
    ),
  },
  {
    n: "[02]",
    title: "RECONSTRUCT",
    body: (
      <>
        You don&apos;t memorize — you rebuild. From memory, from first principles.{" "}
        <strong>Struggle is the feature, not the bug.</strong> That&apos;s how neural pathways
        form.
      </>
    ),
  },
  {
    n: "[03]",
    title: "PROBE",
    body: (
      <>
        Every claim you make gets a counter-question. Keating pushes until your explanation
        survives contact — <strong>or until you find the crack yourself.</strong>
      </>
    ),
  },
  {
    n: "[04]",
    title: "VERIFY",
    body: (
      <>
        A gap isn&apos;t closed because you nodded. You teach the concept back, cold, days later.{" "}
        <strong>If it holds, it&apos;s yours.</strong> If not, the loop runs again.
      </>
    ),
  },
];

// Real CLI surface — the landing shows everything Keating can do.
const USE_GROUPS: Array<{
  title: string;
  blurb: string;
  commands: Array<{ cmd: string; desc: string }>;
}> = [
  {
    title: "TEACH",
    blurb: "Socratic sessions that adapt to what you already know.",
    commands: [
      { cmd: "learn <topic>", desc: "Start a Socratic teaching session" },
      { cmd: "diagnose <topic>", desc: "Map prerequisites and knowledge gaps" },
      { cmd: "plan <topic>", desc: "Generate a lesson plan artifact" },
      { cmd: "map <topic>", desc: "Draw a concept map of the territory" },
      { cmd: "animate <topic>", desc: "Render a manim-style animation" },
    ],
  },
  {
    title: "ASSESS",
    blurb: "Retrieval practice — because recall is how memory forms.",
    commands: [
      { cmd: "quiz <topic>", desc: "Retrieval practice questions" },
      { cmd: "verify <topic>", desc: "Fact-check claims before trusting them" },
      { cmd: "feedback <up|down>", desc: "Tell Keating how the session landed" },
    ],
  },
  {
    title: "SELF-IMPROVE",
    blurb: "Keating benchmarks and evolves its own teaching policy.",
    commands: [
      { cmd: "bench [topic]", desc: "Benchmark the current teaching policy" },
      { cmd: "evolve [topic]", desc: "Evolve policies via MAP-Elites" },
      { cmd: "auto-improve", desc: "Full loop: bench → evolve → bench" },
    ],
  },
  {
    title: "REVIEW",
    blurb: "Your learning history is data — inspect it, export it, own it.",
    commands: [
      { cmd: "timeline", desc: "Engagement timeline across topics" },
      { cmd: "due", desc: "Topics due for spaced review" },
      { cmd: "export --finetune", desc: "Export your data for fine-tuning" },
    ],
  },
];

export function Landing() {
  useSeo({
    title: "Keating — The Hyperteacher | Socratic AI Tutor",
    description: "Keating is a Pi-powered hyperteacher that ensures humans remain the authors of their own understanding. Socratic AI tutoring with lesson plans, concept maps, animations, and self-improving pedagogy.",
    canonical: "https://keating.help/",
  });
  const navigate = useNavigate();
  const posthog = usePostHog();
  const [activeTab, setActiveTab] = useState<InstallTab>("npm");
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(TAB_COPY_TEXT[activeTab]).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      posthog.capture('install_command_copied', { tab: activeTab });
    });
  }

  return (
    <div className="retro-layout retro-page">
      <BootSequence />
      <Nav />

      <main>
        {/* Hero */}
        <section className="hero">
          <div className="wrap">
            <div className="hero-coords">
              42.2961° N, 71.2925° W // HYPERTEACHER PROTOCOL // UPTIME: OPTIMAL
            </div>
            <div className="hero-grid">
              <div>
                <div className="eyebrow">The Hyperteacher</div>
                <h1 className="hero-brand">
                  KEATING<span className="hero-brand-suffix">.help</span>
                </h1>
                <div className="hero-headline">
                  Teaching that makes you do the work.
                  <span className="cursor" />
                </div>
                <div className="hero-sub">THINK_FOR_YOURSELF</div>
                <p className="hero-copy">
                  Keating is an <strong>open-source AI teacher</strong> for your terminal and
                  browser. It won&apos;t give you answers — it diagnoses what you don&apos;t know,
                  plans the lesson, quizzes you, and verifies what stuck. The Socratic method,
                  powered by silicon.
                </p>
                <div className="hero-ctas">
                  <button
                    className="btn-retro btn-retro-primary"
                    onClick={() => {
                      posthog.capture('cta_clicked', { label: 'Initialize_Session', location: 'hero' });
                      navigate({ to: "/chat" });
                    }}
                  >
                    Initialize_Session →
                  </button>
                  <a className="btn-retro" href="#install">
                    Build_From_Source
                  </a>
                </div>
                <div className="hero-tags">
                  <span>
                    <i>◈</i> Diagnoses gaps
                  </span>
                  <span>
                    <i>↻</i> Adapts to you
                  </span>
                  <span>
                    <i>▣</i> Open source
                  </span>
                </div>
              </div>

              <div className="hero-stage">
                <img
                  className="hero-sprite"
                  src="/brand/mascot-full.png"
                  alt="Keating robot mascot — a cream and green retro robot with a CRT screen face"
                  width={486}
                  height={760}
                />
                <div className="sprite-shadow" aria-hidden="true" />
                <HeroTerminal />
              </div>
            </div>
          </div>
        </section>

        {/* What Keating Does */}
        <section className="caps" aria-label="What Keating does">
          <div className="wrap">
            <div className="caps-head">
              <span className="eyebrow prompt">cat CAPABILITIES.txt</span>
              <h2 className="section-title">What Keating does.</h2>
              <p className="section-lede">
                Not a chatbot that answers. A harness that forces you to reconstruct understanding
                from memory — and adapts while you struggle.
              </p>
            </div>
          <div className="caps-grid">
            <div className="cap-card">
              <img className="cap-icon" src="/brand/cap-adaptive.png" alt="" aria-hidden="true" />
              <h3>Adaptive Tutoring</h3>
              <p>Keating adapts to your thinking, pace, and goals. You argue, it adjusts.</p>
            </div>
            <div className="cap-card">
              <img className="cap-icon" src="/brand/cap-evolutionary.png" alt="" aria-hidden="true" />
              <h3>Evolutionary Feedback</h3>
              <p>Continuous evaluation refines the harness — and your understanding — every session.</p>
            </div>
            <div className="cap-card">
              <img className="cap-icon" src="/brand/cap-agent.png" alt="" aria-hidden="true" />
              <h3>Agent Harness</h3>
              <p>Specialized agents plan, probe, evaluate, and improve in concert.</p>
            </div>
            <div className="cap-card">
              <img className="cap-icon" src="/brand/cap-teaching.png" alt="" aria-hidden="true" />
              <h3>Learn by Teaching</h3>
              <p>Turn explanations into mastery. If you can&apos;t teach it back, you don&apos;t own it yet.</p>
            </div>
          </div>
          </div>
        </section>

        {/* CRT Verse */}
        <section className="verse" aria-label="Verse">
          <div className="wrap">
            <div className="verse-prompt prompt">cat VERSE.txt</div>
            <div className="crt-wrap">
              <img src="/brand/crt-monitor.png" alt="Retro CRT monitor" />
              <div className="crt-screen">
                <div className="crt-text">
                  &quot;That the powerful play goes on, and you may contribute a verse.&quot;
                </div>
                <div className="crt-attr">— WALT WHITMAN // O ME! O LIFE!</div>
              </div>
            </div>
          </div>
        </section>

        {/* Manifesto */}
        <section className="manifesto" id="manifesto">
          <div className="wrap">
            <div className="section-head">
              <span className="eyebrow prompt">cat MANIFESTO.txt</span>
            </div>
            <h2 className="section-title">Real teaching is reconstruction, not explanation.</h2>
            <p className="section-lede">
              An answer you were handed evaporates by Friday. An answer you rebuilt from first
              principles is yours for good. Keating runs every session on that thesis.
            </p>
            <div className="man-grid">
              <div className="man-stamp" aria-hidden="true">
                Cognitive Empowerment
              </div>
              {MANIFESTO_CARDS.map(({ n, title, body }) => (
                <div key={n} className="man-card">
                  <div className="man-num">{n}</div>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CLI surface */}
        <section className="use" id="use">
          <div className="wrap">
            <div className="section-head">
              <span className="eyebrow prompt">keating help</span>
            </div>
            <h2 className="section-title">Everything you can run.</h2>
            <p className="section-lede">
              One CLI, one web shell, the same brain. Every command below works in your terminal
              after <code>npm install -g keating</code> — or right now in the browser shell.
            </p>
            <div className="use-grid">
              {USE_GROUPS.map((group) => (
                <div className="use-card" key={group.title}>
                  <div className="use-card-title">{group.title}</div>
                  <p className="use-card-blurb">{group.blurb}</p>
                  <div className="use-cmds">
                    {group.commands.map((c) => (
                      <div className="use-cmd" key={c.cmd}>
                        <code>
                          <span>$ keating</span> {c.cmd}
                        </code>
                        <small>{c.desc}</small>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="use-links">
              <button
                className="btn-retro btn-retro-primary"
                onClick={() => {
                  posthog.capture('cta_clicked', { label: 'Open_Web_Shell', location: 'use_section' });
                  navigate({ to: "/chat" });
                }}
              >
                Open_Web_Shell →
              </button>
              <button className="btn-retro" onClick={() => navigate({ to: "/tutorial" })}>
                Read_Tutorial
              </button>
              <button className="btn-retro" onClick={() => navigate({ to: "/usage" })}>
                Usage_Dashboard
              </button>
            </div>
          </div>
        </section>

        {/* Install — CRT terminal style */}
        <section id="install" className="install">
          <div className="wrap">
            <div className="section-head">
              <span className="eyebrow prompt">./install.sh</span>
            </div>
            <h2 className="section-title">Get Keating.</h2>
            <p className="section-lede">
              Terminal-first. Your API keys stay local. No cloud dependency.
            </p>

            <div className="install-term">
              <div className="install-term-bar">
                <span className="d r" />
                <span className="d y" />
                <span className="d g" />
                <span className="install-term-title">{TAB_FILENAMES[activeTab]}</span>
                <button
                  className={`install-copy ${copied ? "copied" : ""}`}
                  onClick={handleCopy}
                  aria-label={copied ? "Copied" : "Copy install command"}
                >
                  {copied ? "[COPIED!]" : "[COPY]"}
                </button>
              </div>

              <div className="install-term-tabs">
                {INSTALL_TABS.map((tab) => {
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      className={isActive ? "active" : ""}
                      onClick={() => setActiveTab(tab.id)}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              <div className="install-term-body">
                {/* npm */}
                {activeTab === "npm" && (
                  <>
                    <div className="t-line t-cmd">npm install -g keating</div>
                    <div className="t-line t-sys"># Requires Node.js 18+ and API key in ~/.keating/.env</div>
                  </>
                )}

                {/* bun */}
                {activeTab === "bun" && (
                  <>
                    <div className="t-line t-cmd">bun add -g keating</div>
                    <div className="t-line t-sys"># Fastest option. Requires Bun 1.0+ and API key</div>
                  </>
                )}

                {/* pnpm */}
                {activeTab === "pnpm" && (
                  <>
                    <div className="t-line t-cmd">pnpm add -g keating</div>
                    <div className="t-line t-sys"># Disk-efficient. Requires pnpm and API key</div>
                  </>
                )}

                {/* curl */}
                {activeTab === "curl" && (
                  <>
                    <div className="t-line t-cmd">
                      curl -fsSL https://raw.githubusercontent.com/Diogenesoftoronto/keating/main/scripts/install/install.sh | bash
                    </div>
                    <div className="t-line t-sys"># Standalone install. No package manager needed.</div>
                  </>
                )}

                {/* agent */}
                {activeTab === "agent" && (
                  <>
                    <div className="t-line t-cmd">cat AGENT_INSTRUCTIONS.txt</div>
                    <div className="t-line">Install Keating hyperteacher CLI with one of these methods. All require setting a Google API key for the AI backend.</div>
                    <div className="t-line t-ok">Option 1: NPM (most common)</div>
                    <div className="t-line t-indent">npm install -g keating</div>
                    <div className="t-line t-ok">Option 2: Bun (fastest)</div>
                    <div className="t-line t-indent">bun add -g keating</div>
                    <div className="t-line t-ok">Option 3: PNPM (disk efficient)</div>
                    <div className="t-line t-indent">pnpm add -g keating</div>
                    <div className="t-line t-ok">Option 4: Curl (standalone)</div>
                    <div className="t-line t-indent">curl -fsSL .../install.sh | bash</div>
                    <div className="t-line t-cmd">Required: API Key Setup</div>
                    <div className="t-line t-indent">1. Get a Gemini API key from Google AI Studio</div>
                    <div className="t-line t-indent">2. Create ~/.keating/.env with: GEMINI_API_KEY=your_key</div>
                    <div className="t-line t-indent">3. Or set GEMINI_API_KEY as environment variable</div>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="final">
          <div className="wrap">
            <img
              className="final-bot"
              src="/brand/mascot-lotus.png"
              alt="Keating robot mascot"
              aria-hidden="true"
              width={300}
              height={426}
            />
            <h2>Ready to think for yourself?</h2>
            <p>
              Free and open source. Bring a topic you half-understand and leave with one you own.
            </p>
            <div className="hero-ctas">
              <button
                className="btn-retro btn-retro-primary"
                onClick={() => {
                  posthog.capture('cta_clicked', { label: 'Initialize_Session', location: 'final_cta' });
                  navigate({ to: "/chat" });
                }}
              >
                Initialize_Session →
              </button>
              <button className="btn-retro" onClick={() => navigate({ to: "/paper" })}>
                Read_The_Paper
              </button>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

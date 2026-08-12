import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { usePostHog } from "@posthog/react";
import { Nav } from "../components/Nav";
import { Footer } from "../components/Footer";
import {
  AnimatedHeroHeadline,
  CrtPlaythrough,
  HeroWonderStage,
  KineticTeachingText,
  LearningJourney,
} from "../components/LandingWonder";
import { SurfaceScreencasts } from "../components/SurfaceScreencasts";
import { ScrambleText } from "../components/ScrambleText";
import { useSeo } from "../hooks/useSeo";
import { css } from "../../styled-system/css";
import {
  btnRetro,
  eyebrow,
  sectionLede,
  sectionTitle
} from "../../styled-system/recipes";

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
  npm: "$ npm install -g keating\n# Requires Node.js 20.19+ and a configured provider",
  bun: "$ bun add -g keating\n# Configure Gemini, OpenAI, or Anthropic after install",
  pnpm: "$ pnpm add -g keating\n# Requires Node.js 20.19+ and a configured provider",
  curl: "$ curl -fsSL https://raw.githubusercontent.com/Diogenesoftoronto/keating/main/scripts/install/install.sh | bash\n# Standalone install. No package manager needed.",
  agent: `Install the Keating hyperteacher CLI, then configure one supported provider.

Option 1: NPM (most common)
npm install -g keating

Option 2: Bun (fastest)
bun add -g keating

Option 3: PNPM (disk efficient)
pnpm add -g keating

Option 4: Curl (standalone)
curl -fsSL https://raw.githubusercontent.com/Diogenesoftoronto/keating/main/scripts/install/install.sh | bash

Provider setup
Run: keating setup
Or set one of GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY.`,
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



// Real CLI surface — the landing shows everything Keating can do.
const USE_GROUPS: Array<{
  title: string;
  blurb: string;
  image: string;
  commands: Array<{ cmd: string; desc: string }>;
}> = [
  {
    title: "TEACH",
    blurb: "Socratic sessions that adapt to what you already know.",
    image: "/brand/cap-agent.png",
    commands: [
      { cmd: "learn <topic>", desc: "Start a Socratic teaching session" },
      { cmd: "diagnose <topic>", desc: "Map prerequisites and knowledge gaps" },
      { cmd: "plan <topic>", desc: "Generate a lesson plan artifact" },
      { cmd: "map <topic>", desc: "Draw a concept map of the territory" },
      { cmd: "animate <topic>", desc: "Render a Hyperframes animation" },
    ],
  },
  {
    title: "ASSESS",
    blurb: "Retrieval practice — because recall is how memory forms.",
    image: "/brand/cap-teaching.png",
    commands: [
      { cmd: "quiz <topic>", desc: "Retrieval practice questions" },
      { cmd: "verify <topic>", desc: "Fact-check claims before trusting them" },
      { cmd: "feedback <up|down>", desc: "Tell Keating how the session landed" },
    ],
  },
  {
    title: "SELF-IMPROVE",
    blurb: "Keating benchmarks and evolves its own teaching policy.",
    image: "/brand/cap-evolutionary.png",
    commands: [
      { cmd: "bench [topic]", desc: "Benchmark the current teaching policy" },
      { cmd: "evolve [topic]", desc: "Evolve policies via MAP-Elites" },
      { cmd: "auto-improve", desc: "Full loop: bench → evolve → bench" },
    ],
  },
  {
    title: "REVIEW",
    blurb: "Your learning history is data — inspect it, export it, own it.",
    image: "/brand/mascot-live-listening.png",
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
      posthog.capture('install_intent', { method: activeTab });
    });
  }

  return (
    <div className="retro-layout retro-page">
      <Nav />

      <main>
        {/* Hero */}
        <section className="hero">
          <div className="wrap hero-wrap">
            <div className="hero-grid">
              <div className="hero-content">
                <div className={eyebrow()}>The Hyperteacher</div>
                <h1 className="hero-brand">
                  KEATING<span className="hero-brand-suffix">.help</span>
                </h1>
                <AnimatedHeroHeadline />
                <p className="hero-copy">
                  Keating listens to your explanation, finds where it thins out, and asks the next
                  useful question. Progress means rebuilding the idea and teaching it back in your
                  own words.
                </p>
                <div className="hero-ctas">
                  <button
                    className={btnRetro({ tone: "primary" })}
                    onClick={() => {
                      posthog.capture('start_session_clicked', { source: 'landing_hero' });
                      navigate({ to: "/chat" });
                    }}
                  >
                    Start a session →
                  </button>
                  <a className={btnRetro()} href="#watch">
                    Watch real sessions
                  </a>
                </div>
                <ul className="hero-proof" aria-label="Keating product qualities">
                  <li>Browser and terminal</li>
                  <li>Local-first CLI</li>
                  <li>Inspectable artifacts</li>
                </ul>
              </div>

              <div className="hero-stage">
                <HeroWonderStage>
                  <HeroTerminal />
                </HeroWonderStage>
              </div>
            </div>
          </div>
        </section>

        <div id="watch">
          <SurfaceScreencasts />
        </div>
        <KineticTeachingText />
        <LearningJourney />
        <CrtPlaythrough />

        {/* CLI surface */}
        <section className="use" id="use">
          <div className="wrap">
            <h2 className={sectionTitle()}>
              <ScrambleText text="Everything you can run." />
            </h2>
            <p className={sectionLede()}>
              The browser and CLI share the same teaching core. Start a conversation, generate an
              artifact, inspect the trace, or evolve the teaching policy.
            </p>
            <div className="use-grid">
              {USE_GROUPS.map((group, index) => (
                <div className="use-card" key={group.title}>
                  <div className="use-card-media" aria-hidden="true">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <img src={group.image} alt="" width={341} height={403} loading="lazy" />
                  </div>
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
                className={btnRetro({ tone: "primary" })}
                onClick={() => {
                  posthog.capture('start_session_clicked', { source: 'landing_use_section' });
                  navigate({ to: "/chat" });
                }}
              >
                Open the classroom →
              </button>
              <button className={btnRetro()} onClick={() => navigate({ to: "/tutorial" })}>
                Read the tutorial
              </button>
            </div>
          </div>
        </section>

        {/* Install — CRT terminal style */}
        <section id="install" className="install">
          <div className="wrap">
            <div className="install-layout">
              <div className="install-copy-panel">
                <h2 className={sectionTitle()}>
                  <ScrambleText text="Run it where you work." />
                </h2>
                <p className={sectionLede()}>
                  Use the web classroom immediately, or install the open-source CLI. Provider
                  credentials stay on your machine.
                </p>
                <div className="install-notes" aria-label="Install requirements">
                  <span>Node.js 20.19+</span>
                  <span>Bun supported</span>
                  <span>Gemini, OpenAI, or Anthropic</span>
                </div>
              </div>

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

                <div className="install-term-tabs" aria-label="Install method">
                  {INSTALL_TABS.map((tab) => {
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        aria-pressed={isActive}
                        className={isActive ? "active" : ""}
                        onClick={() => setActiveTab(tab.id)}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                <div className="install-term-body" aria-live="polite">
                  <pre className={css({ margin: 0, whiteSpace: "pre-wrap" })}>
                    {TAB_COPY_TEXT[activeTab]}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="final">
          <div className="wrap">
            <div className="final-mascot-scene">
              <span className="final-thought final-thought-one" aria-hidden="true">
                What makes you think that?
              </span>
              <span className="final-thought final-thought-two" aria-hidden="true">
                Show me the mechanism.
              </span>
              <img
                className="final-bot"
                src="/brand/mascot-lotus.png"
                alt="Keating robot mascot"
                aria-hidden="true"
                width={300}
                height={426}
              />
            </div>
            <h2>
              <ScrambleText text="Ready to think for yourself?" />
            </h2>
            <p>
              Bring a topic you half-understand. Keating will help you find the part that is not
              yours yet.
            </p>
            <div className="hero-ctas">
              <button
                className={btnRetro({ tone: "primary" })}
                onClick={() => {
                  posthog.capture('start_session_clicked', { source: 'landing_final_cta' });
                  navigate({ to: "/chat" });
                }}
              >
                Start a session →
              </button>
              <button className={btnRetro()} onClick={() => navigate({ to: "/paper" })}>
                Read the paper
              </button>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

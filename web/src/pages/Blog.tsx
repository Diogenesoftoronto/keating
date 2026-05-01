import { Link } from "@tanstack/react-router";
import { Nav } from "../components/Nav";
import { SimpleFooter } from "../components/Footer";
import { Pretext } from "../components/Pretext";

type BadgeColor = "fix" | "release" | "feature" | "pwa" | "update" | "tech" | "devlog";

interface Post {
  date: string;
  badge: { label: string; color: BadgeColor };
  title: string;
  body: React.ReactNode;
}

const BADGE_CLASSES: Record<BadgeColor, string> = {
  fix: "bg-[#d97706]/10 text-[#d97706]",
  release: "bg-[#10b981]/10 text-[#10b981]",
  feature: "bg-[#10b981]/10 text-[#10b981]",
  pwa: "bg-[#6366f1]/10 text-[#6366f1]",
  update: "bg-[#d97706]/10 text-[#d97706]",
  tech: "bg-[#6366f1]/10 text-[#6366f1]",
  devlog: "bg-[#d97706]/10 text-[#d97706]",
};

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="bg-[#1a1a1a] text-[#f4f1ea] px-1 rounded text-sm">{children}</code>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <div className="code-block mb-4 overflow-x-auto">
      <pre className="whitespace-pre-wrap break-words">{children}</pre>
    </div>
  );
}

const POSTS: Post[] = [
  {
    date: "2026-05-01",
    badge: { label: "FEATURE", color: "feature" },
    title: "Optional Speech: Gemini Live Voice for the Web",
    body: (
      <>
        <div className="mb-4">
          <Pretext
            text="Keating now has an optional speech layer. The teacher still thinks, verifies, plans, and steers through the normal model/tool loop, but it can hand short learner-facing moments to a dedicated voice tool when speech is useful."
            font="16px 'Inter', sans-serif"
            lineHeight={24}
          />
        </div>
        <h3 className="font-bold mt-4 mb-2">How It Works</h3>
        <ul className="text-sm space-y-2 ml-4 mb-4">
          <li>
            <strong>Opt-in by design:</strong> Speech stays disabled until you turn it on. In the web app, use the speaker button in the chat header.
          </li>
          <li>
            <strong>Voice tool:</strong> When enabled, the model gets <Code>keating_voice</Code> for short questions, redirects, recaps, and encouragement.
          </li>
          <li>
            <strong>Gemini Live path:</strong> The browser route uses <Code>gemini-3.1-flash-live-preview</Code> with the Google API key stored in Settings.
          </li>
          <li>
            <strong>Normal model remains in charge:</strong> Reasoning, verification, and correction still happen through the regular teaching tools instead of being hidden inside the voice layer.
          </li>
        </ul>
        <h3 className="font-bold mt-4 mb-2">Shell Support</h3>
        <p className="text-sm mb-4">
          The CLI config now includes a disabled-by-default <Code>speech</Code> block. When enabled,
          the Pi extension registers <Code>keating_voice</Code> and emits transcript-safe voice tags:
        </p>
        <CodeBlock>{`[voice voice=conversational tags=question,verify pace=normal affect=curious] What would you expect to happen next?`}</CodeBlock>
        <p className="text-sm text-[#64748b]">
          The first shell version is provider-neutral and tag-based. The web version is the first audio-backed path.
        </p>
      </>
    ),
  },
  {
    date: "2026-04-30",
    badge: { label: "RELEASE", color: "release" },
    title: "v0.3.0 — Pedagogical Engines, a Sharper Logo, and Recorded Workflows",
    body: (
      <>
        <div className="mb-4">
          <Pretext
            text="Keating 0.3.0 is out. This release lays the groundwork for a much richer learning loop — flashcards, quizzes, mastery tracking, and multi-week projects — and gives the brand a long-overdue polish at both ends of the stack."
            font="16px 'Inter', sans-serif"
            lineHeight={24}
          />
        </div>
        <h3 className="font-bold mt-4 mb-2">New Pedagogical Engines</h3>
        <ul className="text-sm space-y-3 ml-4 mb-4">
          <li>
            <div className="font-bold mb-1 underline decoration-[#d44a3d]">Flashcards:</div>
            <Pretext
              text="Spaced-repetition decks with definitions, intuitions, common misconceptions, transfer prompts, and optional mnemonics — generated per topic."
              font="14px 'Inter', sans-serif"
              lineHeight={20}
              justify={false}
            />
          </li>
          <li>
            <div className="font-bold mb-1 underline decoration-[#d44a3d]">Quizzes & Workbooks:</div>
            <Pretext
              text="Structured question sets across recall, comprehension, application, analysis, and transfer levels, with rubrics for short-answer items and a generated answer key."
              font="14px 'Inter', sans-serif"
              lineHeight={20}
              justify={false}
            />
          </li>
          <li>
            <div className="font-bold mb-1 underline decoration-[#d44a3d]">Mastery Tracking:</div>
            <Pretext
              text="Longitudinal mastery curves so the system can decide what to revisit and when, instead of treating every session as fresh."
              font="14px 'Inter', sans-serif"
              lineHeight={20}
              justify={false}
            />
          </li>
          <li>
            <div className="font-bold mb-1 underline decoration-[#d44a3d]">Long-Horizon Projects:</div>
            <Pretext
              text="Multi-stage assignments with milestones, deliverables, and rubrics — the path from one-off lessons toward weeks-long studio work."
              font="14px 'Inter', sans-serif"
              lineHeight={20}
              justify={false}
            />
          </li>
        </ul>
        <h3 className="font-bold mt-4 mb-2">A Sharper KEATING</h3>
        <p className="text-sm mb-4">
          The CLI logo was misaligned (the &quot;T&quot; was lopsided and the rows
          drifted). It has been rebuilt in the ANSI Shadow font so the shell now
          matches the web. The web boot screen also picked up a vertical emerald
          gradient and a subtle CRT-style glow.
        </p>
        <h3 className="font-bold mt-4 mb-2">Recorded Workflows</h3>
        <p className="text-sm mb-4">
          Four new <Code>vhs</Code> tapes live in <Code>docs/</Code> and record
          the workflows we actually demo. The rendered videos:
        </p>
        <div className="space-y-5 mb-4">
          <figure>
            <figcaption className="text-xs text-[#64748b] mb-1">
              <Code>intro.tape</Code> — boot the Keating shell, show the refreshed logo, list commands.
            </figcaption>
            <video
              src="/tapes/intro.mp4"
              controls
              muted
              loop
              playsInline
              className="w-full rounded border border-[#1f2937]"
            />
          </figure>
          <figure>
            <figcaption className="text-xs text-[#64748b] mb-1">
              <Code>learning-flow.tape</Code> — <Code>plan → map → animate → verify → trace</Code>.
            </figcaption>
            <video
              src="/tapes/learning-flow.mp4"
              controls
              muted
              loop
              playsInline
              className="w-full rounded border border-[#1f2937]"
            />
          </figure>
          <figure>
            <figcaption className="text-xs text-[#64748b] mb-1">
              <Code>improve-flow.tape</Code> — <Code>bench → evolve → prompt-evolve → improve</Code>.
            </figcaption>
            <video
              src="/tapes/improve-flow.mp4"
              controls
              muted
              loop
              playsInline
              className="w-full rounded border border-[#1f2937]"
            />
          </figure>
          <figure>
            <figcaption className="text-xs text-[#64748b] mb-1">
              <Code>feedback-flow.tape</Code> — record signals, then <Code>due</Code> and <Code>timeline</Code>.
            </figcaption>
            <video
              src="/tapes/feedback-flow.mp4"
              controls
              muted
              loop
              playsInline
              className="w-full rounded border border-[#1f2937]"
            />
          </figure>
        </div>
        <p className="text-sm mb-2">Render any of them yourself with:</p>
        <CodeBlock>{`vhs docs/learning-flow.tape`}</CodeBlock>
        <h3 className="font-bold mt-4 mb-2">Plumbing</h3>
        <ul className="text-sm space-y-2 ml-4 mb-4">
          <li><strong>Command Spec Registry</strong> — <Code>core/commands.ts</Code> is now the single source of truth for CLI/shell command surfaces.</li>
          <li><strong>Terminal &amp; Theme Modules</strong> — palette, ASCII headers, and section helpers extracted to <Code>core/terminal.ts</Code> and <Code>core/theme.ts</Code>.</li>
          <li><strong>Browser Tools / Storage</strong> — broader tool surfaces and persistence improvements in <Code>web/src/keating/</Code>.</li>
        </ul>
        <div className="text-sm text-[#64748b] mt-6">
          <Pretext
            text="The new engines ship as libraries first; CLI subcommands and web UI surfaces will land behind them in the next point releases."
            font="italic 14px 'Inter', sans-serif"
            lineHeight={20}
          />
        </div>
      </>
    ),
  },
  {
    date: "2026-04-10",
    badge: { label: "RELEASE", color: "release" },
    title: "From Stubs to Reality: AI-Powered Pedagogical Verification",
    body: (
      <>
        <div className="mb-4">
          <Pretext 
            text="Today we've completed a major architectural shift: moving from deterministic mathematical stubs to true AI-powered verification across our core pedagogical engines."
            font="16px 'Inter', sans-serif"
            lineHeight={24}
          />
        </div>
        <h3 className="font-bold mt-4 mb-2">What's New?</h3>
        <ul className="text-sm space-y-4 ml-4 mb-4">
          <li>
            <div className="font-bold mb-1 underline decoration-[#d44a3d]">Real-Time Animation Generation:</div>
            <Pretext 
              text="The animation engine no longer relies on hardcoded ManimJS templates. It now uses the pi agent to generate custom, context-aware visual teaching beats for any topic."
              font="14px 'Inter', sans-serif"
              lineHeight={20}
              justify={false}
            />
          </li>
          <li>
            <div className="font-bold mb-1 underline decoration-[#d44a3d]">Realistic Teaching Simulations:</div>
            <Pretext 
              text="Our synthetic benchmarks now use LLM-backed simulations to evaluate teaching outcomes (mastery, retention, confusion) instead of algebraic approximations."
              font="14px 'Inter', sans-serif"
              lineHeight={20}
              justify={false}
            />
          </li>
          <li>
            <div className="font-bold mb-1 underline decoration-[#d44a3d]">Dynamic Learner Profiles:</div>
            <Pretext 
              text="Learner state updates are now driven by AI-inferred pedagogical shifts based on historical performance and feedback."
              font="14px 'Inter', sans-serif"
              lineHeight={20}
              justify={false}
            />
          </li>
          <li>
            <div className="font-bold mb-1 underline decoration-[#d44a3d]">Research Paper Integration:</div>
            <Pretext 
              text="The formal account of the Keating metaharness is now served directly in the web application with a dedicated [PAPER] section and PDF download."
              font="14px 'Inter', sans-serif"
              lineHeight={20}
              justify={false}
            />
          </li>
        </ul>
        <div className="text-sm text-[#64748b] mt-6">
          <Pretext 
            text="These changes ensure that Keating's 'self-improvement' loop is grounded in actual semantic understanding rather than pre-baked formulas."
            font="italic 14px 'Inter', sans-serif"
            lineHeight={20}
          />
        </div>
      </>
    ),
  },
  {
    date: "2026-04-10",
    badge: { label: "TECH", color: "tech" },
    title: "Power Move: Migrating to Nitro + Vite",
    body: (
      <>
        <p className="mb-4">
          We've leveled up the Keating server stack by migrating to <Code>Nitro</Code> and{" "}
          <Code>Vite</Code>. This provides a high-performance, completely runtime-agnostic
          engine that integrates directly with our build pipeline.
        </p>
        <h3 className="font-bold mt-4 mb-2">Why Nitro?</h3>
        <ul className="text-sm space-y-2 ml-4 mb-4">
          <li>
            <strong>Universal Deployment:</strong> Nitro allows Keating to run seamlessly on
            Node.js, Bun, or even edge workers with zero code changes.
          </li>
          <li>
            <strong>Vite Integration:</strong> The server and client now share a unified
            build process, making the developer experience much smoother.
          </li>
          <li>
            <strong>Optimized Output:</strong> The new build generates a standalone{" "}
            <Code>.output</Code> directory that bundle everything needed to run the
            Web UI, reducing overhead.
          </li>
        </ul>
        <p className="text-sm text-[#64748b]">
          The CLI has been updated to launch this new engine automatically—just run{" "}
          <Code>keating web</Code> and experience the speed.
        </p>
      </>
    ),
  },
  {
    date: "2026-04-09",
    badge: { label: "FIX", color: "fix" },
    title: "Chat Model Selector Now Reflects the Actual Choice",
    body: (
      <>
        <p className="mb-4">
          Fixed the web UI bug where the chat window kept showing{" "}
          <Code>gemini-3.1-pro-preview</Code> even after picking a different model. The selected
          model now updates the agent state directly, so the chat button and the runtime stay in
          sync.
        </p>
        <h3 className="font-bold mt-4 mb-2">What Changed</h3>
        <ul className="text-sm space-y-2 ml-4 mb-4">
          <li>
            <strong>State Sync:</strong> Selecting a model now writes the chosen model back into
            the active agent state instead of leaving the old Gemini placeholder in place.
          </li>
          <li>
            <strong>Immediate Rerender:</strong> The model button in the chat window refreshes as
            soon as a new model is chosen.
          </li>
          <li>
            <strong>Browser Path:</strong> The local browser model is now represented as a real
            model object, so the UI can display it explicitly instead of pretending everything is
            Gemini.
          </li>
        </ul>
        <p className="text-sm text-[#64748b]">
          This fixes the mismatch between the picker and the chat header, which made it look like
          model changes were being ignored.
        </p>
      </>
    ),
  },
  {
    date: "2026-04-09",
    badge: { label: "RELEASE", color: "release" },
    title: "v0.1.3 - Synthetic Provider Support and Mobile UI Polish",
    body: (
      <>
        <p className="mb-4">
          Keating now exposes Synthetic as a first-class custom provider in the Pi settings flow.
          The provider is configured as an OpenAI-compatible endpoint at{" "}
          <Code>https://api.synthetic.new/openai/v1</Code>, with matching setup guidance in the
          tutorial.
        </p>
        <h3 className="font-bold mt-4 mb-2">Key Changes</h3>
        <ul className="text-sm space-y-2 ml-4 mb-4">
          <li>
            <strong>Synthetic Provider:</strong> Added a dedicated custom-provider entry so users
            can select Synthetic directly from the provider picker.
          </li>
          <li>
            <strong>Setup Guide:</strong> Updated the tutorial with the exact provider name, type,
            and base URL.
          </li>
          <li>
            <strong>Mobile Polish:</strong> Increased touch targets and spacing across the
            homepage, model selector, settings dialog, and install tabs.
          </li>
        </ul>
        <p className="text-sm text-[#64748b]">
          This release keeps the UI consistent with the current provider flow while making the
          browser experience less cramped on small screens.
        </p>
      </>
    ),
  },
  {
    date: "2025-04-05",
    badge: { label: "FIX", color: "fix" },
    title: "Chat Panel Fix & Model Loading Animation",
    body: (
      <>
        <p className="mb-4">
          Fixed the text disappearing issue in the chat panel that occurred after sending
          messages. Also added a one-time model loading animation when the browser model
          initializes.
        </p>
        <h3 className="font-bold mt-4 mb-2">Bug Fix: Chat Panel Lifecycle</h3>
        <p className="mb-4">
          The root cause was Lit re-rendering replacing the ChatPanel element on every state
          update. Separated the static header from the dynamic chat panel with distinct DOM
          containers. The header renders via Lit's templating, while the ChatPanel is appended
          once and never replaced.
        </p>
        <h3 className="font-bold mt-4 mb-2">New: Model Loading Overlay</h3>
        <p className="mb-4">
          When using the browser model (Gemma 4 E4B), a loading overlay now appears showing
          real-time download progress. This only shows once — the first time the model is
          loaded. Subsequent visits skip the overlay since the model is cached locally.
        </p>
        <CodeBlock>{`// Model loading state communicated via custom events
localModel.subscribe((state) => {
  if (state.loading) showLoadingOverlay(state.loadingProgress);
  if (state.loaded) hideLoadingOverlay();
});`}</CodeBlock>
        <p className="text-sm text-[#64748b]">
          The overlay includes a progress bar, percentage display, and explains that the ~2GB
          download only happens once.
        </p>
      </>
    ),
  },
  {
    date: "2025-04-05",
    badge: { label: "FEATURE", color: "feature" },
    title: "Installable PWA with Full Browser Model Integration",
    body: (
      <>
        <p className="mb-4">
          Keating is now a fully installable Progressive Web App. Install it from your browser
          and run it offline with the browser model. The WebGPU-powered Gemma 4 E4B model
          streams tokens in real-time directly in your browser.
        </p>
        <h3 className="font-bold mt-4 mb-2">Key Changes</h3>
        <ul className="text-sm space-y-2 ml-4 mb-4">
          <li>
            <strong>Browser Model → Agent:</strong> The local Gemma model is now fully wired
            into the Agent infrastructure. Token streaming works via a custom stream function
            that dispatches between WebGPU and cloud providers.
          </li>
          <li>
            <strong>Automatic Fallback:</strong> On load, the app checks for WebGPU support. If
            unavailable, it automatically falls back to <Code>gemini-3.1-pro-preview</Code>.
          </li>
          <li>
            <strong>Model Selector:</strong> The model selector now shows WebGPU status in
            real-time. Browser option is disabled with a clear message when WebGPU isn't
            available.
          </li>
          <li>
            <strong>PWA Manifest:</strong> Added service worker with intelligent caching for
            WASM files and model weights from HuggingFace CDN.
          </li>
        </ul>
        <h3 className="font-bold mt-4 mb-2">How It Works</h3>
        <CodeBlock>{`// Hybrid stream function dispatches based on model selection
const hybridStreamFn = async (model, context, options) => {
  if (selectedModelId === 'browser' && webGpuAvailable) {
    return createBrowserStreamFn()(model, context, options);
  }
  return streamSimple(model, context, options);
};`}</CodeBlock>
        <p className="text-sm text-[#64748b]">
          Install: Visit keating.help in Chrome/Edge and click "Install" in the address bar, or
          use the browser's menu → "Install app".
        </p>
      </>
    ),
  },
  {
    date: "2025-04-05",
    badge: { label: "UPDATE", color: "update" },
    title: "Default Cloud Model: Gemini 3.1 Pro Preview",
    body: (
      <>
        <p className="mb-4">
          Updated the default cloud model from <Code>gemini-2.5-pro</Code> to{" "}
          <Code>gemini-3.1-pro-preview</Code>. This gives access to the latest Gemini
          capabilities when WebGPU is unavailable.
        </p>
        <p className="text-sm text-[#64748b]">
          The model selector UI has been updated to reflect this change, showing "Gemini 3.1 Pro
          Preview" instead of the previous version.
        </p>
      </>
    ),
  },
  {
    date: "2025-04-05",
    badge: { label: "TECH", color: "tech" },
    title: "Robust WebGPU Detection",
    body: (
      <>
        <p className="mb-4">
          The model selector now performs async WebGPU detection before rendering. This prevents
          the UI from showing the browser option when it won't actually work.
        </p>
        <CodeBlock>{`async checkWebGpu(): Promise<boolean> {
  if (!navigator.gpu) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}`}</CodeBlock>
        <p className="text-sm text-[#64748b]">
          If WebGPU is unavailable, the browser model option shows "WebGPU not available" and is
          grayed out.
        </p>
      </>
    ),
  },
  {
    date: "2025-01-15",
    badge: { label: "FEATURE", color: "feature" },
    title: "Local Model Support via WebGPU",
    body: (
      <>
        <p className="mb-4">
          Keating now runs entirely in your browser using WebGPU. Run Gemma 4 E4B locally
          without any API keys. The model loads progressively and caches in your browser for
          subsequent sessions.
        </p>
        <p className="text-sm text-[#64748b]">
          Requires Chrome 113+ or Edge 113+ with WebGPU support. Model size: ~5GB cached
          locally.
        </p>
      </>
    ),
  },
  {
    date: "2025-01-10",
    badge: { label: "RELEASE", color: "release" },
    title: "v0.1.0 - Initial Public Release",
    body: (
      <>
        <p className="mb-4">
          First public release of Keating hyperteacher. Built on the Pi agent framework with
          support for Google Gemini, Anthropic Claude, and OpenAI GPT models. Features Socratic
          teaching methodology with diagnostic-first approach.
        </p>
        <ul className="text-sm space-y-1 ml-4">
          <li>- Chat-based teaching interface</li>
          <li>- Multi-provider support</li>
          <li>- Local session persistence</li>
          <li>- Dark mode support</li>
        </ul>
      </>
    ),
  },
  {
    date: "2025-01-05",
    badge: { label: "DEV LOG", color: "devlog" },
    title: "The Hyperteacher Philosophy",
    body: (
      <>
        <p className="mb-4">
          Keating is named after John Keating from Dead Poets Society, who taught that the
          purpose of education is not to fill minds but to ignite them. Our AI doesn't give
          answers — it forces you to reconstruct understanding from memory.
        </p>
        <p className="text-sm text-[#64748b]">
          Core principle: struggle is the feature, not the bug. Neural pathways form through
          effort.
        </p>
      </>
    ),
  },
];

export function Blog() {
  return (
    <div className="retro-layout retro-page">
      <Nav />

      <main className="pt-28 pb-16 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="paper-fold distressed-border p-8 mb-8">
            <h1 className="text-3xl md:text-4xl font-bold mb-2">Keating Updates</h1>
            <p className="text-[#64748b] font-terminal">Development log and release notes</p>
          </div>

          <div className="space-y-6">
            {POSTS.map((post, i) => (
              <article key={i} className="paper-fold distressed-border p-6 post-card">
                <div className="flex items-center gap-3 mb-3">
                  <span className="font-terminal text-[#d44a3d]">{post.date}</span>
                  <span
                    className={`text-xs px-2 py-1 rounded ${BADGE_CLASSES[post.badge.color]}`}
                  >
                    {post.badge.label}
                  </span>
                </div>
                <h2 className="text-xl font-bold mb-3">{post.title}</h2>
                {post.body}
              </article>
            ))}
          </div>

          <div className="mt-12 p-6 bg-[#1a1a1a] text-[#f4f1ea]">
            <h3 className="font-terminal text-lg mb-2">STAY_UPDATED</h3>
            <p className="text-sm text-[#f4f1ea]/70">
              Follow development on{" "}
              <a
                href="https://github.com/Diogenesoftoronto/keating"
                className="text-[#d44a3d] underline"
              >
                GitHub
              </a>{" "}
              or watch the repository for release notifications.
            </p>
          </div>
        </div>
      </main>

      <SimpleFooter />
    </div>
  );
}

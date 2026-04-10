import { Nav } from "../components/Nav";
import { SimpleFooter } from "../components/Footer";

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
    date: "2026-04-10",
    badge: { label: "RELEASE", color: "release" },
    title: "From Stubs to Reality: AI-Powered Pedagogical Verification",
    body: (
      <>
        <p className="mb-4">
          Today we've completed a major architectural shift: moving from deterministic mathematical stubs to true AI-powered verification across our core pedagogical engines.
        </p>
        <h3 className="font-bold mt-4 mb-2">What's New?</h3>
        <ul className="text-sm space-y-2 ml-4 mb-4">
          <li>
            <strong>Real-Time Animation Generation:</strong> The animation engine no longer relies on hardcoded ManimJS templates. It now uses the <Code>pi</Code> agent to generate custom, context-aware visual teaching beats for any topic.
          </li>
          <li>
            <strong>Realistic Teaching Simulations:</strong> Our synthetic benchmarks now use LLM-backed simulations to evaluate teaching outcomes (mastery, retention, confusion) instead of algebraic approximations.
          </li>
          <li>
            <strong>Dynamic Learner Profiles:</strong> Learner state updates are now driven by AI-inferred pedagogical shifts based on historical performance and feedback.
          </li>
        </ul>
        <p className="text-sm text-[#64748b]">
          These changes ensure that Keating's "self-improvement" loop is grounded in actual semantic understanding rather than pre-baked formulas.
        </p>
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
    <div className="retro-layout">
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

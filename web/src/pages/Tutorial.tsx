import { useEffect, useMemo, useState } from "react";
import { Nav } from "../components/Nav";
import { SimpleFooter } from "../components/Footer";
import { useSeo } from "../hooks/useSeo";
import { ArrowRight } from "lucide-react";

type TutorialTab = "browser" | "ollama" | "llamacpp" | "litellm" | "cloud" | "advanced";

const GITHUB_ISSUE_URL = "https://github.com/Diogenesoftoronto/keating/issues/new";

const TABS: { id: TutorialTab; label: string }[] = [
  { id: "browser", label: "[BROWSER]" },
  { id: "ollama", label: "[OLLAMA]" },
  { id: "llamacpp", label: "[LLAMA.CPP]" },
  { id: "litellm", label: "[LITELLM]" },
  { id: "cloud", label: "[CLOUD]" },
  { id: "advanced", label: "[ADVANCED]" },
];

interface TutorialJump {
  label: string;
  detail: string;
  tab?: TutorialTab;
  targetId?: string;
  tags: string[];
}

const TUTORIAL_JUMPS: TutorialJump[] = [
  {
    label: "Understand Keating",
    detail: "What it is, how it teaches, and useful starter prompts.",
    targetId: "what-is-keating",
    tags: ["overview", "start", "prompts"],
  },
  {
    label: "Choose a model path",
    detail: "Browser, local runners, LiteLLM, or cloud providers.",
    targetId: "model-setup",
    tags: ["model", "provider", "setup"],
  },
  {
    label: "Set up API keys",
    detail: "Where keys go and links for provider dashboards.",
    tab: "cloud",
    targetId: "get-api-key",
    tags: ["api", "key", "cloud", "provider"],
  },
  {
    label: "Use OpenRouter",
    detail: "Free model setup and featured OpenRouter model IDs.",
    tab: "cloud",
    targetId: "openrouter-api-key",
    tags: ["openrouter", "free", "provider"],
  },
  {
    label: "Run locally with Ollama",
    detail: "Install Ollama and point Keating at localhost.",
    tab: "ollama",
    targetId: "tab-ollama",
    tags: ["ollama", "local", "gpu"],
  },
  {
    label: "Understand settings",
    detail: "Providers, persona, speech, interface, sharing, and proxy.",
    targetId: "settings",
    tags: ["settings", "persona", "speech", "proxy"],
  },
  {
    label: "Export or fine-tune",
    detail: "Advanced export, RunPod, and fine-tuning paths.",
    tab: "advanced",
    targetId: "fine-tune-from-keating",
    tags: ["advanced", "finetune", "export", "runpod"],
  },
  {
    label: "Report a problem",
    detail: "What to include when provider setup or the app breaks.",
    targetId: "problems",
    tags: ["bug", "support", "issue"],
  },
];

function tutorialTabFromUrl(): TutorialTab {
  if (typeof window === "undefined") return "browser";
  const requested = new URLSearchParams(window.location.search).get("tab");
  if (requested && TABS.some((tab) => tab.id === requested)) return requested as TutorialTab;
  const advancedAnchors = new Set(["unsloth-studio", "fine-tune-from-keating", "runpod-training", "doc-to-lora", "feynman-harness"]);
  if (advancedAnchors.has(window.location.hash.slice(1))) return "advanced";
  if (window.location.hash.includes("api-key") || window.location.hash === "#get-api-key") return "cloud";
  return "browser";
}

export function Tutorial() {
  useSeo({
    title: "Keating Tutorial — Getting Started",
    description: "Learn how to use Keating: Socratic AI tutoring with lesson plans, concept maps, quizzes, and local or cloud model support.",
    canonical: "https://keating.help/tutorial",
  });
  const [activeTab, setActiveTab] = useState<TutorialTab>(() => tutorialTabFromUrl());
  const [guideQuery, setGuideQuery] = useState("");

  useEffect(() => {
    const onLocationChange = () => setActiveTab(tutorialTabFromUrl());
    window.addEventListener("popstate", onLocationChange);
    window.addEventListener("hashchange", onLocationChange);
    return () => {
      window.removeEventListener("popstate", onLocationChange);
      window.removeEventListener("hashchange", onLocationChange);
    };
  }, []);

  const selectTab = (tab: TutorialTab) => {
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    url.hash = "";
    window.history.replaceState(null, "", url);
    window.requestAnimationFrame(() => window.scrollTo(scrollX, scrollY));
  };

  const jumpTo = (jump: TutorialJump) => {
    if (jump.tab) setActiveTab(jump.tab);
    const url = new URL(window.location.href);
    if (jump.tab) url.searchParams.set("tab", jump.tab);
    if (jump.targetId) url.hash = jump.targetId;
    window.history.replaceState(null, "", url);
    if (!jump.targetId) return;
    window.requestAnimationFrame(() => {
      document.getElementById(jump.targetId!)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const filteredJumps = useMemo(() => {
    const query = guideQuery.trim().toLowerCase();
    if (!query) return TUTORIAL_JUMPS;
    return TUTORIAL_JUMPS.filter((jump) =>
      [jump.label, jump.detail, ...jump.tags].join(" ").toLowerCase().includes(query),
    );
  }, [guideQuery]);

  return (
    <div className="retro-layout retro-page">
      <Nav />

      <main className="pt-6 pb-16 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="paper-fold distressed-border p-8 mb-8">
            <h1 className="text-3xl md:text-4xl font-bold mb-2">Getting Started with Keating</h1>
            <p className="text-muted-foreground font-terminal">How to learn, plan, and assess with your AI tutor</p>
          </div>

          <section className="paper-fold distressed-border p-5 mb-8">
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="text-xl font-bold mb-2">Find What You Need</h2>
                <p className="text-sm text-muted-foreground">
                  Search setup paths, settings, provider keys, and advanced workflows without
                  scanning the whole tutorial.
                </p>
              </div>
              <input
                value={guideQuery}
                onChange={(event) => setGuideQuery(event.target.value)}
                placeholder="Search tutorial topics..."
                className="w-full rounded-md border-2 border-border bg-background px-3 py-2 text-sm text-foreground"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                {filteredJumps.map((jump) => (
                  <button
                    key={jump.label}
                    type="button"
                    onClick={() => jumpTo(jump)}
                    className="tutorial-topic-card group rounded-md border-2 border-border bg-background p-3 text-left transition-colors hover:bg-muted/50"
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold">{jump.label}</span>
                      <ArrowRight
                        size={15}
                        className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary"
                        aria-hidden="true"
                      />
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground group-hover:text-foreground/80">
                      {jump.detail}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* What Is Keating */}
          <section id="what-is-keating" className="paper-fold distressed-border p-6 mb-8 scroll-mt-24">
            <h2 className="text-xl font-bold mb-4">What Is Keating?</h2>
            <p className="mb-4">
              Keating is a Socratic AI tutor. It does not give answers — it forces you to
              reconstruct understanding from memory through questions, struggle, and guided
              correction. Named after John Keating from <em>Dead Poets Society</em>, it treats
              learning as an active process.
            </p>
            <div className="grid md:grid-cols-4 gap-4 mb-4">
              {[
                { step: "1", label: "Diagnose", desc: "Keating probes what you already know before explaining anything." },
                { step: "2", label: "Struggle", desc: "You answer freely. Mistakes are expected and useful." },
                { step: "3", label: "Check", desc: "Keating verifies your reasoning against correct understanding." },
                { step: "4", label: "Build", desc: "Missing pieces are filled in through targeted explanation." },
              ].map((s) => (
                <div key={s.step} className="border border-border/30 rounded p-4">
                  <div className="font-terminal text-[#d5604b] mb-1">{s.step}. {s.label.toUpperCase()}</div>
                  <p className="text-sm text-muted-foreground">{s.desc}</p>
                </div>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              The system has 19 teaching tools — from lesson plans to concept maps to quizzes
              and benchmarked self-improvement. You drive the conversation. Keating responds.
            </p>
          </section>

          {/* Suggested Prompts */}
          <section id="suggested-prompts" className="paper-fold distressed-border p-6 mb-8 scroll-mt-24">
            <h2 className="text-xl font-bold mb-4">Suggested Prompts</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Click any prompt to copy it. Paste it into the chat to get started.
            </p>
            <div className="space-y-5">
              {[
                {
                  category: "Learn",
                  color: "#1e9b50",
                  prompts: [
                    "Explain quantum entanglement like I'm 12 years old.",
                    "Why does gradient descent work? Walk me through the intuition.",
                    "Teach me the fundamentals of supply and demand using a real-world example.",
                  ],
                },
                {
                  category: "Plan",
                  color: "#6366f1",
                  prompts: [
                    "Plan a 4-week course on machine learning fundamentals for a beginner.",
                    "Create a study roadmap for passing the AWS Solutions Architect exam.",
                    "Map out the prerequisites I need to understand transformers before reading the Attention Is All You Need paper.",
                  ],
                },
                {
                  category: "Map",
                  color: "#d97706",
                  prompts: [
                    "Draw a concept map connecting special relativity, general relativity, and cosmology.",
                    "Map the evolution of web development from HTML to modern React frameworks.",
                    "Show me how probability, statistics, and linear algebra connect in data science.",
                  ],
                },
                {
                  category: "Assess",
                  color: "#d5604b",
                  prompts: [
                    "Quiz me on the Krebs cycle. Ask questions that test deeper understanding, not memorization.",
                    "Evaluate my understanding of async/await in JavaScript by asking me to explain it from scratch.",
                    "Benchmark my knowledge of classical mechanics. Push until you find the gaps.",
                  ],
                },
                {
                  category: "Create",
                  color: "#ec4899",
                  prompts: [
                    "Animate how DNS resolution works step by step.",
                    "Create a verification checklist for a secure web API design.",
                    "Generate a set of spaced-repetition flashcards for Spanish verb conjugations.",
                  ],
                },
              ].map((group) => (
                <div key={group.category}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-terminal text-sm" style={{ color: group.color }}>
                      [{group.category.toUpperCase()}]
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {group.prompts.map((prompt) => (
                      <button
                        key={prompt}
                        className="text-left text-sm border border-border/20 rounded-md px-3 py-2 hover:bg-foreground/5 transition-colors break-words"
                        title="Click to copy"
                        onClick={() => {
                          navigator.clipboard.writeText(prompt);
                        }}
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Tool Commands Reference */}
          <section id="tool-commands" className="paper-fold distressed-border p-6 mb-8 scroll-mt-24">
            <h2 className="text-xl font-bold mb-4">Tool Commands</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Keating can invoke tools directly. Prefix your message with a command or ask
              Keating to use a specific tool.
            </p>
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              {[
                ["/plan", "Generate a structured lesson plan on a topic"],
                ["/map", "Create a concept map or knowledge graph"],
                ["/animate", "Produce a step-by-step animation of a process"],
                ["/verify", "Run a pedagogical verification checklist"],
                ["/bench", "Benchmark understanding and identify gaps"],
                ["/evolve", "Iteratively improve a teaching approach"],
                ["/quiz", "Generate a quiz with rubric and answer key"],
                ["/feedback", "Record learner feedback signals"],
                ["/due", "List upcoming work and deadlines"],
                ["/timeline", "Show learning progress over time"],
              ].map(([cmd, desc]) => (
                <div key={cmd} className="flex gap-3 items-start">
                  <code className="bg-[#1c211b] text-[#4be388] px-1.5 py-0.5 rounded shrink-0 text-xs">{cmd}</code>
                  <span className="text-muted-foreground">{desc}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Settings Explained */}
          <section id="settings" className="paper-fold distressed-border p-6 mb-8 scroll-mt-24">
            <h2 className="text-xl font-bold mb-4">Settings Explained</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Open settings with the gear icon in the chat header (on a phone, tap the{" "}
              <span className="font-terminal">[≡]</span> menu → Settings). Everything you set
              is saved in your browser — nothing is uploaded. Below is what each tab does, with
              extra notes on the parts that aren't obvious.
            </p>

            <div className="space-y-6">
              {/* Providers & Models */}
              <div className="border-l-4 border-l-[#6366f1] pl-4">
                <h3 className="font-bold mb-1">Providers &amp; Models</h3>
                <p className="text-sm text-muted-foreground mb-2">
                  Where Keating connects to a brain. Paste an API key beside a provider, or add a{" "}
                  <strong>custom provider</strong> (any OpenAI-compatible endpoint — Ollama,
                  llama.cpp, LiteLLM, Synthetic) by giving it a name and base URL. You can hide
                  providers you never use so the model picker stays short.
                </p>
                <p className="text-xs text-muted-foreground">
                  Why it exists: Keating is model-agnostic. The same tutor runs on a free browser
                  model, a local GGUF, or a frontier cloud model — you choose the tradeoff between
                  privacy, cost, and capability. Keys live only in this browser's storage.
                </p>
              </div>

              {/* Teacher Persona */}
              <div className="border-l-4 border-l-[#d5604b] pl-4">
                <h3 className="font-bold mb-1">Teacher Persona</h3>
                <p className="text-sm text-muted-foreground mb-2">
                  The editable identity and voice of your tutor — the "who" of the system prompt.
                  It ships as John Keating from <em>Dead Poets Society</em>. Edit the text to change
                  the character, tone, or values; <strong>Reset to John Keating</strong> restores
                  the default.
                </p>
                <p className="text-xs text-muted-foreground">
                  Why it's split out: the agent's tools and teaching protocol (diagnosis, quizzes,
                  goals, self-improvement) are kept separate and always apply, so editing the
                  persona can never break Keating's behavior — it only reshapes its personality.
                  Changes take effect on your next message and in all new sessions.
                </p>
              </div>

              {/* Speech & Voice */}
              <div className="border-l-4 border-l-[#1e9b50] pl-4">
                <h3 className="font-bold mb-1">Speech &amp; Voice</h3>
                <p className="text-sm text-muted-foreground mb-2">
                  Turn on spoken replies and pick a voice. Choose a built-in provider (e.g. OpenAI
                  or Gemini text-to-speech) or define a custom one with its own base URL, model, and
                  voice name.
                </p>
                <p className="text-xs text-muted-foreground">
                  Why it exists: hearing an explanation while reading helps retention, and a custom
                  endpoint lets you route speech through your own TTS server. Speech uses the
                  relevant provider key, so set that under Providers &amp; Models first.
                </p>
              </div>

              {/* Interface */}
              <div className="border-l-4 border-l-[#d97706] pl-4">
                <h3 className="font-bold mb-1">Interface</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  How the chat looks and how much of Keating's "thinking" you see. The non-obvious
                  controls:
                </p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>
                    <span className="font-medium text-foreground">Reasoning level (Off → Maximum):</span>{" "}
                    how hard the model thinks before answering. Higher levels mean deeper, slower,
                    more expensive replies — great for hard problems, overkill for quick questions.
                    Only reasoning-capable models honor it; <em>Maximum</em> works on select models.
                  </li>
                  <li>
                    <span className="font-medium text-foreground">Show tool details:</span>{" "}
                    reveals the arguments and results of each tool call inside the chat. Leave it off
                    for a clean conversation; turn it on to see exactly what Keating did (or to debug).
                  </li>
                  <li>
                    <span className="font-medium text-foreground">Show raw error details:</span>{" "}
                    prints the full provider error body instead of a short summary. Turn this on when
                    a model or key isn't working and you need the real message to fix it.
                  </li>
                  <li>
                    <span className="font-medium text-foreground">Open artifacts automatically:</span>{" "}
                    pops the side panel whenever Keating creates a plan, map, animation, quiz, or
                    benchmark, so you don't have to go looking for it.
                  </li>
                  <li>
                    <span className="font-medium text-foreground">Google web grounding:</span>{" "}
                    when a Google key is present, lets Gemini search the live web and cite sources.
                    Keep it on for current information; switch off for purely offline reasoning.
                  </li>
                  <li>
                    <span className="font-medium text-foreground">Animation renderer:</span>{" "}
                    the format Keating uses for animations — <em>Manim</em> (mathematical, film-style
                    scenes) or <em>Hyperframes</em> (lightweight in-browser frames).
                  </li>
                  <li>
                    <span className="font-medium text-foreground">Font &amp; profile image:</span>{" "}
                    cosmetic — switch between a clean sans and a terminal monospace, and set the
                    avatar shown on your messages.
                  </li>
                </ul>
              </div>

              {/* Share links */}
              <div className="border-l-4 border-l-[#ec4899] pl-4">
                <h3 className="font-bold mb-1">Share Links (under Interface)</h3>
                <p className="text-sm text-muted-foreground mb-2">
                  Controls what happens when you share a session. The three modes trade portability
                  against link length and privacy:
                </p>
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  <li>
                    <span className="font-medium text-foreground">Portable short</span> — short link
                    that opens in any browser (uses share storage when available). Best default.
                  </li>
                  <li>
                    <span className="font-medium text-foreground">Compressed snapshot</span> — embeds
                    the whole conversation inside the URL itself, so it works with no server at all.
                    The link can get long, but nothing is stored anywhere external.
                  </li>
                  <li>
                    <span className="font-medium text-foreground">Local short</span> — the shortest
                    link, but it only opens from the browser that created it (the data stays in this
                    browser's cache).
                  </li>
                </ul>
              </div>

              {/* Proxy */}
              <div className="border-l-4 border-l-[#4be388] pl-4">
                <h3 className="font-bold mb-1">Proxy</h3>
                <p className="text-sm text-muted-foreground mb-2">
                  A CORS proxy lets this browser-based app call providers that block direct
                  cross-origin requests. Toggle <strong>Use CORS Proxy</strong> and set the{" "}
                  <strong>Proxy URL</strong> (e.g.{" "}
                  <code className="bg-[#1c211b] text-[#4be388] px-1">http://localhost:3001</code>).
                </p>
                <p className="text-xs text-muted-foreground">
                  Why it exists: browsers refuse some cross-site API calls for security. Most setups
                  don't need this — reach for it only if a provider fails with a CORS error. It is
                  required for Z-AI and for Anthropic with an OAuth token. The proxy must forward
                  requests on to the upstream provider.
                </p>
              </div>
            </div>
          </section>

          <section id="problems" className="paper-fold distressed-border p-6 mb-8 scroll-mt-24">
            <h2 className="text-xl font-bold mb-3">Problems or Bugs</h2>
            <p className="text-sm text-muted-foreground">
              If Keating breaks, a provider setup fails, or a tutorial step is unclear, open a{" "}
              <a
                href={GITHUB_ISSUE_URL}
                target="_blank"
                rel="noreferrer"
                className="text-[#6366f1] underline"
              >
                GitHub issue
              </a>{" "}
              with the browser, model provider, and what you were trying to do.
            </p>
          </section>

          {/* Model Types Overview */}
          <div className="grid md:grid-cols-2 gap-6 mb-8">
            <div className="paper-fold distressed-border p-6 border-l-4 border-l-[#1e9b50]">
              <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
                <span className="text-[#1e9b50]">BROWSER</span>
                <span className="text-xs bg-[#1e9b50]/10 text-[#1e9b50] px-2 py-1 rounded">
                  ZERO SETUP
                </span>
              </h2>
              <p className="text-sm mb-3">
                Runs entirely in your browser using WebGPU. No installation, no API keys, no server.
                Just open and chat.
              </p>
              <ul className="text-sm space-y-1 text-muted-foreground">
                <li>- Uses Transformers.js + ONNX models</li>
                <li>- Model cached in browser (~5GB)</li>
                <li>- Works offline after first load</li>
                <li>- Privacy: data never leaves device</li>
              </ul>
            </div>

            <div className="paper-fold distressed-border p-6 border-l-4 border-l-[#6366f1]">
              <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
                <span className="text-[#6366f1]">LOCAL</span>
                <span className="text-xs bg-[#6366f1]/10 text-[#6366f1] px-2 py-1 rounded">
                  REQUIRES SETUP
                </span>
              </h2>
              <p className="text-sm mb-3">
                Run any model locally with Ollama, llama.cpp, LiteLLM, or llmfit. More model
                choices, better performance.
              </p>
              <ul className="text-sm space-y-1 text-muted-foreground">
                <li>- Use any GGUF model</li>
                <li>- GPU acceleration (CUDA/Metal)</li>
                <li>- No internet required</li>
                <li>- Set endpoint in settings</li>
              </ul>
            </div>
          </div>

          {/* Detailed Tabs */}
          <div id="model-setup" className="paper-fold distressed-border overflow-hidden scroll-mt-24">
            <div
              className="grid grid-cols-2 border-b-2 border-border sm:flex sm:flex-wrap"
              role="tablist"
              aria-label="Model setup options"
            >
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  className={`tab-btn font-terminal min-w-0 border-b-2 border-r-2 border-border px-3 py-3 text-center text-sm sm:border-b-0 sm:px-6 sm:text-base ${
                    activeTab === tab.id ? "active" : ""
                  }`}
                  onClick={() => selectTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Browser Tab */}
            {activeTab === "browser" && (
              <div id="tab-browser" className="p-6 scroll-mt-24">
                <h3 className="text-xl font-bold mb-4">Browser WebGPU (Zero Setup)</h3>
                <p className="mb-4">
                  The simplest option — just use Keating in a supported browser. No installation
                  required.
                </p>

                <div className="terminal-window p-4 mb-4 text-sm overflow-x-auto">
                  <p className="text-[#4be388] mb-2"># Requirements:</p>
                  <p className="ml-4 break-words">Chrome 113+ / Edge 113+ / Firefox Nightly (WebGPU flag)</p>
                  <p className="ml-4">GPU with WebGPU support (most modern GPUs)</p>
                  <p className="ml-4">~5GB free disk space for model cache</p>
                </div>

                <div className="space-y-4">
                  {[
                    "Open Keating web app in Chrome or Edge",
                    'Select "Gemma 4 E4B (Browser)" as model',
                    "Wait for model to download and cache (~5GB, one-time)",
                    "Chat! Works offline for future sessions",
                  ].map((step, i) => (
                    <div key={i} className="flex gap-3">
                      <span className="font-terminal text-[#d5604b] shrink-0">
                        0{i + 1}.
                      </span>
                      <span>{step}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-6 p-4 bg-[#1e9b50]/10 border-l-4 border-[#1e9b50]">
                  <p className="font-terminal text-[#1e9b50]">NO_API_KEY_REQUIRED</p>
                  <p className="text-sm mt-1">
                    Your conversations never leave your device. Completely private.
                  </p>
                </div>
              </div>
            )}

            {/* Ollama Tab */}
            {activeTab === "ollama" && (
              <div id="tab-ollama" className="p-6 scroll-mt-24">
                <h3 className="text-xl font-bold mb-4">Ollama</h3>
                <p className="mb-4">
                  Popular local LLM runner with excellent GPU support. Works with any GGUF model.
                </p>

                <div className="terminal-window p-4 mb-4 text-sm overflow-x-auto">
                  <p className="text-[#4be388] mb-2"># Install Ollama:</p>
                  <p className="text-[#f1ece0] break-all">curl -fsSL https://ollama.com/install.sh | sh</p>
                  <p className="text-[#4be388] mt-3 mb-2"># Pull a model:</p>
                  <p className="text-[#f1ece0]">ollama pull gemma3:4b</p>
                  <p className="text-[#4be388] mt-3 mb-2"># Start server (runs on port 11434):</p>
                  <p className="text-[#f1ece0]">ollama serve</p>
                </div>

                <div className="space-y-4">
                  <div className="flex gap-3">
                    <span className="font-terminal text-[#d5604b] shrink-0">01.</span>
                    <span>
                      Install Ollama from{" "}
                      <a
                        href="https://ollama.com"
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#6366f1] underline"
                      >
                        ollama.com
                      </a>
                    </span>
                  </div>
                  <div className="flex gap-3">
                    <span className="font-terminal text-[#d5604b] shrink-0">02.</span>
                    <span>
                      Pull your preferred model:{" "}
                      <code className="bg-[#1c211b] text-[#4be388] px-1">
                        ollama pull gemma3:4b
                      </code>
                    </span>
                  </div>
                  <div className="flex gap-3">
                    <span className="font-terminal text-[#d5604b] shrink-0">03.</span>
                    <span>In Keating settings, add custom provider:</span>
                  </div>
                </div>

                <div className="mt-4 ml-8 terminal-window p-4 text-sm overflow-x-auto">
                  <p className="text-[#4be388]">Provider: ollama</p>
                  <p className="text-[#4be388]">Base URL: http://localhost:11434</p>
                  <p className="text-[#4be388]">Model: gemma3:4b (or your model name)</p>
                </div>

                <div className="mt-6 p-4 bg-[#6366f1]/10 border-l-4 border-[#6366f1]">
                  <p className="font-terminal text-[#6366f1]">GPU_ACCELERATION</p>
                  <p className="text-sm mt-1">
                    Ollama auto-detects CUDA (NVIDIA) and Metal (macOS). No API key needed for
                    local.
                  </p>
                </div>
              </div>
            )}

            {/* llama.cpp Tab */}
            {activeTab === "llamacpp" && (
              <div id="tab-llamacpp" className="p-6 scroll-mt-24">
                <h3 className="text-xl font-bold mb-4">llama.cpp</h3>
                <p className="mb-4">
                  Lightweight C++ inference. Maximum control and performance. Runs any GGUF model.
                </p>

                <div className="terminal-window p-4 mb-4 text-sm overflow-x-auto">
                  <p className="text-[#4be388] mb-2"># Clone and build:</p>
                  <p className="text-[#f1ece0]">git clone https://github.com/ggerganov/llama.cpp</p>
                  <p className="text-[#f1ece0]">cd llama.cpp && make</p>
                  <p className="text-[#4be388] mt-3 mb-2"># Download a GGUF model:</p>
                  <p className="text-[#f1ece0] break-all">
                    wget
                    https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-UD-Q4_K_XL.gguf
                  </p>
                  <p className="text-[#4be388] mt-3 mb-2"># Run server:</p>
                  <p className="text-[#f1ece0]">
                    ./llama-server -m gemma-4-E4B-it-UD-Q4_K_XL.gguf --port 8080
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="flex gap-3">
                    <span className="font-terminal text-[#d5604b] shrink-0">01.</span>
                    <span>
                      Build llama.cpp from{" "}
                      <a
                        href="https://github.com/ggerganov/llama.cpp"
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#6366f1] underline"
                      >
                        GitHub
                      </a>
                    </span>
                  </div>
                  <div className="flex gap-3">
                    <span className="font-terminal text-[#d5604b] shrink-0">02.</span>
                    <span>Download a GGUF model from HuggingFace</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="font-terminal text-[#d5604b] shrink-0">03.</span>
                    <span>Start the server with your model</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="font-terminal text-[#d5604b] shrink-0">04.</span>
                    <span>
                      In Keating settings, add custom provider pointing to{" "}
                      <code className="bg-[#1c211b] text-[#4be388] px-1">
                        http://localhost:8080
                      </code>
                    </span>
                  </div>
                </div>

                <div className="mt-6 p-4 bg-[#d97706]/10 border-l-4 border-[#d97706]">
                  <p className="font-terminal text-[#d97706]">TIP</p>
                  <p className="text-sm mt-1">
                    Use{" "}
                    <code className="bg-[#1c211b] text-[#4be388] px-1">-ngl 99</code> to offload
                    all layers to GPU. Use{" "}
                    <code className="bg-[#1c211b] text-[#4be388] px-1">-c 8192</code> for larger
                    context.
                  </p>
                </div>
              </div>
            )}

            {/* LiteLLM Tab */}
            {activeTab === "litellm" && (
              <div id="tab-litellm" className="p-6 scroll-mt-24">
                <h3 className="text-xl font-bold mb-4">LiteLLM</h3>
                <p className="mb-4">
                  Unified API proxy that works with 100+ LLM providers. Exposes an
                  OpenAI-compatible endpoint.
                </p>

                <div className="terminal-window p-4 mb-4 text-sm overflow-x-auto">
                  <p className="text-[#4be388] mb-2"># Install:</p>
                  <p className="text-[#f1ece0]">pip install litellm</p>
                  <p className="text-[#4be388] mt-3 mb-2"># Run with a local model:</p>
                  <p className="text-[#f1ece0]">litellm --model ollama/gemma3:4b</p>
                  <p className="text-[#4be388] mt-3 mb-2"># Or with API keys (env vars):</p>
                  <p className="text-[#f1ece0]">export OPENAI_API_KEY=sk-...</p>
                  <p className="text-[#f1ece0]">export ANTHROPIC_API_KEY=sk-ant-...</p>
                  <p className="text-[#f1ece0]">litellm --port 4000</p>
                </div>

                <div className="space-y-4">
                  <div className="flex gap-3">
                    <span className="font-terminal text-[#d5604b] shrink-0">01.</span>
                    <span>
                      Install:{" "}
                      <code className="bg-[#1c211b] text-[#4be388] px-1">pip install litellm</code>
                    </span>
                  </div>
                  <div className="flex gap-3">
                    <span className="font-terminal text-[#d5604b] shrink-0">02.</span>
                    <span>
                      Set API keys as environment variables (if using cloud providers)
                    </span>
                  </div>
                  <div className="flex gap-3">
                    <span className="font-terminal text-[#d5604b] shrink-0">03.</span>
                    <span>
                      Start proxy:{" "}
                      <code className="bg-[#1c211b] text-[#4be388] px-1">
                        litellm --port 4000
                      </code>
                    </span>
                  </div>
                  <div className="flex gap-3">
                    <span className="font-terminal text-[#d5604b] shrink-0">04.</span>
                    <span>
                      Point Keating to{" "}
                      <code className="bg-[#1c211b] text-[#4be388] px-1">
                        http://localhost:4000
                      </code>
                    </span>
                  </div>
                </div>

                <div className="mt-6 p-4 bg-[#1e9b50]/10 border-l-4 border-[#1e9b50]">
                  <p className="font-terminal text-[#1e9b50]">UNIFIED_API</p>
                  <p className="text-sm mt-1">
                    LiteLLM gives you one OpenAI-compatible endpoint that can route to any provider
                    (local or cloud).
                  </p>
                </div>
              </div>
            )}

            {/* Cloud Tab */}
            {activeTab === "cloud" && (
              <div id="tab-cloud" className="p-6 scroll-mt-24">
                <h3 className="text-xl font-bold mb-4">Cloud Providers</h3>
                <p className="mb-4">
                  Use managed AI services for best performance and model variety. Requires API keys.
                </p>

                <div id="get-api-key" className="mb-6 p-4 bg-[#f1ece0]/5 border border-border">
                  <h4 className="font-bold mb-2">Where API keys go in Keating</h4>
                  <p className="text-sm text-muted-foreground">
                    Open Settings, choose Providers & Models, then paste the key beside the provider.
                    Keys stay in browser storage for the web app. In the CLI, use environment
                    variables such as <code className="bg-[#1c211b] text-[#4be388] px-1">GEMINI_API_KEY</code>.
                  </p>
                </div>

                <div id="openrouter-api-key" className="mb-6 p-4 bg-[#6366f1]/5 border border-[#6366f1]/20 scroll-mt-24">
                  <div className="flex items-center gap-2 mb-2">
                    <h4 className="font-bold text-[#6366f1]">OpenRouter — free models, no credit card required</h4>
                    <span className="rounded-full bg-[#6366f1]/15 px-2 py-0.5 text-[10px] font-semibold text-[#6366f1] uppercase tracking-wide">Free</span>
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">
                    OpenRouter gives access to many free models — a great way to start without a billing setup.
                  </p>
                  <ol className="space-y-2 text-sm mb-3">
                    <li>
                      1. Go to{" "}
                      <a
                        href="https://openrouter.ai/keys"
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#6366f1] underline"
                      >
                        openrouter.ai/keys
                      </a>
                      {" "}and create a free account
                    </li>
                    <li>2. Click "Create Key" and copy it (starts with "sk-or-...")</li>
                    <li>
                      3. In Keating Settings → Providers &amp; Models, paste the key next to <strong>openrouter</strong>
                    </li>
                    <li>
                      4. In the CLI:{" "}
                      <code className="bg-[#1c211b] text-[#4be388] px-1">export OPENROUTER_API_KEY=sk-or-...</code>
                    </li>
                  </ol>
                  <div className="text-xs text-muted-foreground">
                    <p className="font-medium mb-1">Featured free models:</p>
                    <ul className="space-y-0.5 list-disc list-inside">
                      <li><code className="text-[#6366f1]">poolside/laguna-m.1:free</code> — Poolside Laguna M.1 (recommended)</li>
                      <li><code className="text-[#6366f1]">openai/gpt-oss-120b:free</code> — OpenAI GPT-OSS 120B</li>
                      <li><code className="text-[#6366f1]">deepseek/deepseek-v4-flash:free</code> — DeepSeek V4 Flash</li>
                      <li><code className="text-[#6366f1]">google/gemma-4-31b-it:free</code> — Google Gemma 4 31B</li>
                      <li><code className="text-[#6366f1]">nvidia/nemotron-3-super-120b-a12b:free</code> — Nvidia Nemotron 120B</li>
                      <li><code className="text-[#6366f1]">moonshotai/kimi-k2.6:free</code> — MoonshotAI Kimi K2.6</li>
                    </ul>
                    <p className="mt-2">
                      Browse all free models at{" "}
                      <a href="https://openrouter.ai/collections/free-models" target="_blank" rel="noreferrer" className="text-[#6366f1] underline">
                        openrouter.ai/collections/free-models
                      </a>
                    </p>
                  </div>
                </div>

                <div id="google-api-key" className="mb-6 p-4 bg-[#4285f4]/5 border border-[#4285f4]/20 scroll-mt-24">
                  <h4 className="font-bold text-[#4285f4] mb-2">Google AI Studio (Gemini)</h4>
                  <ol className="space-y-2 text-sm">
                    <li>
                      1. Go to{" "}
                      <a
                        href="https://aistudio.google.com/app/apikey"
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#4285f4] underline"
                      >
                        aistudio.google.com/app/apikey
                      </a>
                    </li>
                    <li>2. Sign in and click "Create API Key"</li>
                    <li>3. Copy key (starts with "AIza...")</li>
                    <li>4. Paste in Keating settings</li>
                  </ol>
                  <p className="text-xs text-muted-foreground mt-2">
                    Free tier: 15 req/min, 1M tokens/day
                  </p>
                </div>

                <div className="mb-6 p-4 bg-[#d5604b]/5 border border-[#d5604b]/20">
                  <h4 className="font-bold text-[#d5604b] mb-2">Synthetic</h4>
                  <ol className="space-y-2 text-sm">
                    <li>1. Create or copy your Synthetic API key</li>
                    <li>
                      2. In Keating settings, add a custom provider named{" "}
                      <code className="bg-[#1c211b] text-[#4be388] px-1">synthetic</code>
                    </li>
                    <li>
                      3. Set the provider type to{" "}
                      <code className="bg-[#1c211b] text-[#4be388] px-1">
                        Synthetic (OpenAI Compatible)
                      </code>
                    </li>
                    <li>
                      4. Use{" "}
                      <code className="bg-[#1c211b] text-[#4be388] px-1">
                        https://api.synthetic.new/openai/v1
                      </code>{" "}
                      as the base URL
                    </li>
                  </ol>
                  <p className="text-xs text-muted-foreground mt-2">
                    Use this when you want Synthetic's hosted models through an OpenAI-compatible
                    endpoint.
                  </p>
                </div>

                <div id="anthropic-api-key" className="mb-6 p-4 bg-[#d97706]/5 border border-[#d97706]/20 scroll-mt-24">
                  <h4 className="font-bold text-[#d97706] mb-2">Anthropic (Claude)</h4>
                  <ol className="space-y-2 text-sm">
                    <li>
                      1. Go to{" "}
                      <a
                        href="https://console.anthropic.com/"
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#d97706] underline"
                      >
                        console.anthropic.com
                      </a>
                    </li>
                    <li>2. Create account and navigate to API Keys</li>
                    <li>3. Click "Create Key" and copy</li>
                    <li>4. Paste in Keating settings</li>
                  </ol>
                  <p className="text-xs text-muted-foreground mt-2">
                    Pricing: Claude Sonnet $3/M input, $15/M output
                  </p>
                </div>

                <div id="openai-api-key" className="p-4 bg-[#10a37f]/5 border border-[#10a37f]/20 scroll-mt-24">
                  <h4 className="font-bold text-[#10a37f] mb-2">OpenAI (GPT)</h4>
                  <ol className="space-y-2 text-sm">
                    <li>
                      1. Go to{" "}
                      <a
                        href="https://platform.openai.com/api-keys"
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#10a37f] underline"
                      >
                        platform.openai.com/api-keys
                      </a>
                    </li>
                    <li>2. Create account and click "Create new secret key"</li>
                    <li>3. Copy immediately (shown only once)</li>
                    <li>4. Paste in Keating settings</li>
                  </ol>
                  <p className="text-xs text-muted-foreground mt-2">
                    Pricing: GPT-4o $2.50/M input, $10/M output
                  </p>
                </div>
              </div>
            )}

            {/* Advanced Tab */}
            {activeTab === "advanced" && (
              <div id="tab-advanced" className="p-6 space-y-6 scroll-mt-24">
                <section id="unsloth-studio" className="scroll-mt-24">
                  <h3 className="text-xl font-bold mb-3">Unsloth Studio</h3>
                  <p className="mb-3">
                    Unsloth Studio gives you a no-code local UI for training and running models.
                    Use it after exporting Keating data when you want a visual fine-tuning workflow.
                  </p>
                  <div className="terminal-window p-4 text-sm overflow-x-auto">
                    <p className="text-[#4be388]"># Start Unsloth Studio</p>
                    <p className="text-[#f1ece0]">pip install unsloth</p>
                    <p className="text-[#f1ece0]">unsloth studio -H 0.0.0.0 -p 8888</p>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    Docs:{" "}
                    <a href="https://unsloth.ai/docs" target="_blank" rel="noreferrer" className="text-[#6366f1] underline">
                      unsloth.ai/docs
                    </a>
                  </p>
                </section>

                <section id="fine-tune-from-keating" className="scroll-mt-24">
                  <h3 className="text-xl font-bold mb-3">Fine-tune from Keating data</h3>
                  <p className="mb-3">
                    Keating can export lesson artifacts and tutoring sessions as ChatML or Alpaca
                    JSONL. Use the CLI or the Usage page in the web app.
                  </p>
                  <div className="terminal-window p-4 text-sm overflow-x-auto">
                    <p className="text-[#4be388]"># CLI export</p>
                    <p className="text-[#f1ece0]">keating export --finetune --source=all --format=both</p>
                    <p className="text-[#4be388] mt-3"># Web export</p>
                    <p className="text-[#f1ece0]">Open Usage → Fine-tune export → Export fine-tune data</p>
                  </div>
                </section>

                <section id="runpod-training" className="scroll-mt-24">
                  <h3 className="text-xl font-bold mb-3">RunPod training</h3>
                  <p className="mb-3">
                    The CLI export includes a RunPod README and start script. Upload the export
                    directory to a GPU pod, install requirements, and run the generated Unsloth
                    script.
                  </p>
                  <div className="terminal-window p-4 text-sm overflow-x-auto">
                    <p className="text-[#f1ece0]">pip install -r requirements.txt</p>
                    <p className="text-[#f1ece0]">python unsloth_train.py --data train.chatml.jsonl --out keating-lora</p>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    RunPod guide:{" "}
                    <a href="https://www.runpod.io/articles/guides/how-to-fine-tune-large-language-models-on-a-budget" target="_blank" rel="noreferrer" className="text-[#6366f1] underline">
                      fine-tune LLMs on a budget
                    </a>
                  </p>
                </section>

                <section id="doc-to-lora" className="scroll-mt-24">
                  <h3 className="text-xl font-bold mb-3">Doc-to-LoRA research path</h3>
                  <p>
                    Doc-to-LoRA is an advanced research direction for turning documents into LoRA
                    adapters. Treat this as experimental: export Keating's corpus, inspect it, and
                    adapt the method when you want a model to internalize a structured body of
                    course documents.
                    {" "}
                    <a href="https://pub.sakana.ai/doc-to-lora/" target="_blank" rel="noreferrer" className="text-[#6366f1] underline">
                      Read Sakana's Doc-to-LoRA article
                    </a>.
                  </p>
                </section>

                <section id="feynman-harness" className="scroll-mt-24">
                  <h3 className="text-xl font-bold mb-3">Use Feynman beside Keating</h3>
                  <p>
                    Feynman can sit next to Keating as a research and replication harness. Use it
                    for literature review, recipe generation, replication planning, and checking
                    whether a fine-tuning dataset is grounded enough before you train.
                    {" "}
                    <a href="https://feynman.is" target="_blank" rel="noreferrer" className="text-[#6366f1] underline">
                      feynman.is
                    </a>
                  </p>
                </section>
              </div>
            )}
          </div>

          {/* Security Note */}
          <section className="mt-8 bg-[#1c211b] text-[#f1ece0] p-6 border-l-4 border-[#d5604b]">
            <h3 className="font-terminal text-xl text-[#d5604b] mb-3">SECURITY_NOTE</h3>
            <p className="text-sm">
              API keys are stored locally in your browser's IndexedDB (web) or{" "}
              <code className="text-[#4be388]">~/.keating/.env</code> (CLI). They never leave your
              device. Never commit keys to git.
            </p>
          </section>
        </div>
      </main>

      <SimpleFooter />
    </div>
  );
}

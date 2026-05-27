import { useEffect, useState } from "react";
import { Nav } from "../components/Nav";
import { SimpleFooter } from "../components/Footer";
import { useSeo } from "../hooks/useSeo";

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

  useEffect(() => {
    const onLocationChange = () => setActiveTab(tutorialTabFromUrl());
    window.addEventListener("popstate", onLocationChange);
    window.addEventListener("hashchange", onLocationChange);
    return () => {
      window.removeEventListener("popstate", onLocationChange);
      window.removeEventListener("hashchange", onLocationChange);
    };
  }, []);

  useEffect(() => {
    if (!window.location.hash) return;
    window.requestAnimationFrame(() => {
      document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: "start" });
    });
  }, [activeTab]);

  const selectTab = (tab: TutorialTab) => {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    url.hash = "";
    window.history.replaceState(null, "", url);
  };

  return (
    <div className="retro-layout retro-page">
      <Nav />

      <main className="pt-6 pb-16 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="paper-fold distressed-border p-8 mb-8">
            <h1 className="text-3xl md:text-4xl font-bold mb-2">Getting Started with Keating</h1>
            <p className="text-muted-foreground font-terminal">How to learn, plan, and assess with your AI tutor</p>
          </div>

          {/* What Is Keating */}
          <section className="paper-fold distressed-border p-6 mb-8">
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
                  <div className="font-terminal text-[#d44a3d] mb-1">{s.step}. {s.label.toUpperCase()}</div>
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
          <section className="paper-fold distressed-border p-6 mb-8">
            <h2 className="text-xl font-bold mb-4">Suggested Prompts</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Click any prompt to copy it. Paste it into the chat to get started.
            </p>
            <div className="space-y-5">
              {[
                {
                  category: "Learn",
                  color: "#10b981",
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
                  color: "#d44a3d",
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
          <section className="paper-fold distressed-border p-6 mb-8">
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
                  <code className="bg-[#1a1a1a] text-[#00ff00] px-1.5 py-0.5 rounded shrink-0 text-xs">{cmd}</code>
                  <span className="text-muted-foreground">{desc}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="paper-fold distressed-border p-6 mb-8">
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
            <div className="paper-fold distressed-border p-6 border-l-4 border-l-[#10b981]">
              <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
                <span className="text-[#10b981]">BROWSER</span>
                <span className="text-xs bg-[#10b981]/10 text-[#10b981] px-2 py-1 rounded">
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
          <div className="paper-fold distressed-border overflow-hidden">
            <div className="flex border-b-2 border-border overflow-x-auto">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  className={`tab-btn font-terminal px-6 py-3 border-r-2 border-border whitespace-nowrap ${
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
              <div className="p-6">
                <h3 className="text-xl font-bold mb-4">Browser WebGPU (Zero Setup)</h3>
                <p className="mb-4">
                  The simplest option — just use Keating in a supported browser. No installation
                  required.
                </p>

                <div className="terminal-window p-4 mb-4 text-sm overflow-x-auto">
                  <p className="text-[#00ff00] mb-2"># Requirements:</p>
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
                      <span className="font-terminal text-[#d44a3d] shrink-0">
                        0{i + 1}.
                      </span>
                      <span>{step}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-6 p-4 bg-[#10b981]/10 border-l-4 border-[#10b981]">
                  <p className="font-terminal text-[#10b981]">NO_API_KEY_REQUIRED</p>
                  <p className="text-sm mt-1">
                    Your conversations never leave your device. Completely private.
                  </p>
                </div>
              </div>
            )}

            {/* Ollama Tab */}
            {activeTab === "ollama" && (
              <div className="p-6">
                <h3 className="text-xl font-bold mb-4">Ollama</h3>
                <p className="mb-4">
                  Popular local LLM runner with excellent GPU support. Works with any GGUF model.
                </p>

                <div className="terminal-window p-4 mb-4 text-sm overflow-x-auto">
                  <p className="text-[#00ff00] mb-2"># Install Ollama:</p>
                  <p className="text-[#f4f1ea] break-all">curl -fsSL https://ollama.com/install.sh | sh</p>
                  <p className="text-[#00ff00] mt-3 mb-2"># Pull a model:</p>
                  <p className="text-[#f4f1ea]">ollama pull gemma3:4b</p>
                  <p className="text-[#00ff00] mt-3 mb-2"># Start server (runs on port 11434):</p>
                  <p className="text-[#f4f1ea]">ollama serve</p>
                </div>

                <div className="space-y-4">
                  <div className="flex gap-3">
                    <span className="font-terminal text-[#d44a3d] shrink-0">01.</span>
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
                    <span className="font-terminal text-[#d44a3d] shrink-0">02.</span>
                    <span>
                      Pull your preferred model:{" "}
                      <code className="bg-[#1a1a1a] text-[#00ff00] px-1">
                        ollama pull gemma3:4b
                      </code>
                    </span>
                  </div>
                  <div className="flex gap-3">
                    <span className="font-terminal text-[#d44a3d] shrink-0">03.</span>
                    <span>In Keating settings, add custom provider:</span>
                  </div>
                </div>

                <div className="mt-4 ml-8 terminal-window p-4 text-sm overflow-x-auto">
                  <p className="text-[#00ff00]">Provider: ollama</p>
                  <p className="text-[#00ff00]">Base URL: http://localhost:11434</p>
                  <p className="text-[#00ff00]">Model: gemma3:4b (or your model name)</p>
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
              <div className="p-6">
                <h3 className="text-xl font-bold mb-4">llama.cpp</h3>
                <p className="mb-4">
                  Lightweight C++ inference. Maximum control and performance. Runs any GGUF model.
                </p>

                <div className="terminal-window p-4 mb-4 text-sm overflow-x-auto">
                  <p className="text-[#00ff00] mb-2"># Clone and build:</p>
                  <p className="text-[#f4f1ea]">git clone https://github.com/ggerganov/llama.cpp</p>
                  <p className="text-[#f4f1ea]">cd llama.cpp && make</p>
                  <p className="text-[#00ff00] mt-3 mb-2"># Download a GGUF model:</p>
                  <p className="text-[#f4f1ea] break-all">
                    wget
                    https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-UD-Q4_K_XL.gguf
                  </p>
                  <p className="text-[#00ff00] mt-3 mb-2"># Run server:</p>
                  <p className="text-[#f4f1ea]">
                    ./llama-server -m gemma-4-E4B-it-UD-Q4_K_XL.gguf --port 8080
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="flex gap-3">
                    <span className="font-terminal text-[#d44a3d] shrink-0">01.</span>
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
                    <span className="font-terminal text-[#d44a3d] shrink-0">02.</span>
                    <span>Download a GGUF model from HuggingFace</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="font-terminal text-[#d44a3d] shrink-0">03.</span>
                    <span>Start the server with your model</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="font-terminal text-[#d44a3d] shrink-0">04.</span>
                    <span>
                      In Keating settings, add custom provider pointing to{" "}
                      <code className="bg-[#1a1a1a] text-[#00ff00] px-1">
                        http://localhost:8080
                      </code>
                    </span>
                  </div>
                </div>

                <div className="mt-6 p-4 bg-[#d97706]/10 border-l-4 border-[#d97706]">
                  <p className="font-terminal text-[#d97706]">TIP</p>
                  <p className="text-sm mt-1">
                    Use{" "}
                    <code className="bg-[#1a1a1a] text-[#00ff00] px-1">-ngl 99</code> to offload
                    all layers to GPU. Use{" "}
                    <code className="bg-[#1a1a1a] text-[#00ff00] px-1">-c 8192</code> for larger
                    context.
                  </p>
                </div>
              </div>
            )}

            {/* LiteLLM Tab */}
            {activeTab === "litellm" && (
              <div className="p-6">
                <h3 className="text-xl font-bold mb-4">LiteLLM</h3>
                <p className="mb-4">
                  Unified API proxy that works with 100+ LLM providers. Exposes an
                  OpenAI-compatible endpoint.
                </p>

                <div className="terminal-window p-4 mb-4 text-sm overflow-x-auto">
                  <p className="text-[#00ff00] mb-2"># Install:</p>
                  <p className="text-[#f4f1ea]">pip install litellm</p>
                  <p className="text-[#00ff00] mt-3 mb-2"># Run with a local model:</p>
                  <p className="text-[#f4f1ea]">litellm --model ollama/gemma3:4b</p>
                  <p className="text-[#00ff00] mt-3 mb-2"># Or with API keys (env vars):</p>
                  <p className="text-[#f4f1ea]">export OPENAI_API_KEY=sk-...</p>
                  <p className="text-[#f4f1ea]">export ANTHROPIC_API_KEY=sk-ant-...</p>
                  <p className="text-[#f4f1ea]">litellm --port 4000</p>
                </div>

                <div className="space-y-4">
                  <div className="flex gap-3">
                    <span className="font-terminal text-[#d44a3d] shrink-0">01.</span>
                    <span>
                      Install:{" "}
                      <code className="bg-[#1a1a1a] text-[#00ff00] px-1">pip install litellm</code>
                    </span>
                  </div>
                  <div className="flex gap-3">
                    <span className="font-terminal text-[#d44a3d] shrink-0">02.</span>
                    <span>
                      Set API keys as environment variables (if using cloud providers)
                    </span>
                  </div>
                  <div className="flex gap-3">
                    <span className="font-terminal text-[#d44a3d] shrink-0">03.</span>
                    <span>
                      Start proxy:{" "}
                      <code className="bg-[#1a1a1a] text-[#00ff00] px-1">
                        litellm --port 4000
                      </code>
                    </span>
                  </div>
                  <div className="flex gap-3">
                    <span className="font-terminal text-[#d44a3d] shrink-0">04.</span>
                    <span>
                      Point Keating to{" "}
                      <code className="bg-[#1a1a1a] text-[#00ff00] px-1">
                        http://localhost:4000
                      </code>
                    </span>
                  </div>
                </div>

                <div className="mt-6 p-4 bg-[#10b981]/10 border-l-4 border-[#10b981]">
                  <p className="font-terminal text-[#10b981]">UNIFIED_API</p>
                  <p className="text-sm mt-1">
                    LiteLLM gives you one OpenAI-compatible endpoint that can route to any provider
                    (local or cloud).
                  </p>
                </div>
              </div>
            )}

            {/* Cloud Tab */}
            {activeTab === "cloud" && (
              <div className="p-6">
                <h3 className="text-xl font-bold mb-4">Cloud Providers</h3>
                <p className="mb-4">
                  Use managed AI services for best performance and model variety. Requires API keys.
                </p>

                <div id="get-api-key" className="mb-6 p-4 bg-[#f4f1ea]/5 border border-border">
                  <h4 className="font-bold mb-2">Where API keys go in Keating</h4>
                  <p className="text-sm text-muted-foreground">
                    Open Settings, choose Providers & Models, then paste the key beside the provider.
                    Keys stay in browser storage for the web app. In the CLI, use environment
                    variables such as <code className="bg-[#1a1a1a] text-[#00ff00] px-1">GEMINI_API_KEY</code>.
                  </p>
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

                <div className="mb-6 p-4 bg-[#d44a3d]/5 border border-[#d44a3d]/20">
                  <h4 className="font-bold text-[#d44a3d] mb-2">Synthetic</h4>
                  <ol className="space-y-2 text-sm">
                    <li>1. Create or copy your Synthetic API key</li>
                    <li>
                      2. In Keating settings, add a custom provider named{" "}
                      <code className="bg-[#1a1a1a] text-[#00ff00] px-1">synthetic</code>
                    </li>
                    <li>
                      3. Set the provider type to{" "}
                      <code className="bg-[#1a1a1a] text-[#00ff00] px-1">
                        Synthetic (OpenAI Compatible)
                      </code>
                    </li>
                    <li>
                      4. Use{" "}
                      <code className="bg-[#1a1a1a] text-[#00ff00] px-1">
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
              <div className="p-6 space-y-6">
                <section id="unsloth-studio" className="scroll-mt-24">
                  <h3 className="text-xl font-bold mb-3">Unsloth Studio</h3>
                  <p className="mb-3">
                    Unsloth Studio gives you a no-code local UI for training and running models.
                    Use it after exporting Keating data when you want a visual fine-tuning workflow.
                  </p>
                  <div className="terminal-window p-4 text-sm overflow-x-auto">
                    <p className="text-[#00ff00]"># Start Unsloth Studio</p>
                    <p className="text-[#f4f1ea]">pip install unsloth</p>
                    <p className="text-[#f4f1ea]">unsloth studio -H 0.0.0.0 -p 8888</p>
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
                    <p className="text-[#00ff00]"># CLI export</p>
                    <p className="text-[#f4f1ea]">keating export --finetune --source=all --format=both</p>
                    <p className="text-[#00ff00] mt-3"># Web export</p>
                    <p className="text-[#f4f1ea]">Open Usage → Fine-tune export → Export fine-tune data</p>
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
                    <p className="text-[#f4f1ea]">pip install -r requirements.txt</p>
                    <p className="text-[#f4f1ea]">python unsloth_train.py --data train.chatml.jsonl --out keating-lora</p>
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
          <section className="mt-8 bg-[#1a1a1a] text-[#f4f1ea] p-6 border-l-4 border-[#d44a3d]">
            <h3 className="font-terminal text-xl text-[#d44a3d] mb-3">SECURITY_NOTE</h3>
            <p className="text-sm">
              API keys are stored locally in your browser's IndexedDB (web) or{" "}
              <code className="text-[#00ff00]">~/.keating/.env</code> (CLI). They never leave your
              device. Never commit keys to git.
            </p>
          </section>
        </div>
      </main>

      <SimpleFooter />
    </div>
  );
}

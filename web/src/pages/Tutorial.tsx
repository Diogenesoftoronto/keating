import { useState } from "react";
import { Nav } from "../components/Nav";
import { SimpleFooter } from "../components/Footer";

type TutorialTab = "browser" | "ollama" | "llamacpp" | "litellm" | "cloud";

const TABS: { id: TutorialTab; label: string }[] = [
  { id: "browser", label: "[BROWSER]" },
  { id: "ollama", label: "[OLLAMA]" },
  { id: "llamacpp", label: "[LLAMA.CPP]" },
  { id: "litellm", label: "[LITELLM]" },
  { id: "cloud", label: "[CLOUD]" },
];

export function Tutorial() {
  const [activeTab, setActiveTab] = useState<TutorialTab>("browser");

  return (
    <div className="retro-layout retro-page">
      <Nav />

      <main className="pt-28 pb-16 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="paper-fold distressed-border p-8 mb-8">
            <h1 className="text-3xl md:text-4xl font-bold mb-2">Model Setup Guide</h1>
            <p className="text-[#64748b] font-terminal">Choose how Keating runs AI models</p>
          </div>

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
              <ul className="text-sm space-y-1 text-[#64748b]">
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
              <ul className="text-sm space-y-1 text-[#64748b]">
                <li>- Use any GGUF model</li>
                <li>- GPU acceleration (CUDA/Metal)</li>
                <li>- No internet required</li>
                <li>- Set endpoint in settings</li>
              </ul>
            </div>
          </div>

          {/* Detailed Tabs */}
          <div className="paper-fold distressed-border overflow-hidden">
            <div className="flex border-b-2 border-[#1a1a1a] overflow-x-auto">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  className={`tab-btn font-terminal px-6 py-3 border-r-2 border-[#1a1a1a] whitespace-nowrap ${
                    activeTab === tab.id ? "active" : ""
                  }`}
                  onClick={() => setActiveTab(tab.id)}
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

                <div className="mb-6 p-4 bg-[#4285f4]/5 border border-[#4285f4]/20">
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
                  <p className="text-xs text-[#64748b] mt-2">
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
                  <p className="text-xs text-[#64748b] mt-2">
                    Use this when you want Synthetic's hosted models through an OpenAI-compatible
                    endpoint.
                  </p>
                </div>

                <div className="mb-6 p-4 bg-[#d97706]/5 border border-[#d97706]/20">
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
                  <p className="text-xs text-[#64748b] mt-2">
                    Pricing: Claude Sonnet $3/M input, $15/M output
                  </p>
                </div>

                <div className="p-4 bg-[#10a37f]/5 border border-[#10a37f]/20">
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
                  <p className="text-xs text-[#64748b] mt-2">
                    Pricing: GPT-4o $2.50/M input, $10/M output
                  </p>
                </div>
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

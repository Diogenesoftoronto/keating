import { useEffect, useMemo, useState, useTransition } from "react";
import { Nav } from "../components/Nav";
import { SimpleFooter } from "../components/Footer";
import { useSeo } from "../hooks/useSeo";
import { ArrowRight } from "lucide-react";
import { css, cx } from "../../styled-system/css";

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

const styles = {
  main: css({ pt: "1.5rem", pb: "4rem", px: "1.5rem" }),
  container: css({ maxW: "56rem", mx: "auto" }),
  heroCard: css({ p: "2rem", mb: "2rem" }),
  section: css({ p: "1.5rem", mb: "2rem", scrollMarginTop: "6rem" }),
  searchSection: css({ p: "1.25rem", mb: "2rem" }),
  h1: css({ mb: "0.5rem", fontSize: "1.875rem", fontWeight: "700", md: { fontSize: "2.25rem" } }),
  h2: css({ mb: "1rem", fontSize: "1.25rem", fontWeight: "700" }),
  h2Tight: css({ mb: "0.5rem", fontSize: "1.25rem", fontWeight: "700" }),
  h2Compact: css({ mb: "0.75rem", fontSize: "1.25rem", fontWeight: "700" }),
  h3: css({ mb: "1rem", fontSize: "1.25rem", fontWeight: "700" }),
  h3Tight: css({ mb: "0.75rem", fontSize: "1.25rem", fontWeight: "700" }),
  h4: css({ mb: "0.5rem", fontWeight: "700" }),
  muted: css({ color: "var(--muted-foreground)" }),
  mutedSmall: css({ fontSize: "0.875rem", color: "var(--muted-foreground)" }),
  mutedTiny: css({ fontSize: "0.75rem", color: "var(--muted-foreground)" }),
  paraMb4: css({ mb: "1rem" }),
  paraMb3: css({ mb: "0.75rem" }),
  paraSmallMb4: css({ mb: "1rem", fontSize: "0.875rem", color: "var(--muted-foreground)" }),
  paraSmallMb3: css({ mb: "0.75rem", fontSize: "0.875rem" }),
  stack4: css({ display: "flex", flexDir: "column", gap: "1rem" }),
  stack5: css({ "& > * + *": { mt: "1.25rem" } }),
  stack6: css({ "& > * + *": { mt: "1.5rem" } }),
  searchInput: css({
    w: "100%",
    rounded: "0.375rem",
    borderWidth: "2px",
    borderColor: "var(--border)",
    bg: "var(--background)",
    px: "0.75rem",
    py: "0.5rem",
    fontSize: "0.875rem",
    color: "var(--foreground)",
  }),
  jumpGrid: css({ display: "grid", gap: "0.75rem", sm: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" } }),
  topicCard: css({
    rounded: "0.375rem",
    borderWidth: "2px",
    borderColor: "var(--border)",
    bg: "var(--background)",
    p: "0.75rem",
    textAlign: "left",
    transition: "background-color 150ms ease, color 150ms ease",
    _hover: {
      bg: "color-mix(in srgb, var(--muted-foreground) 12%, transparent)",
      "& svg": { transform: "translateX(0.25rem)", color: "var(--primary)" },
      "& .tutorial-topic-detail": { color: "color-mix(in srgb, var(--foreground) 80%, transparent)" },
    },
  }),
  topicTop: css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }),
  topicLabel: css({ fontSize: "0.875rem", fontWeight: "600" }),
  topicIcon: css({
    flexShrink: 0,
    color: "var(--muted-foreground)",
    transition: "transform 150ms ease, color 150ms ease",
  }),
  topicDetail: css({ mt: "0.25rem", display: "block", fontSize: "0.75rem", lineHeight: "1.25rem", color: "var(--muted-foreground)" }),
  fourGrid: css({ display: "grid", gap: "1rem", mb: "1rem", md: { gridTemplateColumns: "repeat(4, minmax(0, 1fr))" } }),
  twoGrid: css({ display: "grid", gap: "1.5rem", mb: "2rem", md: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" } }),
  toolGrid: css({ display: "grid", gap: "0.75rem", fontSize: "0.875rem", sm: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" } }),
  smallCard: css({ rounded: "0.25rem", borderWidth: "1px", borderColor: "color-mix(in srgb, var(--border) 30%, transparent)", p: "1rem" }),
  accentLine: (color: string) => css({ borderLeftWidth: "4px", borderLeftColor: color, pl: "1rem" }),
  promptGroupHeader: css({ display: "flex", alignItems: "center", gap: "0.5rem", mb: "0.5rem" }),
  promptWrap: css({ display: "flex", flexWrap: "wrap", gap: "0.5rem" }),
  promptButton: css({
    textAlign: "left",
    fontSize: "0.875rem",
    borderWidth: "1px",
    borderColor: "color-mix(in srgb, var(--border) 20%, transparent)",
    rounded: "0.375rem",
    px: "0.75rem",
    py: "0.5rem",
    overflowWrap: "break-word",
    transition: "background-color 150ms ease",
    _hover: { bg: "color-mix(in srgb, var(--foreground) 5%, transparent)" },
  }),
  commandRow: css({ display: "flex", gap: "0.75rem", alignItems: "flex-start" }),
  codePill: css({ bg: "#1c211b", color: "#4be388", px: "0.375rem", py: "0.125rem", rounded: "0.25rem", flexShrink: 0, fontSize: "0.75rem" }),
  inlineCode: css({ bg: "#1c211b", color: "#4be388", px: "0.25rem" }),
  listStack2: css({ "& > * + *": { mt: "0.5rem" }, fontSize: "0.875rem", color: "var(--muted-foreground)" }),
  listStack15: css({ "& > * + *": { mt: "0.375rem" }, fontSize: "0.875rem", color: "var(--muted-foreground)" }),
  strongLabel: css({ fontWeight: "500", color: "var(--foreground)" }),
  overviewCard: (color: string) => css({ p: "1.5rem", borderLeftWidth: "4px", borderLeftColor: color }),
  badge: (color: string) => css({
    bg: `color-mix(in srgb, ${color} 10%, transparent)`,
    color,
    px: "0.5rem",
    py: "0.25rem",
    rounded: "0.25rem",
    fontSize: "0.75rem",
  }),
  headingInline: css({ mb: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "1.25rem", fontWeight: "700" }),
  tabsShell: css({ overflow: "hidden", scrollMarginTop: "6rem" }),
  tabList: css({
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    borderBottomWidth: "2px",
    borderColor: "var(--border)",
    sm: { display: "flex", flexWrap: "wrap" },
  }),
  tabButton: css({
    minW: 0,
    borderBottomWidth: "2px",
    borderRightWidth: "2px",
    borderColor: "var(--border)",
    px: "0.75rem",
    py: "0.75rem",
    textAlign: "center",
    fontSize: "0.875rem",
    sm: { borderBottomWidth: 0, px: "1.5rem", fontSize: "1rem" },
  }),
  tabPanel: css({ p: "1.5rem", scrollMarginTop: "6rem" }),
  tabPanelStack: css({ p: "1.5rem", scrollMarginTop: "6rem", "& > * + *": { mt: "1.5rem" } }),
  terminal: css({ p: "1rem", mb: "1rem", fontSize: "0.875rem", overflowX: "auto" }),
  terminalNoMb: css({ p: "1rem", fontSize: "0.875rem", overflowX: "auto" }),
  terminalIndented: css({ mt: "1rem", ml: "2rem", p: "1rem", fontSize: "0.875rem", overflowX: "auto" }),
  stepRow: css({ display: "flex", gap: "0.75rem" }),
  stepNum: css({ color: "#d5604b", flexShrink: 0 }),
  note: (color: string) => css({ mt: "1.5rem", p: "1rem", bg: `color-mix(in srgb, ${color} 10%, transparent)`, borderLeftWidth: "4px", borderColor: color }),
  infoBox: (color: string, border = "var(--border)") => css({ mb: "1.5rem", p: "1rem", bg: `color-mix(in srgb, ${color} 5%, transparent)`, borderWidth: "1px", borderColor: border, scrollMarginTop: "6rem" }),
  pill: (color: string) => css({
    rounded: "9999px",
    bg: `color-mix(in srgb, ${color} 15%, transparent)`,
    px: "0.5rem",
    py: "0.125rem",
    fontSize: "10px",
    fontWeight: "600",
    color,
    textTransform: "uppercase",
    letterSpacing: "0.025em",
  }),
  openRouterHeader: css({ display: "flex", alignItems: "center", gap: "0.5rem", mb: "0.5rem" }),
  ordered: css({ "& > * + *": { mt: "0.5rem" }, fontSize: "0.875rem" }),
  freeModels: css({ fontSize: "0.75rem", color: "var(--muted-foreground)" }),
  modelList: css({ "& > * + *": { mt: "0.125rem" }, listStyleType: "disc", listStylePosition: "inside" }),
  mt2: css({ mt: "0.5rem" }),
  mt3: css({ mt: "0.75rem" }),
  mt8: css({ mt: "2rem" }),
  textSm: css({ fontSize: "0.875rem" }),
  textXs: css({ fontSize: "0.75rem" }),
  textGreen: css({ color: "#4be388" }),
  textCream: css({ color: "#f1ece0" }),
  terminalPrompt: css({ color: "#4be388", mb: "0.5rem" }),
  terminalPromptSpaced: css({ color: "#4be388", mt: "0.75rem", mb: "0.5rem" }),
  terminalCommand: css({ color: "#f1ece0" }),
  breakAll: css({ overflowWrap: "anywhere" }),
  linkIndigo: css({ color: "#6366f1", textDecoration: "underline" }),
  security: css({ mt: "2rem", bg: "#1c211b", color: "#f1ece0", p: "1.5rem", borderLeftWidth: "4px", borderColor: "#d5604b" }),
  securityTitle: css({ color: "#d5604b", mb: "0.75rem", fontSize: "1.25rem" }),
};

export function Tutorial() {
  useSeo({
    title: "Keating Tutorial — Getting Started",
    description: "Learn how to use Keating: Socratic AI tutoring with lesson plans, concept maps, quizzes, and local or cloud model support.",
    canonical: "https://keating.help/tutorial",
  });
  const [activeTab, setActiveTab] = useState<TutorialTab>(() => tutorialTabFromUrl());
  const [isTabPending, startTabTransition] = useTransition();
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
    startTabTransition(() => setActiveTab(tab));
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

      <main className={styles.main}>
        <div className={styles.container}>
          <div className={cx("paper-fold distressed-border", styles.heroCard)}>
            <h1 className={styles.h1}>Getting Started with Keating</h1>
            <p className={cx("font-terminal", styles.muted)}>How to learn, plan, and assess with your AI tutor</p>
          </div>

          <section className={cx("paper-fold distressed-border", styles.searchSection)}>
            <div className={styles.stack4}>
              <div>
                <h2 className={styles.h2Tight}>Find What You Need</h2>
                <p className={styles.mutedSmall}>
                  Search setup paths, settings, provider keys, and advanced workflows without
                  scanning the whole tutorial.
                </p>
              </div>
              <input
                value={guideQuery}
                onChange={(event) => setGuideQuery(event.target.value)}
                placeholder="Search tutorial topics..."
                className={styles.searchInput}
              />
              <div className={styles.jumpGrid}>
                {filteredJumps.map((jump) => (
                  <button
                    key={jump.label}
                    type="button"
                    onClick={() => jumpTo(jump)}
                    className={cx("tutorial-topic-card", styles.topicCard)}
                  >
                    <span className={styles.topicTop}>
                      <span className={styles.topicLabel}>{jump.label}</span>
                      <ArrowRight
                        size={15}
                        className={styles.topicIcon}
                        aria-hidden="true"
                      />
                    </span>
                    <span className={cx("tutorial-topic-detail", styles.topicDetail)}>
                      {jump.detail}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* What Is Keating */}
          <section id="what-is-keating" className={cx("paper-fold distressed-border", styles.section)}>
            <h2 className={styles.h2}>What Is Keating?</h2>
            <p className={styles.paraMb4}>
              Keating is a Socratic AI tutor. It does not give answers — it forces you to
              reconstruct understanding from memory through questions, struggle, and guided
              correction. Named after John Keating from <em>Dead Poets Society</em>, it treats
              learning as an active process.
            </p>
            <div className={styles.fourGrid}>
              {[
                { step: "1", label: "Diagnose", desc: "Keating probes what you already know before explaining anything." },
                { step: "2", label: "Struggle", desc: "You answer freely. Mistakes are expected and useful." },
                { step: "3", label: "Check", desc: "Keating verifies your reasoning against correct understanding." },
                { step: "4", label: "Build", desc: "Missing pieces are filled in through targeted explanation." },
              ].map((s) => (
                <div key={s.step} className={styles.smallCard}>
                  <div className={cx("font-terminal", css({ color: "#d5604b", mb: "0.25rem" }))}>{s.step}. {s.label.toUpperCase()}</div>
                  <p className={styles.mutedSmall}>{s.desc}</p>
                </div>
              ))}
            </div>
            <p className={styles.mutedSmall}>
              The system has 19 teaching tools — from lesson plans to concept maps to quizzes
              and benchmarked self-improvement. You drive the conversation. Keating responds.
            </p>
          </section>

          {/* Suggested Prompts */}
          <section id="suggested-prompts" className={cx("paper-fold distressed-border", styles.section)}>
            <h2 className={styles.h2}>Suggested Prompts</h2>
            <p className={styles.paraSmallMb4}>
              Click any prompt to copy it. Paste it into the chat to get started.
            </p>
            <div className={styles.stack5}>
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
                  <div className={styles.promptGroupHeader}>
                    <span className={cx("font-terminal", styles.textSm)} style={{ color: group.color }}>
                      [{group.category.toUpperCase()}]
                    </span>
                  </div>
                  <div className={styles.promptWrap}>
                    {group.prompts.map((prompt) => (
                      <button
                        key={prompt}
                        className={styles.promptButton}
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
          <section id="tool-commands" className={cx("paper-fold distressed-border", styles.section)}>
            <h2 className={styles.h2}>Tool Commands</h2>
            <p className={styles.paraSmallMb4}>
              Keating can invoke tools directly. Prefix your message with a command or ask
              Keating to use a specific tool.
            </p>
            <div className={styles.toolGrid}>
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
                <div key={cmd} className={styles.commandRow}>
                  <code className={styles.codePill}>{cmd}</code>
                  <span className={styles.muted}>{desc}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Settings Explained */}
          <section id="settings" className={cx("paper-fold distressed-border", styles.section)}>
            <h2 className={styles.h2}>Settings Explained</h2>
            <p className={styles.paraSmallMb4}>
              Open settings with the gear icon in the chat header (on a phone, tap the{" "}
              <span className="font-terminal">[≡]</span> menu → Settings). Everything you set
              is saved in your browser — nothing is uploaded. Below is what each tab does, with
              extra notes on the parts that aren't obvious.
            </p>

            <div className={styles.stack6}>
              {/* Providers & Models */}
              <div className={styles.accentLine("#6366f1")}>
                <h3 className={css({ fontWeight: "700", mb: "0.25rem" })}>Providers &amp; Models</h3>
                <p className={css({ fontSize: "0.875rem", color: "var(--muted-foreground)", mb: "0.5rem" })}>
                  Where Keating connects to a brain. Paste an API key beside a provider, or add a{" "}
                  <strong>custom provider</strong> (any OpenAI-compatible endpoint — Ollama,
                  llama.cpp, LiteLLM, Synthetic) by giving it a name and base URL. You can hide
                  providers you never use so the model picker stays short.
                </p>
                <p className={styles.mutedTiny}>
                  Why it exists: Keating is model-agnostic. The same tutor runs on a free browser
                  model, a local GGUF, or a frontier cloud model — you choose the tradeoff between
                  privacy, cost, and capability. Keys live only in this browser's storage.
                </p>
              </div>

              {/* Teacher Persona */}
              <div className={styles.accentLine("#d5604b")}>
                <h3 className={css({ fontWeight: "700", mb: "0.25rem" })}>Teacher Persona</h3>
                <p className={css({ fontSize: "0.875rem", color: "var(--muted-foreground)", mb: "0.5rem" })}>
                  The editable identity and voice of your tutor — the "who" of the system prompt.
                  It ships as John Keating from <em>Dead Poets Society</em>. Edit the text to change
                  the character, tone, or values; <strong>Reset to John Keating</strong> restores
                  the default.
                </p>
                <p className={styles.mutedTiny}>
                  Why it's split out: the agent's tools and teaching protocol (diagnosis, quizzes,
                  goals, self-improvement) are kept separate and always apply, so editing the
                  persona can never break Keating's behavior — it only reshapes its personality.
                  Changes take effect on your next message and in all new sessions.
                </p>
              </div>

              {/* Speech & Voice */}
              <div className={styles.accentLine("#1e9b50")}>
                <h3 className={css({ fontWeight: "700", mb: "0.25rem" })}>Speech &amp; Voice</h3>
                <p className={css({ fontSize: "0.875rem", color: "var(--muted-foreground)", mb: "0.5rem" })}>
                  Turn on spoken replies and pick a voice. Choose a built-in provider (e.g. OpenAI
                  or Gemini text-to-speech) or define a custom one with its own base URL, model, and
                  voice name.
                </p>
                <p className={styles.mutedTiny}>
                  Why it exists: hearing an explanation while reading helps retention, and a custom
                  endpoint lets you route speech through your own TTS server. Speech uses the
                  relevant provider key, so set that under Providers &amp; Models first.
                </p>
              </div>

              {/* Interface */}
              <div className={styles.accentLine("#d97706")}>
                <h3 className={css({ fontWeight: "700", mb: "0.25rem" })}>Interface</h3>
                <p className={css({ fontSize: "0.875rem", color: "var(--muted-foreground)", mb: "0.75rem" })}>
                  How the chat looks and how much of Keating's "thinking" you see. The non-obvious
                  controls:
                </p>
                <ul className={styles.listStack2}>
                  <li>
                    <span className={styles.strongLabel}>Reasoning level (Off → Maximum):</span>{" "}
                    how hard the model thinks before answering. Higher levels mean deeper, slower,
                    more expensive replies — great for hard problems, overkill for quick questions.
                    Only reasoning-capable models honor it; <em>Maximum</em> works on select models.
                  </li>
                  <li>
                    <span className={styles.strongLabel}>Show tool details:</span>{" "}
                    reveals the arguments and results of each tool call inside the chat. Leave it off
                    for a clean conversation; turn it on to see exactly what Keating did (or to debug).
                  </li>
                  <li>
                    <span className={styles.strongLabel}>Show raw error details:</span>{" "}
                    prints the full provider error body instead of a short summary. Turn this on when
                    a model or key isn't working and you need the real message to fix it.
                  </li>
                  <li>
                    <span className={styles.strongLabel}>Open artifacts automatically:</span>{" "}
                    pops the side panel whenever Keating creates a plan, map, animation, quiz, or
                    benchmark, so you don't have to go looking for it.
                  </li>
                  <li>
                    <span className={styles.strongLabel}>Google web grounding:</span>{" "}
                    when a Google key is present, lets Gemini search the live web and cite sources.
                    Keep it on for current information; switch off for purely offline reasoning.
                  </li>
                  <li>
                    <span className={styles.strongLabel}>Animation renderer:</span>{" "}
                    Keating uses <em>Hyperframes</em> for lightweight in-browser
                    scenes with player controls.
                  </li>
                  <li>
                    <span className={styles.strongLabel}>Font &amp; profile image:</span>{" "}
                    cosmetic — switch between a clean sans and a terminal monospace, and set the
                    avatar shown on your messages.
                  </li>
                </ul>
              </div>

              {/* Share links */}
              <div className={styles.accentLine("#ec4899")}>
                <h3 className={css({ fontWeight: "700", mb: "0.25rem" })}>Share Links (under Interface)</h3>
                <p className={css({ fontSize: "0.875rem", color: "var(--muted-foreground)", mb: "0.5rem" })}>
                  Controls what happens when you share a session. The three modes trade portability
                  against link length and privacy:
                </p>
                <ul className={styles.listStack15}>
                  <li>
                    <span className={styles.strongLabel}>Portable short</span> — short link
                    that opens in any browser (uses share storage when available). Best default.
                  </li>
                  <li>
                    <span className={styles.strongLabel}>Compressed snapshot</span> — embeds
                    the whole conversation inside the URL itself, so it works with no server at all.
                    The link can get long, but nothing is stored anywhere external.
                  </li>
                  <li>
                    <span className={styles.strongLabel}>Local short</span> — the shortest
                    link, but it only opens from the browser that created it (the data stays in this
                    browser's cache).
                  </li>
                </ul>
              </div>

              {/* Proxy */}
              <div className={styles.accentLine("#4be388")}>
                <h3 className={css({ fontWeight: "700", mb: "0.25rem" })}>Proxy</h3>
                <p className={css({ fontSize: "0.875rem", color: "var(--muted-foreground)", mb: "0.5rem" })}>
                  A CORS proxy lets this browser-based app call providers that block direct
                  cross-origin requests. Toggle <strong>Use CORS Proxy</strong> and set the{" "}
                  <strong>Proxy URL</strong> (e.g.{" "}
                  <code className={styles.inlineCode}>http://localhost:3001</code>).
                </p>
                <p className={styles.mutedTiny}>
                  Why it exists: browsers refuse some cross-site API calls for security. Most setups
                  don't need this — reach for it only if a provider fails with a CORS error. It is
                  required for Z-AI and for Anthropic with an OAuth token. The proxy must forward
                  requests on to the upstream provider.
                </p>
              </div>
            </div>
          </section>

          <section id="problems" className={cx("paper-fold distressed-border", styles.section)}>
            <h2 className={styles.h2Compact}>Problems or Bugs</h2>
            <p className={styles.mutedSmall}>
              If Keating breaks, a provider setup fails, or a tutorial step is unclear, open a{" "}
              <a
                href={GITHUB_ISSUE_URL}
                target="_blank"
                rel="noreferrer"
                className={styles.linkIndigo}
              >
                GitHub issue
              </a>{" "}
              with the browser, model provider, and what you were trying to do.
            </p>
          </section>

          {/* Model Types Overview */}
          <div className={styles.twoGrid}>
            <div className={cx("paper-fold distressed-border", styles.overviewCard("#1e9b50"))}>
              <h2 className={styles.headingInline}>
                <span className={css({ color: "#1e9b50" })}>BROWSER</span>
                <span className={styles.badge("#1e9b50")}>
                  ZERO SETUP
                </span>
              </h2>
              <p className={styles.paraSmallMb3}>
                Runs entirely in your browser using WebGPU. No installation, no API keys, no server.
                Just open and chat.
              </p>
              <ul className={css({ fontSize: "0.875rem", color: "var(--muted-foreground)", "& > * + *": { mt: "0.25rem" } })}>
                <li>- Uses Transformers.js + ONNX models</li>
                <li>- Model cached in browser (~5GB)</li>
                <li>- Works offline after first load</li>
                <li>- Privacy: data never leaves device</li>
              </ul>
            </div>

            <div className={cx("paper-fold distressed-border", styles.overviewCard("#6366f1"))}>
              <h2 className={styles.headingInline}>
                <span className={css({ color: "#6366f1" })}>LOCAL</span>
                <span className={styles.badge("#6366f1")}>
                  REQUIRES SETUP
                </span>
              </h2>
              <p className={styles.paraSmallMb3}>
                Run any model locally with Ollama, llama.cpp, LiteLLM, or llmfit. More model
                choices, better performance.
              </p>
              <ul className={css({ fontSize: "0.875rem", color: "var(--muted-foreground)", "& > * + *": { mt: "0.25rem" } })}>
                <li>- Use any GGUF model</li>
                <li>- GPU acceleration (CUDA/Metal)</li>
                <li>- No internet required</li>
                <li>- Set endpoint in settings</li>
              </ul>
            </div>
          </div>

          {/* Detailed Tabs */}
          <div
            id="model-setup"
            aria-busy={isTabPending}
            className={cx("paper-fold distressed-border", styles.tabsShell)}
            style={{ opacity: isTabPending ? 0.72 : 1, transition: "opacity 120ms ease-out" }}
          >
            <div
              className={styles.tabList}
              role="tablist"
              aria-label="Model setup options"
            >
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  className={cx("tab-btn font-terminal", styles.tabButton, activeTab === tab.id && "active")}
                  onClick={() => selectTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Browser Tab */}
            {activeTab === "browser" && (
              <div id="tab-browser" className={styles.tabPanel}>
                <h3 className={styles.h3}>Browser WebGPU (Zero Setup)</h3>
                <p className={styles.paraMb4}>
                  The simplest option — just use Keating in a supported browser. No installation
                  required.
                </p>

                <div className={cx("terminal-window", styles.terminal)}>
                  <p className={styles.terminalPrompt}># Requirements:</p>
                  <p className={css({ ml: "1rem", overflowWrap: "break-word" })}>Chrome 113+ / Edge 113+ / Firefox Nightly (WebGPU flag)</p>
                  <p className={css({ ml: "1rem" })}>GPU with WebGPU support (most modern GPUs)</p>
                  <p className={css({ ml: "1rem" })}>~5GB free disk space for model cache</p>
                </div>

                <div className={styles.stack4}>
                  {[
                    "Open Keating web app in Chrome or Edge",
                    'Select "Gemma 4 E4B (Browser)" as model',
                    "Wait for model to download and cache (~5GB, one-time)",
                    "Chat! Works offline for future sessions",
                  ].map((step, i) => (
                    <div key={i} className={styles.stepRow}>
                      <span className={cx("font-terminal", styles.stepNum)}>
                        0{i + 1}.
                      </span>
                      <span>{step}</span>
                    </div>
                  ))}
                </div>

                <div className={styles.note("#1e9b50")}>
                  <p className={cx("font-terminal", css({ color: "#1e9b50" }))}>NO_API_KEY_REQUIRED</p>
                  <p className={css({ fontSize: "0.875rem", mt: "0.25rem" })}>
                    Your conversations never leave your device. Completely private.
                  </p>
                </div>
              </div>
            )}

            {/* Ollama Tab */}
            {activeTab === "ollama" && (
              <div id="tab-ollama" className={styles.tabPanel}>
                <h3 className={styles.h3}>Ollama</h3>
                <p className={styles.paraMb4}>
                  Popular local LLM runner with excellent GPU support. Works with any GGUF model.
                </p>

                <div className={cx("terminal-window", styles.terminal)}>
                  <p className={styles.terminalPrompt}># Install Ollama:</p>
                  <p className={cx(styles.terminalCommand, styles.breakAll)}>curl -fsSL https://ollama.com/install.sh | sh</p>
                  <p className={styles.terminalPromptSpaced}># Pull a model:</p>
                  <p className={styles.terminalCommand}>ollama pull gemma3:4b</p>
                  <p className={styles.terminalPromptSpaced}># Start server (runs on port 11434):</p>
                  <p className={styles.terminalCommand}>ollama serve</p>
                </div>

                <div className={styles.stack4}>
                  <div className={styles.stepRow}>
                    <span className={cx("font-terminal", styles.stepNum)}>01.</span>
                    <span>
                      Install Ollama from{" "}
                      <a
                        href="https://ollama.com"
                        target="_blank"
                        rel="noreferrer"
                        className={styles.linkIndigo}
                      >
                        ollama.com
                      </a>
                    </span>
                  </div>
                  <div className={styles.stepRow}>
                    <span className={cx("font-terminal", styles.stepNum)}>02.</span>
                    <span>
                      Pull your preferred model:{" "}
                      <code className={styles.inlineCode}>
                        ollama pull gemma3:4b
                      </code>
                    </span>
                  </div>
                  <div className={styles.stepRow}>
                    <span className={cx("font-terminal", styles.stepNum)}>03.</span>
                    <span>In Keating settings, add custom provider:</span>
                  </div>
                </div>

                <div className={cx("terminal-window", styles.terminalIndented)}>
                  <p className={styles.textGreen}>Provider: ollama</p>
                  <p className={styles.textGreen}>Base URL: http://localhost:11434</p>
                  <p className={styles.textGreen}>Model: gemma3:4b (or your model name)</p>
                </div>

                <div className={styles.note("#6366f1")}>
                  <p className={cx("font-terminal", css({ color: "#6366f1" }))}>GPU_ACCELERATION</p>
                  <p className={css({ fontSize: "0.875rem", mt: "0.25rem" })}>
                    Ollama auto-detects CUDA (NVIDIA) and Metal (macOS). No API key needed for
                    local.
                  </p>
                </div>
              </div>
            )}

            {/* llama.cpp Tab */}
            {activeTab === "llamacpp" && (
              <div id="tab-llamacpp" className={styles.tabPanel}>
                <h3 className={styles.h3}>llama.cpp</h3>
                <p className={styles.paraMb4}>
                  Lightweight C++ inference. Maximum control and performance. Runs any GGUF model.
                </p>

                <div className={cx("terminal-window", styles.terminal)}>
                  <p className={styles.terminalPrompt}># Clone and build:</p>
                  <p className={styles.terminalCommand}>git clone https://github.com/ggerganov/llama.cpp</p>
                  <p className={styles.terminalCommand}>cd llama.cpp && make</p>
                  <p className={styles.terminalPromptSpaced}># Download a GGUF model:</p>
                  <p className={cx(styles.terminalCommand, styles.breakAll)}>
                    wget
                    https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-UD-Q4_K_XL.gguf
                  </p>
                  <p className={styles.terminalPromptSpaced}># Run server:</p>
                  <p className={styles.terminalCommand}>
                    ./llama-server -m gemma-4-E4B-it-UD-Q4_K_XL.gguf --port 8080
                  </p>
                </div>

                <div className={styles.stack4}>
                  <div className={styles.stepRow}>
                    <span className={cx("font-terminal", styles.stepNum)}>01.</span>
                    <span>
                      Build llama.cpp from{" "}
                      <a
                        href="https://github.com/ggerganov/llama.cpp"
                        target="_blank"
                        rel="noreferrer"
                        className={styles.linkIndigo}
                      >
                        GitHub
                      </a>
                    </span>
                  </div>
                  <div className={styles.stepRow}>
                    <span className={cx("font-terminal", styles.stepNum)}>02.</span>
                    <span>Download a GGUF model from HuggingFace</span>
                  </div>
                  <div className={styles.stepRow}>
                    <span className={cx("font-terminal", styles.stepNum)}>03.</span>
                    <span>Start the server with your model</span>
                  </div>
                  <div className={styles.stepRow}>
                    <span className={cx("font-terminal", styles.stepNum)}>04.</span>
                    <span>
                      In Keating settings, add custom provider pointing to{" "}
                      <code className={styles.inlineCode}>
                        http://localhost:8080
                      </code>
                    </span>
                  </div>
                </div>

                <div className={styles.note("#d97706")}>
                  <p className={cx("font-terminal", css({ color: "#d97706" }))}>TIP</p>
                  <p className={css({ fontSize: "0.875rem", mt: "0.25rem" })}>
                    Use{" "}
                    <code className={styles.inlineCode}>-ngl 99</code> to offload
                    all layers to GPU. Use{" "}
                    <code className={styles.inlineCode}>-c 8192</code> for larger
                    context.
                  </p>
                </div>
              </div>
            )}

            {/* LiteLLM Tab */}
            {activeTab === "litellm" && (
              <div id="tab-litellm" className={styles.tabPanel}>
                <h3 className={styles.h3}>LiteLLM</h3>
                <p className={styles.paraMb4}>
                  Unified API proxy that works with 100+ LLM providers. Exposes an
                  OpenAI-compatible endpoint.
                </p>

                <div className={cx("terminal-window", styles.terminal)}>
                  <p className={styles.terminalPrompt}># Install:</p>
                  <p className={styles.terminalCommand}>pip install litellm</p>
                  <p className={styles.terminalPromptSpaced}># Run with a local model:</p>
                  <p className={styles.terminalCommand}>litellm --model ollama/gemma3:4b</p>
                  <p className={styles.terminalPromptSpaced}># Or with API keys (env vars):</p>
                  <p className={styles.terminalCommand}>export OPENAI_API_KEY=sk-...</p>
                  <p className={styles.terminalCommand}>export ANTHROPIC_API_KEY=sk-ant-...</p>
                  <p className={styles.terminalCommand}>litellm --port 4000</p>
                </div>

                <div className={styles.stack4}>
                  <div className={styles.stepRow}>
                    <span className={cx("font-terminal", styles.stepNum)}>01.</span>
                    <span>
                      Install:{" "}
                      <code className={styles.inlineCode}>pip install litellm</code>
                    </span>
                  </div>
                  <div className={styles.stepRow}>
                    <span className={cx("font-terminal", styles.stepNum)}>02.</span>
                    <span>
                      Set API keys as environment variables (if using cloud providers)
                    </span>
                  </div>
                  <div className={styles.stepRow}>
                    <span className={cx("font-terminal", styles.stepNum)}>03.</span>
                    <span>
                      Start proxy:{" "}
                      <code className={styles.inlineCode}>
                        litellm --port 4000
                      </code>
                    </span>
                  </div>
                  <div className={styles.stepRow}>
                    <span className={cx("font-terminal", styles.stepNum)}>04.</span>
                    <span>
                      Point Keating to{" "}
                      <code className={styles.inlineCode}>
                        http://localhost:4000
                      </code>
                    </span>
                  </div>
                </div>

                <div className={styles.note("#1e9b50")}>
                  <p className={cx("font-terminal", css({ color: "#1e9b50" }))}>UNIFIED_API</p>
                  <p className={css({ fontSize: "0.875rem", mt: "0.25rem" })}>
                    LiteLLM gives you one OpenAI-compatible endpoint that can route to any provider
                    (local or cloud).
                  </p>
                </div>
              </div>
            )}

            {/* Cloud Tab */}
            {activeTab === "cloud" && (
              <div id="tab-cloud" className={styles.tabPanel}>
                <h3 className={styles.h3}>Cloud Providers</h3>
                <p className={styles.paraMb4}>
                  Use managed AI services for best performance and model variety. Requires API keys.
                </p>

                <div id="get-api-key" className={styles.infoBox("#f1ece0")}>
                  <h4 className={styles.h4}>Where API keys go in Keating</h4>
                  <p className={styles.mutedSmall}>
                    Open Settings, choose Providers & Models, then paste the key beside the provider.
                    Keys stay in browser storage for the web app. In the CLI, use environment
                    variables such as <code className={styles.inlineCode}>GEMINI_API_KEY</code>.
                  </p>
                </div>

                <div id="openrouter-api-key" className={styles.infoBox("#6366f1", "color-mix(in srgb, #6366f1 20%, transparent)")}>
                  <div className={styles.openRouterHeader}>
                    <h4 className={css({ fontWeight: "700", color: "#6366f1" })}>OpenRouter — free models, no credit card required</h4>
                    <span className={styles.pill("#6366f1")}>Free</span>
                  </div>
                  <p className={css({ fontSize: "0.875rem", color: "var(--muted-foreground)", mb: "0.75rem" })}>
                    OpenRouter gives access to many free models — a great way to start without a billing setup.
                  </p>
                  <ol className={css({ "& > * + *": { mt: "0.5rem" }, fontSize: "0.875rem", mb: "0.75rem" })}>
                    <li>
                      1. Go to{" "}
                      <a
                        href="https://openrouter.ai/keys"
                        target="_blank"
                        rel="noreferrer"
                        className={styles.linkIndigo}
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
                      <code className={styles.inlineCode}>export OPENROUTER_API_KEY=sk-or-...</code>
                    </li>
                  </ol>
                  <div className={styles.freeModels}>
                    <p className={css({ fontWeight: "500", mb: "0.25rem" })}>Featured free models:</p>
                    <ul className={styles.modelList}>
                      <li><code className={css({ color: "#6366f1" })}>poolside/laguna-m.1:free</code> — Poolside Laguna M.1 (recommended)</li>
                      <li><code className={css({ color: "#6366f1" })}>openai/gpt-oss-120b:free</code> — OpenAI GPT-OSS 120B</li>
                      <li><code className={css({ color: "#6366f1" })}>deepseek/deepseek-v4-flash:free</code> — DeepSeek V4 Flash</li>
                      <li><code className={css({ color: "#6366f1" })}>google/gemma-4-31b-it:free</code> — Google Gemma 4 31B</li>
                      <li><code className={css({ color: "#6366f1" })}>nvidia/nemotron-3-super-120b-a12b:free</code> — Nvidia Nemotron 120B</li>
                      <li><code className={css({ color: "#6366f1" })}>moonshotai/kimi-k2.6:free</code> — MoonshotAI Kimi K2.6</li>
                    </ul>
                    <p className={styles.mt2}>
                      Browse all free models at{" "}
                      <a href="https://openrouter.ai/collections/free-models" target="_blank" rel="noreferrer" className={styles.linkIndigo}>
                        openrouter.ai/collections/free-models
                      </a>
                    </p>
                  </div>
                </div>

                <div id="google-api-key" className={styles.infoBox("#4285f4", "color-mix(in srgb, #4285f4 20%, transparent)")}>
                  <h4 className={css({ fontWeight: "700", color: "#4285f4", mb: "0.5rem" })}>Google AI Studio (Gemini)</h4>
                  <ol className={styles.ordered}>
                    <li>
                      1. Go to{" "}
                      <a
                        href="https://aistudio.google.com/app/apikey"
                        target="_blank"
                        rel="noreferrer"
                        className={css({ color: "#4285f4", textDecoration: "underline" })}
                      >
                        aistudio.google.com/app/apikey
                      </a>
                    </li>
                    <li>2. Sign in and click "Create API Key"</li>
                    <li>3. Copy key (starts with "AIza...")</li>
                    <li>4. Paste in Keating settings</li>
                  </ol>
                  <p className={cx(styles.mutedTiny, styles.mt2)}>
                    Free tier: 15 req/min, 1M tokens/day
                  </p>
                </div>

                <div className={styles.infoBox("#d5604b", "color-mix(in srgb, #d5604b 20%, transparent)")}>
                  <h4 className={css({ fontWeight: "700", color: "#d5604b", mb: "0.5rem" })}>Synthetic</h4>
                  <ol className={styles.ordered}>
                    <li>1. Create or copy your Synthetic API key</li>
                    <li>
                      2. In Keating settings, add a custom provider named{" "}
                      <code className={styles.inlineCode}>synthetic</code>
                    </li>
                    <li>
                      3. Set the provider type to{" "}
                      <code className={styles.inlineCode}>
                        Synthetic (OpenAI Compatible)
                      </code>
                    </li>
                    <li>
                      4. Use{" "}
                      <code className={styles.inlineCode}>
                        https://api.synthetic.new/openai/v1
                      </code>{" "}
                      as the base URL
                    </li>
                  </ol>
                  <p className={cx(styles.mutedTiny, styles.mt2)}>
                    Use this when you want Synthetic's hosted models through an OpenAI-compatible
                    endpoint.
                  </p>
                </div>

                <div id="anthropic-api-key" className={styles.infoBox("#d97706", "color-mix(in srgb, #d97706 20%, transparent)")}>
                  <h4 className={css({ fontWeight: "700", color: "#d97706", mb: "0.5rem" })}>Anthropic (Claude)</h4>
                  <ol className={styles.ordered}>
                    <li>
                      1. Go to{" "}
                      <a
                        href="https://console.anthropic.com/"
                        target="_blank"
                        rel="noreferrer"
                        className={css({ color: "#d97706", textDecoration: "underline" })}
                      >
                        console.anthropic.com
                      </a>
                    </li>
                    <li>2. Create account and navigate to API Keys</li>
                    <li>3. Click "Create Key" and copy</li>
                    <li>4. Paste in Keating settings</li>
                  </ol>
                  <p className={cx(styles.mutedTiny, styles.mt2)}>
                    Pricing: Claude Sonnet $3/M input, $15/M output
                  </p>
                </div>

                <div id="openai-api-key" className={css({ p: "1rem", bg: "color-mix(in srgb, #10a37f 5%, transparent)", borderWidth: "1px", borderColor: "color-mix(in srgb, #10a37f 20%, transparent)", scrollMarginTop: "6rem" })}>
                  <h4 className={css({ fontWeight: "700", color: "#10a37f", mb: "0.5rem" })}>OpenAI (GPT)</h4>
                  <ol className={styles.ordered}>
                    <li>
                      1. Go to{" "}
                      <a
                        href="https://platform.openai.com/api-keys"
                        target="_blank"
                        rel="noreferrer"
                        className={css({ color: "#10a37f", textDecoration: "underline" })}
                      >
                        platform.openai.com/api-keys
                      </a>
                    </li>
                    <li>2. Create account and click "Create new secret key"</li>
                    <li>3. Copy immediately (shown only once)</li>
                    <li>4. Paste in Keating settings</li>
                  </ol>
                  <p className={cx(styles.mutedTiny, styles.mt2)}>
                    Pricing: GPT-4o $2.50/M input, $10/M output
                  </p>
                </div>
              </div>
            )}

            {/* Advanced Tab */}
            {activeTab === "advanced" && (
              <div id="tab-advanced" className={styles.tabPanelStack}>
                <section id="unsloth-studio" className={css({ scrollMarginTop: "6rem" })}>
                  <h3 className={styles.h3Tight}>Unsloth Studio</h3>
                  <p className={styles.paraMb3}>
                    Unsloth Studio gives you a no-code local UI for training and running models.
                    Use it after exporting Keating data when you want a visual fine-tuning workflow.
                  </p>
                  <div className={cx("terminal-window", styles.terminalNoMb)}>
                    <p className={styles.textGreen}># Start Unsloth Studio</p>
                    <p className={styles.textCream}>pip install unsloth</p>
                    <p className={styles.textCream}>unsloth studio -H 0.0.0.0 -p 8888</p>
                  </div>
                  <p className={cx(styles.mt3, styles.mutedSmall)}>
                    Docs:{" "}
                    <a href="https://unsloth.ai/docs" target="_blank" rel="noreferrer" className={styles.linkIndigo}>
                      unsloth.ai/docs
                    </a>
                  </p>
                </section>

                <section id="fine-tune-from-keating" className={css({ scrollMarginTop: "6rem" })}>
                  <h3 className={styles.h3Tight}>Fine-tune from Keating data</h3>
                  <p className={styles.paraMb3}>
                    Keating can export lesson artifacts and tutoring sessions as ChatML or Alpaca
                    JSONL. Use the CLI or the Usage page in the web app.
                  </p>
                  <div className={cx("terminal-window", styles.terminalNoMb)}>
                    <p className={styles.textGreen}># CLI export</p>
                    <p className={styles.textCream}>keating export --finetune --source=all --format=both</p>
                    <p className={cx(styles.textGreen, styles.mt3)}># Web export</p>
                    <p className={styles.textCream}>Open Usage → Fine-tune export → Export fine-tune data</p>
                  </div>
                </section>

                <section id="runpod-training" className={css({ scrollMarginTop: "6rem" })}>
                  <h3 className={styles.h3Tight}>RunPod training</h3>
                  <p className={styles.paraMb3}>
                    The CLI export includes a RunPod README and start script. Upload the export
                    directory to a GPU pod, install requirements, and run the generated Unsloth
                    script.
                  </p>
                  <div className={cx("terminal-window", styles.terminalNoMb)}>
                    <p className={styles.textCream}>pip install -r requirements.txt</p>
                    <p className={styles.textCream}>python unsloth_train.py --data train.chatml.jsonl --out keating-lora</p>
                  </div>
                  <p className={cx(styles.mt3, styles.mutedSmall)}>
                    RunPod guide:{" "}
                    <a href="https://www.runpod.io/articles/guides/how-to-fine-tune-large-language-models-on-a-budget" target="_blank" rel="noreferrer" className={styles.linkIndigo}>
                      fine-tune LLMs on a budget
                    </a>
                  </p>
                </section>

                <section id="doc-to-lora" className={css({ scrollMarginTop: "6rem" })}>
                  <h3 className={styles.h3Tight}>Doc-to-LoRA research path</h3>
                  <p>
                    Doc-to-LoRA is an advanced research direction for turning documents into LoRA
                    adapters. Treat this as experimental: export Keating's corpus, inspect it, and
                    adapt the method when you want a model to internalize a structured body of
                    course documents.
                    {" "}
                    <a href="https://pub.sakana.ai/doc-to-lora/" target="_blank" rel="noreferrer" className={styles.linkIndigo}>
                      Read Sakana's Doc-to-LoRA article
                    </a>.
                  </p>
                </section>

                <section id="feynman-harness" className={css({ scrollMarginTop: "6rem" })}>
                  <h3 className={styles.h3Tight}>Use Feynman beside Keating</h3>
                  <p>
                    Feynman can sit next to Keating as a research and replication harness. Use it
                    for literature review, recipe generation, replication planning, and checking
                    whether a fine-tuning dataset is grounded enough before you train.
                    {" "}
                    <a href="https://feynman.is" target="_blank" rel="noreferrer" className={styles.linkIndigo}>
                      feynman.is
                    </a>
                  </p>
                </section>
              </div>
            )}
          </div>

          {/* Security Note */}
          <section className={styles.security}>
            <h3 className={cx("font-terminal", styles.securityTitle)}>SECURITY_NOTE</h3>
            <p className={styles.textSm}>
              API keys are stored locally in your browser's IndexedDB (web) or{" "}
              <code className={styles.textGreen}>~/.keating/.env</code> (CLI). They never leave your
              device. Never commit keys to git.
            </p>
          </section>
        </div>
      </main>

      <SimpleFooter />
    </div>
  );
}

import { useMemo, useState } from "react";
import { Nav } from "../components/Nav";
import { useSeo } from "../hooks/useSeo";
import { SimpleFooter } from "../components/Footer";
import { ChevronDown, ChevronUp, Hash, Search } from "lucide-react";

type BadgeColor = "fix" | "release" | "feature" | "pwa" | "update" | "tech" | "devlog";

interface PostSection {
  id: string;
  title: string;
}

interface Post {
  date: string;
  badge: { label: string; color: BadgeColor };
  title: string;
  summary: string;
  version?: string;
  sections?: PostSection[];
  body: React.ReactNode;
}

const BADGE_CLASSES: Record<BadgeColor, string> = {
  fix: "bg-[#d97706]/10 text-[#d97706]",
  release: "bg-[#1e9b50]/10 text-[#1e9b50]",
  feature: "bg-[#1e9b50]/10 text-[#1e9b50]",
  pwa: "bg-[#6366f1]/10 text-[#6366f1]",
  update: "bg-[#d97706]/10 text-[#d97706]",
  tech: "bg-[#6366f1]/10 text-[#6366f1]",
  devlog: "bg-[#d97706]/10 text-[#d97706]",
};

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="bg-[#1c211b] text-[#f1ece0] px-1 rounded text-sm">{children}</code>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <div className="code-block mb-4 overflow-x-auto">
      <pre className="whitespace-pre-wrap break-words">{children}</pre>
    </div>
  );
}

function extractVersion(title: string): string | undefined {
  const m = title.match(/v(\d+\.\d+\.\d+)/);
  return m ? m[1] : undefined;
}

function majorMinor(version: string): string {
  return version.split(".").slice(0, 2).join(".");
}

/* ── Data ────────────────────────────────────────────────────────── */

const POSTS: Post[] = [
  {
    date: "2026-06-10",
    badge: { label: "RELEASE", color: "release" },
    title: "v1.3.0 - An Interactive Hero, Readable Chat, and a Wider Polish Pass",
    version: "1.3.0",
    summary:
      "Keating 1.3 puts a living machine on the front page: an interactive 3D CRT that boots a real terminal and hands you a session. Inside the app, Keating's replies now render on a panel that is actually readable in both themes, the conversation column is wider, and a broad retro and mobile polish pass reaches the landing page, navigation, session cards, usage charts, and settings. Underneath, the browser runtime gained portable session data and snapshot export, and every version string now flows from a single source of truth.",
    sections: [
      { id: "interactive-hero", title: "An Interactive Hero" },
      { id: "readable-chat", title: "Readable Chat" },
      { id: "retro-and-mobile-polish", title: "Retro and Mobile Polish" },
      { id: "usage-and-runtime", title: "Usage and Browser Runtime" },
      { id: "single-source-of-truth", title: "One Version, Everywhere" },
    ],
    body: (
      <>
        <p className="mb-4 leading-6">
          1.3.0 is a surface release. The teaching engine is the same Socratic
          loop, but the way you meet it - on the landing page and inside the chat -
          got a lot more deliberate. The headline is a hero you can actually
          touch, and a transcript you can actually read.
        </p>

        <h3 id="interactive-hero" className="font-bold mt-4 mb-2">An Interactive Hero</h3>
        <p className="text-sm mb-4">
          The front page now renders a 3D CRT monitor in WebGL. It is not a
          screenshot - the screen boots a live <Code>keating</Code> terminal
          sequence, the power LED and buttons respond to hover, and the mascot
          peeks over the top of the machine. The bezel carries the real brand
          lockup, and the green key on the right is a branded <Code>K</Code> that
          launches a session when you press it. On devices without WebGL the hero
          gracefully falls back to the existing 2D terminal demo, so nothing is
          lost on lower-end hardware.
        </p>
        <p className="text-sm mb-4">
          The goal is honest: the home page should feel like the tool. A retro
          machine that responds to you is a better promise than a static banner
          claiming the same thing.
        </p>

        <h3 id="readable-chat" className="font-bold mt-4 mb-2">Readable Chat</h3>
        <p className="text-sm mb-4">
          Keating's replies render on a retro panel, but that panel is now
          theme-aware instead of forced dark. In light mode it is a readable cream
          panel with dark ink and a barely-there scanline; in dark mode it becomes
          a phosphor CRT with the scanline turned up. The hard offset shadow that
          gives the brand its retro feel stays in both. The conversation column is
          also wider, so longer explanations get more comfortable line lengths
          instead of fighting a narrow box.
        </p>

        <h3 id="retro-and-mobile-polish" className="font-bold mt-4 mb-2">Retro and Mobile Polish</h3>
        <p className="text-sm mb-4">
          A broad pass tightened the rest of the interface, with particular
          attention to mobile. The landing page, navigation, footer, session
          cards, session sidebar, and session manager were all reworked, and the
          settings surface now shares reusable <Code>SettingRow</Code> and{" "}
          <Code>Toggle</Code> components with their own Storybook stories. Copy
          buttons were reworked so copying a command or block gives clear
          feedback. The shared component stories make these pieces easier to
          review in isolation rather than only inside a running session.
        </p>

        <h3 id="usage-and-runtime" className="font-bold mt-4 mb-2">Usage and Browser Runtime</h3>
        <p className="text-sm mb-4">
          The usage page and its charts were overhauled, backed by a dedicated
          chart-data pipeline and topic grouping so your learning history is
          easier to read at a glance. Under the hood, the in-browser runtime
          gained portable session data, a snapshot database, and sandbox export,
          so a session's state can travel with you. NodePod boot-file generation
          was reworked to stay aligned with the checked-in generator, keeping the
          browser sandbox bundle reproducible from the same source tree as the
          release build. New tests cover the portable data, usage charts, topic
          grouping, and snapshot paths.
        </p>

        <h3 id="single-source-of-truth" className="font-bold mt-4 mb-2">One Version, Everywhere</h3>
        <p className="text-sm mb-4">
          Version numbers used to drift between the CLI, the package shim, the web
          app, the Pi extension, and the page metadata. Now a single{" "}
          <Code>scripts/sync-version.ts</Code> reads the canonical version from the
          root <Code>package.json</Code> and writes it everywhere it appears, with{" "}
          <Code>just check-version</Code> as a read-only CI guard. The CLI reports
          it directly with <Code>keating version</Code>. It is a small thing that
          quietly removes a whole class of "which version am I actually running"
          confusion.
        </p>
      </>
    ),
  },
  {
    date: "2026-06-09",
    badge: { label: "FEATURE", color: "feature" },
    title: "KeatingBench - Ranking Teaching Models by Learner Outcomes",
    summary:
      "KeatingBench adds a separate benchmark page for comparing teaching models using shared learner sessions, replay cases, PROSPER judgement, readiness gates, and transparent methodology explainers.",
    sections: [
      { id: "why-keatingbench-exists", title: "Why KeatingBench Exists" },
      { id: "what-gets-tested", title: "What Gets Tested" },
      { id: "from-session-to-signal", title: "From Session to Signal" },
      { id: "prosper-judgement", title: "PROSPER Judgement" },
      { id: "replay-case-bank", title: "Replay Case Bank" },
      { id: "readiness-and-sparsity", title: "Readiness and Sparsity" },
      { id: "privacy-and-analytics", title: "Privacy and Analytics" },
      { id: "next-step-cross-model-replay", title: "Next Step" },
    ],
    body: (
      <>
        <p className="mb-4 leading-6">
          KeatingBench is a new benchmark surface for a narrower question than
          most model leaderboards ask: which model actually teaches better in
          learner interactions? It sits at <Code>/bench</Code>, separate from
          chat and usage, and ranks models using the session data learners choose
          to share.
        </p>
        <p className="text-sm mb-4">
          The page is deliberately closer to an evaluation dashboard than a
          release note. It shows the model leaderboard, replay evidence, PROSPER
          scoring dimensions, readiness bands, and an explainer for how each
          piece works. The goal is to make the benchmark inspectable before it is
          trusted.
        </p>

        <h3 id="why-keatingbench-exists" className="font-bold mt-4 mb-2">Why KeatingBench Exists</h3>
        <p className="text-sm mb-4">
          A generic answer-quality benchmark is not enough for a tutoring system.
          A teaching model should diagnose where the learner is, recover from
          confusion, correct mistakes, invite practice, and help the learner
          transfer the idea to a new case. KeatingBench treats those learner
          outcomes as first-class evidence.
        </p>
        <p className="text-sm mb-4">
          That also changes how data should be used. Synthetic learners can be
          useful for stress tests, but the primary benchmark should be grounded
          in real learner interaction. KeatingBench starts from shared sessions
          and local private sessions, then turns those conversations into
          replayable learner states.
        </p>

        <h3 id="what-gets-tested" className="font-bold mt-4 mb-2">What Gets Tested</h3>
        <p className="text-sm mb-4">
          KeatingBench looks for teaching moments inside learner turns. A turn
          may signal understanding, confusion, correction, transfer, retention
          need, or dissatisfaction. Those are different from simple thumbs up or
          thumbs down ratings because they reveal where the learner is in the
          teaching loop.
        </p>
        <p className="text-sm mb-4">
          The benchmark currently classifies replay stages as{" "}
          <Code>diagnosis</Code>, <Code>confusion-recovery</Code>,{" "}
          <Code>correction</Code>, <Code>transfer</Code>, and{" "}
          <Code>retention</Code>. The leaderboard shows the replay mix so a model
          with easy wins is not confused with a model that handled hard recovery
          cases.
        </p>

        <h3 id="from-session-to-signal" className="font-bold mt-4 mb-2">From Session to Signal</h3>
        <p className="text-sm mb-4">
          The data path starts with a shared or local session. KeatingBench reads
          the learner messages, extracts feedback-like signals from the learner's
          own words, and records the nearby assistant context. Each extracted
          state becomes a replay case with a normalized outcome score.
        </p>
        <CodeBlock>{`thumbs-up   -> high outcome signal
confused    -> mid-low outcome signal
thumbs-down -> low outcome signal`}</CodeBlock>
        <p className="text-sm mb-4">
          Explicit feedback remains valuable, but the benchmark also uses
          learner-turn analysis because a confused follow-up or a correction is
          meaningful evidence even when the learner never clicks a feedback
          button.
        </p>

        <h3 id="prosper-judgement" className="font-bold mt-4 mb-2">PROSPER Judgement</h3>
        <p className="text-sm mb-4">
          The headline rank is not the raw outcome score. It is a PROSPER score:
          a weighted multi-objective judgement designed to avoid rewarding narrow
          or brittle behavior. Raw outcome is still shown in the table, but it is
          only one component.
        </p>
        <CodeBlock>{`PROSPER =
  performance
  robustness
  outcome lift
  sparse-data caution
  personalization
  evidence quality
  retention / transfer`}</CodeBlock>
        <p className="text-sm mb-4">
          This means a model can rank well only when it balances learner outcome
          with evidence quality and teaching behavior. A model that gets a few
          positive signals but has little evidence remains marked as sparse.
        </p>

        <h3 id="replay-case-bank" className="font-bold mt-4 mb-2">Replay Case Bank</h3>
        <p className="text-sm mb-4">
          The replay case bank is the most important part of the page. It shows
          the learner states KeatingBench is actually using: stage, inferred
          feedback signal, learner text, outcome score, and PROSPER score. This
          makes the benchmark auditable instead of just producing a mysterious
          rank.
        </p>
        <p className="text-sm mb-4">
          The same case bank is also the foundation for cross-model replay. Once
          provider replay is wired in, the harness can send the same extracted
          learner state to multiple models and compare their responses under the
          same judgement criteria.
        </p>

        <h3 id="readiness-and-sparsity" className="font-bold mt-4 mb-2">Readiness and Sparsity</h3>
        <p className="text-sm mb-4">
          KeatingBench does not treat all data volumes equally. Sparse data is
          visible but should not drive strong conclusions or policy evolution.
          The page currently uses explicit readiness bands:
        </p>
        <CodeBlock>{`waiting      < 5 signals
sparse       >= 5 signals
provisional  >= 20 signals
rankable     >= 50 signals
stable       >= 100 signals`}</CodeBlock>
        <p className="text-sm mb-4">
          The policy-evolution gate is still stricter about caution: if the
          system does not have enough real learner signal, it should say it is
          not ready to evolve rather than pretending a thin sample is a reliable
          improvement target.
        </p>

        <h3 id="privacy-and-analytics" className="font-bold mt-4 mb-2">Privacy and Analytics</h3>
        <p className="text-sm mb-4">
          KeatingBench uses shared sessions as benchmark material only when those
          sessions are available to the app. Local private sessions stay in the
          local view. The new PostHog integration is opt-in through Vite
          environment variables, with autocapture and session recording disabled
          so learner text is not automatically sent as analytics data.
        </p>
        <p className="text-sm mb-4">
          The analytics events are aggregate events such as opening or exporting
          the benchmark. The benchmark data itself remains the session corpus,
          not a hidden analytics stream.
        </p>

        <h3 id="next-step-cross-model-replay" className="font-bold mt-4 mb-2">Next Step</h3>
        <p className="text-sm mb-4">
          The current implementation scores observed sessions deterministically.
          The next real step is provider replay: take the same replay case, send
          it to multiple models, and judge the resulting teaching move with the
          same PROSPER vector.
        </p>
        <p className="text-sm mb-4">
          That is the path from a useful local leaderboard to a proper
          KeatingBench: human-grounded cases, comparable model responses,
          transparent scoring, and enough evidence to know when the system is
          ready to evolve.
        </p>
      </>
    ),
  },
  {
    date: "2026-06-09",
    badge: { label: "RELEASE", color: "release" },
    title: "v1.2.0 - Observable Self-Evolution, Timed Quizzes, and Release Hygiene",
    version: "1.2.0",
    summary:
      "Keating 1.2 makes the self-improvement loop much easier to inspect, adds timed quiz sessions and stronger quiz result cards, quiets the browser persistence warning path, and cleans up release metadata so the CLI, package shim, web app, and generated sandbox boot files stay aligned.",
    sections: [
      { id: "observable-self-evolution", title: "Observable Self-Evolution" },
      { id: "timed-quizzes", title: "Timed Quiz Sessions" },
      { id: "debugging-surfaces", title: "Debugging Surfaces" },
      { id: "storage-and-state", title: "Storage and State" },
      { id: "release-hygiene", title: "Release Hygiene" },
    ],
    body: (
      <>
        <p className="mb-4 leading-6">
          1.2.0 is a hardening release for Keating's most sensitive loop: the
          part where the system evaluates and changes itself. The release makes
          those changes visible to humans, strengthens quiz feedback, and cleans
          up the release path so the shipped CLI and browser surfaces agree on
          what version they are running.
        </p>

        <h3 id="observable-self-evolution" className="font-bold mt-4 mb-2">Observable Self-Evolution</h3>
        <p className="text-sm mb-4">
          <Code>auto-improve</Code> now writes a more complete transaction trail:
          baseline and after snapshots, structured JSON, Mermaid diagrams,
          trace entries, and policy/prompt state that can be compared after the
          run. The web usage page gained a self-evolution health panel so recent
          improvement loops show their verdict, score delta, policy signature,
          and rollback state without asking someone to dig through hidden files.
        </p>
        <p className="text-sm mb-4">
          Prompt evolution is stricter too. If the best generated candidate
          scores worse than the current prompt, Keating records the attempt but
          does not apply it. That keeps the audit trail useful without letting a
          bad prompt candidate quietly become the new baseline.
        </p>

        <h3 id="timed-quizzes" className="font-bold mt-4 mb-2">Timed Quiz Sessions</h3>
        <p className="text-sm mb-4">
          Quiz sessions now show timing where learners expect it: before start,
          while answering, and after completion. Time-limited questions display a
          countdown, completed attempts report total time, and review rows retain
          per-question timing so slow or uncertain answers are easier to spot.
        </p>
        <p className="text-sm mb-4">
          Quiz result cards were tightened at the same time. Durations render as
          readable minute/second values, low scores use a clearer result tone,
          and light-mode contrast was raised so metadata and result details stay
          legible in chat.
        </p>

        <h3 id="debugging-surfaces" className="font-bold mt-4 mb-2">Debugging Surfaces</h3>
        <p className="text-sm mb-4">
          Tool calls are easier to inspect in the transcript. Structured
          arguments and results can render as expandable JSON views instead of
          raw preformatted dumps, which makes it faster to tell whether a tool
          received the right inputs and returned the right shape.
        </p>
        <p className="text-sm mb-4">
          Session forking also got a correctness pass. Forking from an earlier
          assistant turn now creates a branch ending at that turn, keeps the
          related tool results, and shows a banner linking back to the original
          session.
        </p>

        <h3 id="storage-and-state" className="font-bold mt-4 mb-2">Storage and State</h3>
        <p className="text-sm mb-4">
          The browser persistence request path now uses the native storage API
          directly. When a browser refuses persistent storage, Keating shows the
          durable-storage risk without spamming the console with a misleading
          permission warning. The chat state work also moves more of the web
          agent surface toward a dedicated Zustand store.
        </p>

        <h3 id="release-hygiene" className="font-bold mt-4 mb-2">Release Hygiene</h3>
        <p className="text-sm mb-4">
          The CLI help banner and package shim now report the current version
          with <Code>keating --version</Code>, and the version sync script updates
          those surfaces alongside the web app, Pi extension, HTML metadata, and
          Open Graph image. Fine-tune export scripts now live as real Python,
          Bash, requirements, and Markdown template files, and the browser
          operational protocol moved into Markdown instead of a large embedded
          prompt string. The NodePod boot-file generation task now points at the
          checked-in Bun TypeScript generator, so the browser sandbox bundle can
          be refreshed from the same source tree used by the release build. The
          generator also skips its own output, preventing recursive bundle growth
          from breaking the PWA build.
        </p>
      </>
    ),
  },
  {
    date: "2026-06-08",
    badge: { label: "FEATURE", color: "feature" },
    title: "Branch-Aware Session Forking",
    summary:
      "Forking a session now does what the name implies: the new session ends at the point you branched from instead of carrying the whole conversation forward, and a clear banner shows when you are working inside a fork with a one-click jump back to the original.",
    sections: [
      { id: "fork-truncation", title: "Forks End Where You Branch" },
      { id: "fork-indicator", title: "A Clear Fork Indicator" },
      { id: "fork-testing", title: "Tested and Storied" },
    ],
    body: (
      <>
        <p className="mb-4 leading-6">
          Forking lets you take a conversation in a new direction without losing
          the original. Until now it cloned the entire transcript no matter which
          reply you forked from, so branching off an earlier point still dragged
          every later message along. This update makes forking behave like a real
          branch and makes the branch relationship visible in the chat itself.
        </p>

        <h3 id="fork-truncation" className="font-bold mt-4 mb-2">Forks End Where You Branch</h3>
        <p className="text-sm mb-4">
          The fork button on each Keating reply now creates a session that ends
          right after that reply's turn. Everything after the branch point — the
          next question and all that followed it — is left behind in the original,
          giving you a clean, continuable starting point. The reply's tool results
          are kept with it, so the branched conversation stays coherent when you
          pick it back up.
        </p>
        <p className="text-sm mb-4">
          Because the chat folds tool results and merges consecutive assistant
          turns before rendering, the displayed position can't be mapped straight
          back to stored messages. The truncation is anchored on the forked
          reply's timestamp instead, in a small pure helper{" "}
          <Code>truncateAtForkPoint</Code> in <Code>session-metadata.ts</Code>. If
          a timestamp ever fails to match, it safely falls back to keeping the full
          conversation. Forking a whole past session from the sidebar is unchanged
          — that branch point is simply the end of the session.
        </p>

        <h3 id="fork-indicator" className="font-bold mt-4 mb-2">A Clear Fork Indicator</h3>
        <p className="text-sm mb-4">
          When the active session is a fork, a slim banner now sits under the chat
          header reading <em>Forked from "&lt;original title&gt;"</em> with an{" "}
          <strong>Open original</strong> button to jump back to the parent in one
          click. The banner is a standalone <Code>ForkBanner</Code> component, and
          it clears itself when you start a new session so it only ever shows when
          you are genuinely inside a branch.
        </p>

        <h3 id="fork-testing" className="font-bold mt-4 mb-2">Tested and Storied</h3>
        <p className="text-sm mb-4">
          The branch-point logic ships with unit tests covering the cases that
          matter: ending after the forked turn, keeping that turn's tool results,
          matching merged assistant turns, forking the final reply, and the
          no-match fallback. The project also gained a Storybook setup so isolated
          UI pieces like <Code>ForkBanner</Code> can be developed and reviewed on
          their own, including a long-title story that verifies the banner
          truncates gracefully.
        </p>
      </>
    ),
  },
  {
    date: "2026-06-03",
    badge: { label: "RELEASE", color: "release" },
    title: "v1.1.0 - Image Generation, Interactive Quizzes, and Cleaner Learning Artifacts",
    version: "1.1.0",
    summary:
      "Keating 1.1 turns the web app into a more complete learning workspace: image generation joins the tool set, lesson-plan artifacts gain an interactive quiz taker, chat output is easier to copy and inspect, MiniMax M3 is selectable, and benchmark/runtime correctness issues are fixed across CLI and browser paths.",
    sections: [
      { id: "image-generation", title: "Image Generation Tooling" },
      { id: "interactive-quizzes", title: "Interactive Lesson Quizzes" },
      { id: "chat-rendering", title: "Cleaner Chat Output" },
      { id: "artifact-viewers", title: "Artifact and Animation Viewers" },
      { id: "model-provider-updates", title: "Model and Provider Updates" },
      { id: "benchmark-runtime-fixes", title: "Benchmark and Runtime Fixes" },
      { id: "site-navigation-polish", title: "Site Navigation Polish" },
    ],
    body: (
      <>
        <p className="mb-4 leading-6">
          1.1.0 is the follow-through release for the web learning experience.
          The chat, artifact viewer, tutorial, blog, model chooser, quiz
          renderer, animation player, and benchmark plumbing all got touched so
          the app behaves more like a usable study environment and less like a
          collection of separate demos.
        </p>

        <h3 id="image-generation" className="font-bold mt-4 mb-2">Image Generation Tooling</h3>
        <p className="text-sm mb-4">
          The browser <Code>generate_image</Code> tool now supports image models
          directly, including model, size, quality, mode, and diagram-kind
          controls. When a configured provider is unavailable, Keating falls
          back to richer browser-local SVG learning diagrams instead of empty
          placeholders. That gives the tutor a path to produce infographics,
          anatomy sketches, comparison cards, and structured study visuals
          inside the same artifact flow as plans, maps, and animations.
        </p>
        <p className="text-sm mb-4">
          Generated image payloads also render in chat with copy affordances, so
          learners can keep the prompt, metadata, and generated artifact details
          instead of losing the useful parts behind a tool call.
        </p>

        <h3 id="interactive-quizzes" className="font-bold mt-4 mb-2">Interactive Lesson Quizzes</h3>
        <p className="text-sm mb-4">
          Lesson-plan artifacts now expose <Code>Lesson</Code> and{" "}
          <Code>Quiz</Code> modes. The quiz mode turns the saved plan into an
          interactive quiz taker with multiple-choice, multi-select, true/false,
          short-answer, and transfer checks. Quiz attempts are scored in-place,
          missed topics are visible, and the learner can redo a quiz with a
          stronger focus on the sections they missed.
        </p>
        <p className="text-sm mb-4">
          Adaptive quiz scoring was fixed at the same time: remedial fallback
          questions that are skipped because the learner already answered the
          primary question correctly no longer count against the raw score,
          weighted score, denominator, submitted payload, or persisted stats.
        </p>

        <h3 id="chat-rendering" className="font-bold mt-4 mb-2">Cleaner Chat Output</h3>
        <p className="text-sm mb-4">
          Assistant output is now much easier to work with. Text blocks, code
          blocks, reasoning, tool arguments, tool output, generated images, and
          structured response blocks all have copy affordances where they are
          useful. Reasoning blocks parse <Code>&lt;think&gt;</Code> and{" "}
          <Code>&lt;thinking&gt;</Code> tags, deduplicate repeated reasoning, and
          auto-collapse after the response completes so older turns stop taking
          over the transcript.
        </p>
        <p className="text-sm mb-4">
          Chat persistence also got a correctness pass. User messages are now
          preserved when a provider throws before streaming begins, which fixes
          the case where a first message appeared to disappear after an initial
          provider error. Tag-heavy messages such as question, goal, image, and
          reasoning outputs now render in the right place instead of showing raw
          tags, duplicated headers, or blank assistant bubbles.
        </p>

        <h3 id="artifact-viewers" className="font-bold mt-4 mb-2">Artifact and Animation Viewers</h3>
        <p className="text-sm mb-4">
          The artifact side panel was tightened up by removing the redundant
          header block and moving the close control into the search row. The
          animation player now renders playable visual motion instead of only
          displaying storyboard text, and artifact viewers gained clearer
          handling for generated lesson, quiz, image, and animation outputs.
        </p>
        <p className="text-sm mb-4">
          Question cards now support collapsing, and the duplicate visible
          question header was removed from the expanded state. The compact
          summary only appears when the question is hidden, which keeps the
          transcript from repeating the same prompt twice.
        </p>

        <h3 id="model-provider-updates" className="font-bold mt-4 mb-2">Model and Provider Updates</h3>
        <p className="text-sm mb-4">
          The model chooser now supports provider filtering as well as search,
          making large provider lists easier to scan. MiniMax M3 compatibility
          entries were added to the MiniMax model lists, and Keating packages
          were updated to the Pi <Code>0.78.0</Code> package line where
          available.
        </p>
        <p className="text-sm mb-4">
          Provider setup copy and tutorial navigation were also tuned so the
          browser, llama.cpp, Ollama, LiteLLM, and related setup buttons behave
          like in-page navigation controls without unexpectedly jumping the
          learner back to the top of the tutorial.
        </p>

        <h3 id="benchmark-runtime-fixes" className="font-bold mt-4 mb-2">Benchmark and Runtime Fixes</h3>
        <p className="text-sm mb-4">
          Real-learner benchmark scoring, deterministic synthetic learner
          simulation, outcome thresholds, and real/synthetic blending were
          centralized in a shared browser-safe helper. Real and synthetic blend
          coefficients now stay non-negative and sum to one as learner feedback
          accumulates, so benchmark scores do not distort once a topic has more
          real outcomes.
        </p>
        <p className="text-sm mb-4">
          Browser benchmark traces now report real learner outcome counts and
          synthetic fallback state correctly. Vite development mode also gained
          the same <Code>/api/agent-runtime/remote/**</Code> proxy path as the
          Nitro production server, so remote agent mode no longer works only in
          production builds.
        </p>

        <h3 id="site-navigation-polish" className="font-bold mt-4 mb-2">Site Navigation Polish</h3>
        <p className="text-sm mb-4">
          The blog itself now has search, release-line filtering, update types,
          a version-oriented table of contents, featured docs, and resource
          links. The tutorial learned the same lesson: topic navigation is more
          obvious, hover states make interactive controls clearer, mobile button
          groups avoid cramped layouts, and selecting a tutorial section no
          longer force-scrolls the page to the top.
        </p>
        <p className="text-sm mb-4">
          Redundant Keating and Features nav links were removed from the landing
          and blog contexts, while logo hover affordances were brought closer to
          the chat-page treatment for a more consistent site shell.
        </p>
      </>
    ),
  },
  {
    date: "2026-06-02",
    badge: { label: "MAJOR", color: "release" },
    title: "v1.0.0 - Browser-First Agents, Remote Sandboxes, and the Keating Cloud Boundary",
    version: "1.0.0",
    summary:
      "Keating 1.0 makes the agent runtime explicit: browser-only for the free local default, remote for a self-hosted sandbox endpoint, and cloud for the canonical keating.help backend. It also introduces the shared browser-agent runtime package and lays out the PDS/AT Protocol and educator-tool roadmap.",
    sections: [
      { id: "serving-modes", title: "Three Serving Modes" },
      { id: "runtime-tools", title: "Runtime-Aware Tools" },
      { id: "shared-runtime", title: "Shared Browser Agent Runtime" },
      { id: "what-stays-local", title: "What Stays Local" },
      { id: "storage-roadmap", title: "PDS and Educator Roadmap" },
    ],
    body: (
      <>
        <p className="mb-4 leading-6">
          1.0.0 is the line where Keating stops treating browser execution,
          local CLI execution, and cloud execution as separate worlds. The
          browser agent now starts by asking what runtime it is in, and
          remote-only work has an explicit path instead of an implicit
          server fallback.
        </p>

        <h3 id="serving-modes" className="font-bold mt-4 mb-2">Three Serving Modes</h3>
        <p className="text-sm mb-4">
          <Code>keating web</Code> now has an explicit agent mode. Browser-only
          is the free local default. Remote mode points at a self-hosted
          sandbox service. Cloud mode points at the canonical Keating backend.
        </p>
        <CodeBlock>{`keating web --browser-only-agent 3000

keating web --remote 3000 \\
  --remote-provider=microsandbox \\
  --remote-endpoint=http://127.0.0.1:8787 \\
  --remote-region=local \\
  --remote-snapshot=keating-base

keating web --cloud 3000
keating web --cloud 3000 --cloud-endpoint=https://keating.help`}</CodeBlock>
        <p className="text-sm mb-4">
          The web server exposes <Code>/api/agent-runtime/config</Code> so the
          app can discover its mode, and <Code>/api/agent-runtime/remote/**</Code>{" "}
          as the controlled proxy path for remote/cloud execution. In
          browser-only mode that proxy returns a fallback error by design.
        </p>

        <h3 id="runtime-tools" className="font-bold mt-4 mb-2">Runtime-Aware Tools</h3>
        <p className="text-sm mb-4">
          The web agent now gets <Code>agent_runtime</Code> and{" "}
          <Code>remote_execute</Code>. The first reports the current mode,
          capabilities, and fallback policy. The second posts remote-only
          operations to the configured server when available, or explains why
          the task cannot run in browser-only mode.
        </p>

        <h3 id="shared-runtime" className="font-bold mt-4 mb-2">Shared Browser Agent Runtime</h3>
        <p className="text-sm mb-4">
          A new <Code>packages/browser-agent-runtime</Code> package provides
          the shared execution vocabulary: memory sandboxes, capability
          routing, transactional snapshots, rollback helpers, Daytona-shaped
          filesystem/process compatibility, a NodePod adapter seam, and an
          RPC relay protocol. The point is to make NodePod, Daytona,
          microsandbox, and future providers adapters behind one boundary.
        </p>

        <h3 id="what-stays-local" className="font-bold mt-4 mb-2">What Stays Local</h3>
        <p className="text-sm mb-4">
          The free browser surface is intentionally browser-only. It is
          lower-risk than running arbitrary learner code on a shared Keating
          server, but it cannot provide native binaries, Docker or microVM
          isolation, durable background compute, unrestricted host filesystem
          access, public inbound networking, or server-brokered secrets.
          Those belong behind <Code>--remote</Code> or <Code>--cloud</Code>.
        </p>

        <h3 id="storage-roadmap" className="font-bold mt-4 mb-2">PDS and Educator Roadmap</h3>
        <p className="text-sm mb-4">
          The docs now separate private learning state, portable public
          educational artifacts, and operational sandbox state. AT Protocol
          and PDS integration is a good fit for public lesson packs, rubrics,
          maps, quizzes, educator profiles, and learner-approved portfolio
          artifacts. It should not become the default store for raw private
          tutoring transcripts, API keys, private goals, or classroom roster
          analytics.
        </p>
        <p className="text-sm mb-4">
          Educator tooling is also being scoped as an explicit product layer:
          lesson packs, misconception banks, rubrics, class goals, review
          sets, portfolio artifacts, and privacy-preserving class analytics.
          The storage roadmap lives in{" "}
          <Code>docs/plans/storage-atproto-educator-tools.md</Code>.
        </p>
      </>
    ),
  },
  {
    date: "2026-05-28",
    badge: { label: "RELEASE", color: "release" },
    title: "v0.3.13 — Source-Edit CLI, Safer Auto-Improve, and Persistent MAP-Elites",
    version: "0.3.13",
    summary:
      "New `keating edit` command for search/replace source edits. Auto-improve gets a 30-min cooldown and rolls back regressions. MAP-Elites grids now persist between runs. Resizable session sidebar and year-by-year activity heatmap on the web.",
    sections: [
      { id: "edit-cli", title: "Source-Edit CLI" },
      { id: "safer-auto-improve", title: "Safer Auto-Improve Loop" },
      { id: "persistent-mapelites", title: "Persistent MAP-Elites Grids" },
      { id: "real-pareto", title: "Real Pareto Benchmarks" },
      { id: "feedback-bench", title: "Feedback-Weighted Benchmarks" },
      { id: "web-polish", title: "Web Polish" },
    ],
    body: (
      <>
        <p className="mb-4 leading-6">
          0.3.13 hardens the self-improvement loop and adds the first
          first-class way for Keating to edit its own source files. The web
          chat gets a resizable session sidebar, a multi-year activity
          heatmap, and a handful of correctness fixes for how the active
          policy is loaded.
        </p>

        <h3 id="edit-cli" className="font-bold mt-4 mb-2">Source-Edit CLI</h3>
        <p className="text-sm mb-4">
          A new <Code>keating edit &lt;file&gt;</Code> command applies a single
          search/replace edit to any file under the project root. The search
          block must match exactly and uniquely — duplicate matches are
          rejected for safety. Pass the edit on stdin as JSON for scripted
          flows or use the interactive mode (paste search, then{" "}
          <Code>---</Code>, then replace, end with <Code>===</Code> or
          Ctrl+D). An optional <Code>--backup-dir=DIR</Code> snapshots each
          target before the write so a bad edit can be reverted by hand. This
          is the same primitive that the self-improvement loop now uses
          internally, exposed for direct human and agent use.
        </p>

        <h3 id="safer-auto-improve" className="font-bold mt-4 mb-2">Safer Auto-Improve Loop</h3>
        <p className="text-sm mb-4">
          <Code>auto-improve</Code> now snapshots the active teaching policy
          before running and automatically rolls back when the post-loop
          verdict is REGRESSED, so a bad run can no longer corrupt your
          policy. A 30-minute cooldown prevents accidental back-to-back runs;
          pass <Code>--force</Code> to override it. The improvement archive
          gained <Code>accept</Code> and <Code>reject</Code> subcommands
          (<Code>keating improve accept &lt;id&gt;</Code> /{" "}
          <Code>keating improve reject &lt;id&gt;</Code>) that resolve a
          pending proposal using the snapshots stored alongside it — no need
          to thread snapshots through the call yourself.
        </p>
        <p className="text-sm mb-4">
          The same gating now applies in the web chat: the{" "}
          <Code>auto_improve</Code> tool runs at most once per session unless
          the learner explicitly asks again with a <Code>force</Code> flag.
        </p>

        <h3 id="persistent-mapelites" className="font-bold mt-4 mb-2">Persistent MAP-Elites Grids</h3>
        <p className="text-sm mb-4">
          The MAP-Elites quality-diversity archive now reads and writes a
          per-topic grid JSON under{" "}
          <Code>.keating/outputs/evolution/</Code>. Successive runs build on
          previously-discovered cells instead of restarting from an empty
          archive, and each candidate now records its real parent policy
          name. Three additional source files (<Code>mutation.ts</Code>,{" "}
          <Code>map-elites.ts</Code>, <Code>prompt-evolution.ts</Code>) joined
          the self-improver's mutable surface so the system can iterate on
          its own evolution machinery.
        </p>

        <h3 id="real-pareto" className="font-bold mt-4 mb-2">Real Pareto Benchmarks</h3>
        <p className="text-sm mb-4">
          The Ax/GEPA optimizer used to report its Pareto front using a
          baseline placeholder for every point. It now actually benchmarks
          every candidate on the front against the focus topic, with the
          candidate's own learned weights. Each evolution run is also tagged
          with the optimizer that produced it (<Code>gepa</Code> or{" "}
          <Code>mapElites_fallback</Code>) and, on fallback, the reason GEPA
          was skipped — so you can see at a glance which method generated a
          given result.
        </p>

        <h3 id="feedback-bench" className="font-bold mt-4 mb-2">Feedback-Weighted Benchmarks</h3>
        <p className="text-sm mb-4">
          <Code>keating bench</Code> now derives its objective weights from
          the learner's recorded thumbs-up, thumbs-down, and confused
          signals. A history skewed toward confusion increases the weight on
          retention and clarity; a history skewed toward satisfaction shifts
          weight toward engagement and transfer. Reported scores are now a
          measurement of how the current policy serves your real session
          history rather than a fixed default profile.
        </p>

        <h3 id="web-polish" className="font-bold mt-4 mb-2">Web Polish</h3>
        <p className="text-sm mb-4">
          The desktop session sidebar gained a drag-resize handle on its
          right edge and remembers its width in <Code>localStorage</Code>;
          the old desktop collapse toggle was removed in favor of the
          handle. Usage's activity heatmap was rebuilt as a year-by-year
          view with a year selector, replacing the previous fixed 12-week
          window. Web chat now merges consecutive assistant messages into a
          single bubble for cleaner transcripts, and user messages were
          restyled from amber to green for stronger learner/assistant
          contrast.
        </p>
        <p className="text-sm mb-4">
          Under the hood, the active teaching policy is now actually parsed
          out of stored markdown (either a JSON block or{" "}
          <Code>field: value</Code> lines) instead of silently falling back
          to <Code>DEFAULT_POLICY</Code> for every web tool call. The web{" "}
          <Code>DEFAULT_POLICY</Code> itself was rebalanced toward more
          analogies, Socratic dialogue, retrieval practice, and diagrams to
          match the latest evolved policies, and prompt-evolution lookups
          now use a proper IndexedDB <Code>promptName</Code> index instead
          of the generic topic index.
        </p>
      </>
    ),
  },
  {
    date: "2026-05-26",
    badge: { label: "RELEASE", color: "release" },
    title: "v0.3.12 — Portable Session Sharing, Short Links, and UI Settings",
    version: "0.3.12",
    summary:
      "Share chat sessions with short links (server-backed, compressed snapshots, or local-only). New UI settings for share-link mode and app-wide font family. OpenCode Entire plugin hook for session lifecycle tracking.",
    sections: [
      { id: "session-sharing", title: "Portable Session Sharing" },
      { id: "nitro-share", title: "Nitro Share Storage Backend" },
      { id: "ui-settings", title: "UI Settings Expansion" },
    ],
    body: (
      <>
        <p className="mb-4 leading-6">
          0.3.12 brings session sharing to the web: you can now share a Keating
          learning session as a short link, a compressed snapshot embedded in the
          URL, or a local-only shared link. The backend is powered by Nitro
          endpoints for publishing and loading sessions from server storage.
        </p>

        <h3 id="session-sharing" className="font-bold mt-4 mb-2">Portable Session Sharing</h3>
        <p className="text-sm mb-4">
          The chat header now includes a share button with three sharing modes:
          server-backed short links (persisted on the Keating server), compressed
          snapshot links (the full session payload is embedded in a base64 URL
          fragment for maximum portability), and local-only short links (shared
          via browser clipboard with no server roundtrip). Each mode preserves
          the full message history, model selection, and thinking-level settings.
        </p>

        <h3 id="nitro-share" className="font-bold mt-4 mb-2">Nitro Share Storage Backend</h3>
        <p className="text-sm mb-4">
          Server-backed sharing is handled by a new Nitro API route at{" "}
          <Code>/api/share</Code>. Sessions are published with a short random slug,
          stored server-side, and loaded on demand. The endpoint also supports
          updating existing shares so you can keep a link alive as a session
          evolves. Compressed snapshots bypass the server entirely: the session
          JSON is gzipped, base64-encoded, and appended to the URL hash for
          zero-dependency sharing.
        </p>

        <h3 id="ui-settings" className="font-bold mt-4 mb-2">UI Settings Expansion</h3>
        <p className="text-sm mb-4">
          A new Settings section lets you choose the default share-link mode
          (server, snapshot, or local) and select your app-wide font family.
          Forked sessions now preserve parent metadata and appear as part of
          an explorable session tree in the sidebar.
        </p>
      </>
    ),
  },
  {
    date: "2026-05-22",
    badge: { label: "RELEASE", color: "release" },
    title: "v0.3.11 — Session Sidebar, Fork Trees, and Profile Images",
    version: "0.3.11",
    summary:
      "Persistent session sidebar on large screens with search, load, fork, rename, and nested fork navigation. Forked sessions now appear as a session tree. User profile images and animation-renderer settings.",
    sections: [
      { id: "session-sidebar", title: "Persistent Session Sidebar" },
      { id: "fork-trees", title: "Fork Session Trees" },
      { id: "profile-images", title: "User Profile Images" },
      { id: "animation-renderer", title: "Animation Renderer Setting" },
    ],
    body: (
      <>
        <p className="mb-4 leading-6">
          0.3.11 brings a dedicated session sidebar to the chat view so you can
          navigate your learning history without leaving the conversation. Forked
          sessions are now threaded into an explorable tree, and the web app
          supports custom user avatars and a choice of animation renderers.
        </p>

        <h3 id="session-sidebar" className="font-bold mt-4 mb-2">Persistent Session Sidebar</h3>
        <p className="text-sm mb-4">
          A collapsible sidebar on the left of the chat view lists every saved
          session with search, load, fork, rename, and delete actions. Nested
          forks are indented under their parent and the current session is
          highlighted. The sidebar is visible at <Code>md</Code> breakpoint and
          up and collapses to a drawer on smaller screens.
        </p>

        <h3 id="fork-trees" className="font-bold mt-4 mb-2">Fork Session Trees</h3>
        <p className="text-sm mb-4">
          Forking a session now keeps a reference to the parent session id and
          the fork timestamp. The sidebar renders this as a nested tree so you
          can trace how a conversation branched. A forking transition on the
          active session card makes the split easy to track visually.
        </p>

        <h3 id="profile-images" className="font-bold mt-4 mb-2">User Profile Images</h3>
        <p className="text-sm mb-4">
          Settings now accepts a profile-image URL which renders as a user avatar
          throughout the chat UI. The Keating logo replaces the generic robot icon
          on assistant messages for brand consistency.
        </p>

        <h3 id="animation-renderer" className="font-bold mt-4 mb-2">Animation Renderer Setting</h3>
        <p className="text-sm mb-4">
          The generated animation artifacts can now use either Manim-web (the
          default) or Hyperframes as the renderer. Hyperframes is an optional
          experimental path for faster canvas-based scene rendering in the
          browser.
        </p>
      </>
    ),
  },
  {
    date: "2026-05-22",
    badge: { label: "RELEASE", color: "release" },
    title: "v0.3.10 — Google Search Grounding for Gemini",
    version: "0.3.10",
    summary:
      "Gemini and Google chat requests can now include real-time web search grounding. URL-heavy prompts automatically suggest enabling it.",
    sections: [
      { id: "google-grounding", title: "Google Search Grounding" },
      { id: "url-suggestions", title: "URL Prompt Suggestions" },
    ],
    body: (
      <>
        <p className="mb-4 leading-6">
          0.3.10 adds an opt-in Google Search grounding toggle for Gemini/Google
          chat requests. When enabled, the model receives live web results as
          grounding context, improving accuracy on current events and factual
          questions.
        </p>

        <h3 id="google-grounding" className="font-bold mt-4 mb-2">Google Search Grounding</h3>
        <p className="text-sm mb-4">
          A new Settings toggle <em>Google Search Grounding</em> appears when a
          Gemini model is active. Turning it on appends a{" "}
          <Code>googleSearch</Code> tool to the request payload so the model can
          search the web before replying. Grounding citations are surfaced inline
          as numbered references when the model uses them.
        </p>

        <h3 id="url-suggestions" className="font-bold mt-4 mb-2">URL Prompt Suggestions</h3>
        <p className="text-sm mb-4">
          If your prompt contains URLs or looks like a question about recent
          facts, Keating now surfaces a subtle suggestion to enable Google
          Grounding. This only appears when the feature is available and off,
          nudging you toward more accurate answers without forcing the toggle.
        </p>
      </>
    ),
  },
  {
    date: "2026-05-21",
    badge: { label: "RELEASE", color: "release" },
    title: "v0.3.9 — Streaming Replies and Live Reasoning Panels",
    version: "0.3.9",
    summary:
      "Assistant replies now render live from the in-flight stream instead of appearing all at once at the end. When a reasoning-capable model emits thinking chunks, Keating now shows them in a live collapsible Reasoning panel while the answer is still being written.",
    sections: [
      { id: "live-reply-stream", title: "Live Reply Stream" },
      { id: "thinking-stream", title: "Thinking Stream" },
      { id: "prefill-state", title: "Prefill State" },
    ],
    body: (
      <>
        <p className="mb-4 leading-6">
          0.3.9 fixes the biggest remaining mismatch between Keating&apos;s chat UI and
          the underlying model stream. Assistant replies no longer wait for the final
          committed message before appearing in the transcript: the thread now renders
          the live partial assistant message as it arrives.
        </p>

        <h3 id="live-reply-stream" className="font-bold mt-4 mb-2">Live Reply Stream</h3>
        <p className="text-sm mb-4">
          The chat panel now merges <Code>agent.state.streamingMessage</Code> into the
          visible transcript while a run is active. That means token streaming works for
          the browser model path and for provider-backed models that already emit normal
          text deltas through <Code>@earendil-works/pi-ai</Code>.
        </p>

        <h3 id="thinking-stream" className="font-bold mt-4 mb-2">Thinking Stream</h3>
        <p className="text-sm mb-4">
          Keating already had a dedicated Reasoning renderer for assistant content parts
          of type <Code>thinking</Code>. 0.3.9 connects that renderer to the live stream,
          so models that emit <Code>thinking_start</Code>, <Code>thinking_delta</Code>,
          and <Code>thinking_end</Code> events now reveal their in-progress reasoning in
          real time instead of only after the assistant turn finishes.
        </p>

        <h3 id="prefill-state" className="font-bold mt-4 mb-2">Prefill State</h3>
        <p className="text-sm mb-4">
          Before the first streamed text or reasoning chunk arrives, the thread keeps a
          lightweight rotating status line in place. Once the stream contains real
          content, Keating swaps that placeholder for the live assistant bubble rather
          than flashing an empty panel.
        </p>
      </>
    ),
  },
  {
    date: "2026-05-19",
    badge: { label: "FEATURE", color: "feature" },
    title: "v0.3.8 — Chat Attachments and Vision-Aware Image Uploads",
    version: "0.3.8",
    summary:
      "The web chat composer now has a paperclip button for local file and image attachments. Images are routed to vision-capable models, text/code files are folded into the prompt as readable attachment blocks, and text-only models now fail clearly with a suggestion to switch models instead of silently dropping pictures.",
    sections: [
      { id: "paperclip-composer", title: "Paperclip Composer" },
      { id: "attachment-routing", title: "Attachment Routing" },
      { id: "vision-guard", title: "Vision Model Guard" },
      { id: "transcript-rendering", title: "Transcript Rendering" },
    ],
    body: (
      <>
        <p className="mb-4 leading-6">
          0.3.8 makes the chat composer feel like a real working surface. The prompt
          bar now includes a standard <Code>Paperclip</Code> control, selected files appear
          as removable chips before send, and the agent receives the attachment content
          instead of a placeholder string.
        </p>

        <h3 id="paperclip-composer" className="font-bold mt-4 mb-2">Paperclip Composer</h3>
        <p className="text-sm mb-4">
          The chat panel now enables the <Code>@assistant-ui/react</Code> attachment adapter
          on the external-store runtime. <Code>ComposerPrimitive.AddAttachment</Code> opens
          the browser file picker, accepts multiple files, and renders a familiar paperclip
          icon beside the input. <Code>ComposerPrimitive.Attachments</Code> shows each pending
          attachment as a compact chip with a remove button.
        </p>

        <h3 id="attachment-routing" className="font-bold mt-4 mb-2">Attachment Routing</h3>
        <p className="text-sm mb-4">
          Image files are read locally as data URLs and converted into Pi&apos;s image-content
          shape: <Code>{"{ type: \"image\", mimeType, data }"}</Code>. Text-like files,
          including markdown, JSON, CSV, code, YAML, and plain text, are read in the browser
          and wrapped in named attachment blocks so the model can inspect them directly.
          Unsupported binary files are rejected before they reach the model.
        </p>

        <h3 id="vision-guard" className="font-bold mt-4 mb-2">Vision Model Guard</h3>
        <p className="text-sm mb-4">
          The send path now checks <Code>model.input.includes(&quot;image&quot;)</Code> before
          dispatching an image message. If the active model is text-only, Keating records
          the user&apos;s attempted message and immediately shows a chat error telling the user
          to switch to a vision-capable model such as Gemini Flash/Pro or GPT-4o, then send
          the image again.
        </p>

        <h3 id="transcript-rendering" className="font-bold mt-4 mb-2">Transcript Rendering</h3>
        <p className="text-sm mb-4">
          Sent images render inline in the user transcript. Text file attachments show a
          short <Code>[attached file: name]</Code> summary in the message bubble while the
          full file contents remain available in the actual model context. That keeps chat
          history readable without weakening the prompt.
        </p>
      </>
    ),
  },
  {
    date: "2026-05-17",
    badge: { label: "FEATURE", color: "feature" },
    title: "v0.3.7 — Pluggable Speech Providers, Usage Charts, and Model-Generated Session Titles",
    version: "0.3.7",
    summary:
      "Speech is now a provider abstraction with Gemini Live, OpenAI TTS, OpenAI Realtime (preview), local Supertonic-3 (experimental), and a user-defined custom-TTS form. The Usage page gained five charts, the chat header now lets the model rename the current session, and the responsive layout finally keeps every setting reachable from sm to lg.",
    sections: [
      { id: "session-title", title: "Model-Generated Session Titles" },
      { id: "speech-providers", title: "Speech & Voice — New Tab, New Providers" },
      { id: "usage-charts", title: "Usage Charts" },
      { id: "responsive-fixes", title: "Responsive Layout & Settings Navigation" },
      { id: "suggested-prompts", title: "Suggested-Prompts Auto-Load-More" },
      { id: "honest-status", title: "Honest Status: Preview vs. Experimental" },
    ],
    body: (
      <>
        <p className="mb-4 leading-6">
          0.3.7 is a layout-and-voice release. The chat header keeps every action visible
          across <Code>sm</Code>, <Code>md</Code>, and <Code>lg</Code>, the Settings dialog gets
          a wider sidebar and in-tab sub-navigation, speech grows from a single Gemini Live
          path into a pluggable provider system, and the Usage page learns to draw charts.
        </p>

        <h3 id="session-title" className="font-bold mt-4 mb-2">Model-Generated Session Titles</h3>
        <p className="text-sm mb-4">
          A new <Code>Sparkles</Code> button in the chat header (and a matching mobile-menu
          entry) asks the active model to rename the current session based on its content.
          The handler snapshots the live messages, feeds a preview to the model with a
          minimal-reasoning configuration, and writes the cleaned title back via{" "}
          <Code>sessions.updateTitle</Code>. Tooltip feedback reports{" "}
          <em>"Generating title…"</em>, <em>"Renamed to …"</em>, or the error message.
        </p>

        <h3 id="speech-providers" className="font-bold mt-4 mb-2">Speech & Voice — New Tab, New Providers</h3>
        <p className="text-sm mb-4">
          Speech is now its own Settings tab, and{" "}
          <Code>src/keating/speech.ts</Code> exposes a <Code>SpeechProvider</Code> interface
          backed by a lazy registry. Built-in providers:
        </p>
        <ul className="text-sm mb-4 list-disc pl-6 space-y-1">
          <li><strong>Gemini Live</strong> — existing audio-out path, refactored behind the interface. Stable.</li>
          <li><strong>OpenAI TTS</strong> — <Code>gpt-4o-mini-tts</Code>, <Code>tts-1</Code>, and <Code>tts-1-hd</Code> via <Code>/v1/audio/speech</Code>, with steerable affect/pace on the mini model. Stable.</li>
          <li><strong>OpenAI Realtime</strong> — full WebRTC duplex: mints an ephemeral session, exchanges SDP, attaches the mic when enabled, and plays the remote audio track. Flagged <strong>preview</strong> (per-utterance session, untested against your account).</li>
          <li><strong>Supertonic-3 (local)</strong> — wires <Code>onnxruntime-web</Code> and downloads the 4 ONNX files plus <Code>tts.json</Code> and <Code>unicode_indexer.json</Code> from the Hugging Face repo. Flagged <strong>experimental</strong>: sessions load and warm up, but the text→tokens→duration→vectors→vocoder synthesis pipeline still needs to be ported from the Python <Code>supertonic</Code> package.</li>
          <li><strong>Custom TTS</strong> — paste any OpenAI-compatible <Code>/v1/audio/speech</Code> endpoint: label, base URL, model id, voice, provider-key name, and optional API path.</li>
        </ul>
        <p className="text-sm mb-4">
          A microphone toggle in the same tab is honored by duplex providers like OpenAI
          Realtime. The voice tool the agent calls (<Code>keating_voice</Code>) dispatches to
          the active provider through the registry instead of hard-coding Gemini.
        </p>

        <h3 id="usage-charts" className="font-bold mt-4 mb-2">Usage Charts</h3>
        <p className="text-sm mb-4">
          The Usage page now includes five panels powered by{" "}
          <Code>src/components/UsageCharts.tsx</Code>:
        </p>
        <ul className="text-sm mb-4 list-disc pl-6 space-y-1">
          <li><strong>Topic mix donut</strong> — artifacts grouped by topic, recharts <Code>PieChart</Code> with a shared palette.</li>
          <li><strong>Feedback signal donut</strong> — confident / off-track / confused from <Code>learnerState.feedbackHistory</Code>.</li>
          <li><strong>Curriculum timeline</strong> — a hand-rolled SVG Gantt across <Code>learnerState.sessions</Code> (start/end + topics covered), color-matched to the donut.</li>
          <li><strong>Daily activity heatmap</strong> — 12 weeks of sessions/day, GitHub-style grid (also hand-rolled SVG).</li>
          <li><strong>Coming up</strong> — open <Code>Verification</Code> checklists plus <Code>learnerState.weaknesses[]</Code> / <Code>strengths[]</Code>. Honest stand-in for "due" work since storage has no SRS field yet.</li>
        </ul>

        <h3 id="responsive-fixes" className="font-bold mt-4 mb-2">Responsive Layout & Settings Navigation</h3>
        <p className="text-sm mb-4">
          At the <Code>md</Code> breakpoint the chat header was silently dropping
          Settings, New Session, History, Speech, and Artifacts: the hamburger was hidden
          (<Code>md:hidden</Code>) before the inline icons started showing. All seven
          action icons now render together from <Code>sm</Code> upward and the hamburger
          collapses to <Code>xs</Code> only; the mobile dropdown gained the missing
          New Session / Session history entries.
        </p>
        <p className="text-sm mb-4">
          The Settings dialog widened to <Code>max-w-5xl</Code> with a wider sidebar on
          md/lg, and the heavy <strong>Providers & Models</strong> tab gained a sticky
          chip-style sub-section navigator (Cloud / Visibility / My Models / Custom
          Providers) with <Code>scrollIntoView</Code> jumps and per-section{" "}
          <Code>scroll-mt-20</Code>. The Speech & Voice tab uses the same pattern.
        </p>

        <h3 id="suggested-prompts" className="font-bold mt-4 mb-2">Suggested-Prompts Auto-Load-More</h3>
        <p className="text-sm mb-4">
          The suggested-prompts strip used to randomize three items and only let the
          "More" pill swap them out. Pressing the right-arrow at the end of the list now
          appends fresh suggestions filtered against what's already been shown, growing
          the strip until the underlying pool is exhausted. The "More" pill follows the
          same semantics and hides once nothing new is left.
        </p>

        <h3 id="honest-status" className="font-bold mt-4 mb-2">Honest Status: Preview vs. Experimental</h3>
        <p className="text-sm mb-4">
          The Speech tab uses badge color to tell you exactly where each provider stands.
          Stable providers ship no badge. <em>Preview</em> means the integration is wired
          end-to-end but hasn't been validated against a live account in this release —
          OpenAI Realtime falls here because the per-utterance session pattern needs to
          mature into a persistent duplex channel. <em>Experimental</em> means the wiring
          deliberately stops short of a working call — Supertonic-3 falls here because
          the four ONNX models load fine in browser, but reproducing the Python{" "}
          <Code>supertonic</Code> package's tokenization, duration alignment, voice-style
          conditioning, and vocoder windowing in JS is its own follow-up. Picking either
          provider surfaces a clear error rather than a silent failure.
        </p>
      </>
    ),
  },
  {
    date: "2026-05-12",
    badge: { label: "FIX", color: "fix" },
    title: "v0.3.5 — Standalone Installer Fix: Tarball Structure and Node.js Entry Point",
    version: "0.3.5",
    summary:
      "The curl | bash installer was broken: the release tarball lacked its top-level directory and the wrapper tried to exec a nonexistent binary. Both are fixed — install now works end-to-end on Linux and macOS.",
    sections: [
      { id: "broken-install", title: "What Was Broken" },
      { id: "tarball-structure", title: "Tarball Structure Fix" },
      { id: "node-entry-point", title: "Node.js Entry Point Fix" },
      { id: "early-node-check", title: "Early Node.js Check" },
    ],
    body: (
      <>
        <p className="mb-4 leading-6">
          If you ran <Code>curl -fsSL https://keating.help/install | bash</Code> and
          then typed <Code>keating</Code>, you got a confusing "No such file or directory"
          error. The installer reported success — it downloaded, extracted, and linked — but
          the resulting binary could not run. Two independent bugs caused this.
        </p>
        <h3 id="broken-install" className="font-bold mt-4 mb-2">What Was Broken</h3>
        <p className="text-sm mb-4">
          The GitHub Actions release workflow archived the bundle contents without
          a top-level versioned directory. The install script extracted the tarball
          into <Code>~/.local/share/keating/</Code> and expected a subdirectory
          called <Code>keating-0.3.3-linux-x64/</Code>, but the files landed
          directly in the parent directory. On top of that, the wrapper script
          at <Code>~/.local/bin/keating</Code> tried to <Code>exec</Code> a
          standalone binary called <Code>keating</Code> — but the tarball
          contains a Node.js project where the real entry point
          is <Code>bin/keating.js</Code>.
        </p>
        <h3 id="tarball-structure" className="font-bold mt-4 mb-2">Tarball Structure Fix</h3>
        <p className="text-sm mb-4">
          The release workflow now stages all bundle files inside a
          versioned <Code>keating-VERSION-OS-ARCH/</Code> directory before
          running <Code>tar</Code>. This means the tarball root is
          <Code>keating-0.3.5-linux-x64/</Code>, which matches the path the
          install script constructs and expects.
        </p>
        <CodeBlock>{`# Before (broken): tar archived bundle contents flat
tar -czf "\${BUNDLE_NAME}.tar.gz" -C bundle .

# After (fixed): tar archives the versioned directory
tar -czf "\${BUNDLE_NAME}.tar.gz" "\${STAGE_DIR}"`}</CodeBlock>
        <h3 id="node-entry-point" className="font-bold mt-4 mb-2">Node.js Entry Point Fix</h3>
        <p className="text-sm mb-4">
          The install wrapper now launches Keating through Node.js instead of
          trying to exec a standalone binary:
        </p>
        <CodeBlock>{`# Before (broken):
exec "$INSTALL_APP_DIR/$bundle_name/keating" "$@"

# After (fixed):
exec node "$INSTALL_APP_DIR/$bundle_name/bin/keating.js" "$@"`}</CodeBlock>
        <h3 id="early-node-check" className="font-bold mt-4 mb-2">Early Node.js Check</h3>
        <p className="text-sm mb-4">
          The install script now checks for <Code>node</Code> alongside <Code>tar</Code> and
          <Code>mktemp</Code>. If Node.js is not on <Code>PATH</Code>, the installer
          exits immediately with a clear message instead of waiting until runtime to
          discover the missing dependency.
        </p>
        <p className="text-sm text-muted-foreground">
          Reinstall with the updated script to get a working binary:&nbsp;
          <Code>curl -fsSL https://keating.help/install | bash</Code>
        </p>
      </>
    ),
  },
  {
    date: "2026-05-16",
    badge: { label: "RELEASE", color: "release" },
    title: "v0.3.6 — Ink Setup Flow, Package Rename, and Provider Defaults",
    version: "0.3.6",
    summary:
      "Interactive onboarding with Ink. Package renamed to keating. Default shell provider is now Google/gemini-3.1-pro-preview. --list-models passes through to Pi runtime.",
    sections: [
      { id: "ink-setup", title: "Ink Setup Flow" },
      { id: "package-rename", title: "Package Rename" },
      { id: "provider-defaults", title: "Provider Defaults & Credential Checks" },
    ],
    body: (
      <>
        <p className="mb-4 leading-6">
          0.3.6 polishes the onboarding experience and rebrands the package. A
          new interactive setup flow guides you through provider, model, thinking
          level, and runtime configuration. The npm package is now simply
          <Code>keating</Code> instead of{" "}
          <Code>@interleavelove/keating</Code>.
        </p>

        <h3 id="ink-setup" className="font-bold mt-4 mb-2">Ink Setup Flow</h3>
        <p className="text-sm mb-4">
          Running <Code>keating setup</Code> drops you into an interactive Ink
          terminal UI. It asks which AI provider to use, which model, reasoning
          level, and whether to enable the Pi shell runtime. Pass{" "}
          <Code>--yes</Code> for a non-interactive default configuration that
          writes <Code>keating.config.json</Code> with sensible defaults.
        </p>

        <h3 id="package-rename" className="font-bold mt-4 mb-2">Package Rename</h3>
        <p className="text-sm mb-4">
          The npm package was renamed from{" "}
          <Code>@interleavelove/keating</Code> to plain{" "}
          <Code>keating</Code>. Existing installations will continue to work via
          npm aliases, but new installs should use{" "}
          <Code>npm install -g keating</Code>.
        </p>

        <h3 id="provider-defaults" className="font-bold mt-4 mb-2">Provider Defaults & Credential Checks</h3>
        <p className="text-sm mb-4">
          The default shell provider is now <Code>google</Code> with{" "}
          <Code>gemini-3.1-pro-preview</Code>. Before launching the Pi shell,
          Keating checks that the selected provider has valid credentials and
          falls back to OpenAI or Anthropic if Google is unavailable. If no
          provider is configured, it prints recovery commands instead of a
          generic error.
        </p>
        <p className="text-sm text-muted-foreground">
          Legacy configs referencing the removed{" "}
          <Code>google-gemini-cli</Code> provider are automatically normalized to{" "}
          <Code>google</Code> on read.
        </p>
      </>
    ),
  },
  {
    date: "2026-05-10",
    badge: { label: "RELEASE", color: "release" },
    title: "v0.3.4 — Markdown Tables and LaTeX Math in Chat",
    version: "0.3.4",
    summary:
      "Chat now renders GitHub-flavored markdown tables and LaTeX math expressions. Inline math via $...$ and block math via $$...$$ are properly typeset with KaTeX.",
    sections: [
      { id: "markdown-tables", title: "Markdown Table Support" },
      { id: "latex-math", title: "LaTeX Math Rendering" },
    ],
    body: (
      <>
        <p className="mb-4 leading-6">
          Keating 0.3.4 improves the chat rendering pipeline with two long-requested
          features: properly formatted markdown tables and LaTeX math expressions.
        </p>
        <h3 id="markdown-tables" className="font-bold mt-4 mb-2">Markdown Table Support</h3>
        <p className="text-sm mb-4">
          The chat panel now includes <Code>remark-gfm</Code> so GitHub-flavored
          markdown tables render correctly. Inline table components use theme-aware
          borders and spacing so data is readable in both light and dark modes.
        </p>
        <h3 id="latex-math" className="font-bold mt-4 mb-2">LaTeX Math Rendering</h3>
        <p className="text-sm mb-4">
          The <Code>react-markdown</Code> renderer now includes <Code>remark-math</Code>
          {" "}and <Code>rehype-katex</Code> plugins. Inline math delimited by{" "}
          <Code>$...$</Code> and block math delimited by <Code>$$...$$</Code> are
          passed through KaTeX for proper typesetting. The KaTeX stylesheet is loaded
          in the app entry point so expressions render consistently across the UI.
        </p>
        <p className="text-sm text-muted-foreground">
          The v0.3.4 build compiles cleanly and all 18 tests pass.
        </p>
      </>
    ),
  },
  {
    date: "2026-05-09",
    badge: { label: "RELEASE", color: "release" },
    title: "v0.3.3 — Interactive Quizzes, Scene Storyboards, and Dark Mode Fixes",
    version: "0.3.3",
    summary:
      "Quizzes render as live forms inside chat. Animation storyboards become navigable scene cards. Dark mode contrast fixed across retro pages. Chat viewport no longer overflows.",
    sections: [
      { id: "quiz-ui", title: "Interactive Quiz Tool UI" },
      { id: "scene-renderer", title: "Scene Storyboard Renderer" },
      { id: "dark-mode-fix", title: "Dark Mode Contrast Fix" },
      { id: "chat-viewport", title: "Chat Viewport Fix" },
      { id: "version-sync", title: "Version Sync Script" },
    ],
    body: (
      <>
        <p className="mb-4 leading-6">
          Keating 0.3.3 brings interactive teaching artifacts directly into the
          chat stream. Quizzes render as live forms with multiple-choice,
          fill-in-the-blank, true/false, and open-ended questions. Animation
          storyboards become navigable scene cards. Dark mode on the retro
          landing pages no longer shows black-on-black text.
        </p>
        <h3 id="quiz-ui" className="font-bold mt-4 mb-2">Interactive Quiz Tool UI</h3>
        <p className="text-sm mb-4">
          When the model calls <Code>quiz</Code>, the returned content now
          includes an inline <Code>&lt;keating-quiz /&gt;</Code> tag that the
          chat panel parses and renders into a live form. Each question type is
          handled with the right interaction pattern:
        </p>
        <ul className="text-sm space-y-2 ml-4 mb-4">
          <li><strong>Multiple choice:</strong> radio-style options</li>
          <li><strong>Fill in the blank:</strong> textareas that strip and compare against the correct answer</li>
          <li><strong>True / False:</strong> paired toggle buttons</li>
          <li><strong>Short answer / transfer:</strong> open text fields with rubrics shown after submission</li>
        </ul>
        <p className="text-sm mb-4">
          After pressing Submit, every question shows whether the answer is
          correct, reveals the right answer, displays the explanation, and
          surfaces the rubric. A Retake button resets the form. The quiz engine
          now generates <Code>fill_in</Code> and <Code>true_false</Code>
          questions alongside the existing types so the UI sees real variety.
        </p>
        <h3 id="scene-renderer" className="font-bold mt-4 mb-2">Scene Storyboard Renderer</h3>
        <p className="text-sm mb-4">
          The <Code>animate</Code> tool emits a <Code>&lt;keating-scene /&gt;</Code>
          tag alongside its markdown. The new <Code>SceneRenderer</Code>
          component parses the storyboard into a set of scene cards with
          duration, visual descriptions, audio cues, transitions, and highlights.
          Users can click through the timeline or use prev/next arrows.
        </p>
        <h3 id="dark-mode-fix" className="font-bold mt-4 mb-2">Dark Mode Contrast Fix</h3>
        <p className="text-sm mb-4">
          Hardcoded hex colors (<Code>#1c211b</Code>, <Code>#64748b</Code>,
          <Code>#f1ece0</Code>) on the landing, tutorial, blog, paper, and
          footer pages have been replaced with theme-aware Tailwind classes
          (<Code>border-border</Code>, <Code>text-muted-foreground</Code>,
          etc.). Text and dividers now adapt automatically between light and
          dark modes.
        </p>
        <h3 id="chat-viewport" className="font-bold mt-4 mb-2">Chat Viewport Fix</h3>
        <p className="text-sm mb-4">
          The <Code>.chat-page-panel</Code> was <Code>display: block</Code>,
          which broke flex height propagation. Messages pushed the composer
          outside the viewport. Switched to <Code>display: flex; flex-direction:
          column; height: 100%</Code> so the scroll area stays bounded.
        </p>
        <h3 id="version-sync" className="font-bold mt-4 mb-2">Version Sync Script</h3>
        <p className="text-sm mb-4">
          A new <Code>scripts/sync-version.mjs</Code> utility reads the root
          <Code>package.json</Code> version and enforces it across the web
          package, the CLI extension, and hardcoded web strings. Run it with
          <Code>--check</Code> in CI or without flags to auto-update.
        </p>
        <p className="text-sm text-muted-foreground">
          The v0.3.3 build compiles cleanly, all 18 tests pass, and the
          monorepo version strings are aligned.
        </p>
      </>
    ),
  },
  {
    date: "2026-05-09",
    badge: { label: "RELEASE", color: "release" },
    title: "v0.3.2 — Chat Rewrite Stabilizes: Forks, Feedback, and Mobile",
    version: "0.3.2",
    summary:
      "The Assistant UI rewrite from Lit to React has stabilized with mobile layout refinements, artifact chips in messages, CLI theme parity, React #310 crash fix, and per-message fork/feedback actions.",
    sections: [
      { id: "rewrite-matures", title: "Chat Rewrite Matures" },
      { id: "mobile", title: "Mobile Responsiveness" },
      { id: "artifacts-chat", title: "Artifacts in Conversation" },
      { id: "cli-theme", title: "CLI Theme Refresh" },
      { id: "crash-fix", title: "React #310 Crash Fix" },
      { id: "fork-feedback", title: "Per-Message Fork and Feedback" },
    ],
    body: (
      <>
        <p className="mb-4 leading-6">
          The Assistant UI rewrite has stabilized. After migrating the chat layer from Lit to React,
          a series of refinements landed across mobile layout, artifact integration, CLI theming,
          and crash prevention. This release also introduces per-message fork and feedback actions.
        </p>
        <h3 id="rewrite-matures" className="font-bold mt-4 mb-2">Chat Rewrite Matures</h3>
        <p className="text-sm mb-4">
          The chat UI is now built on <Code>@assistant-ui/react</Code> instead of the previous Lit-based
          message list. This gives us better streaming message handling, built-in composer primitives,
          and a cleaner React integration. The migration took several iterations — text rendering fixes,
          prose layout adjustments, mobile toolbar improvements — but the result is a more reliable
          chat experience.
        </p>
        <h3 id="mobile" className="font-bold mt-4 mb-2">Mobile Responsiveness</h3>
        <ul className="text-sm space-y-2 ml-4 mb-4">
          <li>Adaptive toolbar buttons that show/hide based on viewport size</li>
          <li>Touch-friendly targets across the header, model selector, and settings</li>
          <li>Responsive message bubbles and composer layout</li>
        </ul>
        <h3 id="artifacts-chat" className="font-bold mt-4 mb-2">Artifacts in Conversation</h3>
        <p className="text-sm mb-4">
          Lesson plans, concept maps, animations, and benchmark outputs generated during chat now
          appear as clickable artifact chips inside assistant messages. Clicking a chip opens the
          artifact browser directly to that item.
        </p>
        <h3 id="cli-theme" className="font-bold mt-4 mb-2">CLI Theme Refresh</h3>
        <p className="text-sm mb-4">
          The shell palette now matches the web retro-green terminal theme. The boot screen,
          ASCII headers, and progress indicators share the same dark mode-aware palette.
        </p>
        <h3 id="crash-fix" className="font-bold mt-4 mb-2">React #310 Crash Fix</h3>
        <p className="text-sm mb-4">
          A hook-count mismatch crash (React error #310) was traced to <Code>@assistant-ui/react</Code>&apos;s
          internal use of conditional hooks. The library calls <Code>useRef</Code> and <Code>useState</Code>
          inside conditional blocks (annotated with biome-ignore). Under React 19 StrictMode&apos;s
          double-render, these conditions flipped between renders, violating React&apos;s hook rules.
          Removing StrictMode eliminates the crash path while the adapter object is now memoized
          for additional stability.
        </p>
        <h3 id="fork-feedback" className="font-bold mt-4 mb-2">Per-Message Fork and Feedback</h3>
        <p className="text-sm mb-4">
          Each assistant message now shows three action buttons:
        </p>
        <ul className="text-sm space-y-2 ml-4 mb-4">
          <li><strong>Thumbs Up:</strong> Open a modal for optional positive feedback comments</li>
          <li><strong>Thumbs Down:</strong> Open a modal for optional improvement suggestions</li>
          <li><strong>Fork:</strong> Create a copy of the current session starting from this message</li>
        </ul>
        <p className="text-sm text-muted-foreground">
          The v0.3.2 web build compiles cleanly with all TypeScript checks passing and 18 tests green.
        </p>
      </>
    ),
  },
  {
    date: "2026-05-08",
    badge: { label: "RELEASE", color: "release" },
    title: "v0.3.1 — Sessions, Artifacts, Tool Schemas, and Provider Proxying",
    version: "0.3.1",
    summary:
      "Web reliability release with persistent sessions, artifact browsing from chat, real tool JSON schemas for all 19 tools, and a same-origin backend proxy eliminating CORS failures.",
    sections: [
      { id: "session-continuity", title: "Session Continuity" },
      { id: "artifacts-chat-031", title: "Artifacts in Chat" },
      { id: "provider-proxy", title: "Provider Proxy Fixes" },
      { id: "tool-schemas-031", title: "Tool Schemas" },
    ],
    body: (
      <>
        <p className="mb-4 leading-6">
          Keating 0.3.1 is a web reliability release: saved sessions are easier to resume and
          manage, generated teaching artifacts are reachable from chat, the browser model gets
          real tool schemas, and custom providers no longer make direct cross-origin discovery
          calls from the page.
        </p>
        <h3 id="session-continuity" className="font-bold mt-4 mb-2">Session Continuity</h3>
        <ul className="text-sm space-y-2 ml-4 mb-4">
          <li>
            <strong>Persistent storage prompt:</strong> Keating asks once for durable browser storage so longer learning histories are less likely to be evicted.
          </li>
          <li>
            <strong>Auto-resume:</strong> returning to chat now restores the latest saved session instead of always opening an empty conversation.
          </li>
          <li>
            <strong>Session manager:</strong> the history dialog can load, rename, and delete saved sessions.
          </li>
          <li>
            <strong>Session-end recording:</strong> switching sessions or starting a new one records the end of the current learner session.
          </li>
        </ul>
        <h3 id="artifacts-chat-031" className="font-bold mt-4 mb-2">Artifacts in Chat</h3>
        <p className="text-sm mb-4">
          The chat header now includes an Artifacts button. It opens a side overlay for browsing
          lesson plans, maps, animations, benchmark reports, and evolution outputs without leaving
          the current conversation.
        </p>
        <h3 id="provider-proxy" className="font-bold mt-4 mb-2">Provider Proxy Fixes</h3>
        <p className="text-sm mb-4">
          Custom-provider model discovery now calls Keating's same-origin backend proxy before
          reaching servers like Ollama, llama.cpp, vLLM, LM Studio, Synthetic, or Anthropic-compatible
          endpoints. That prevents browser CORS failures such as a direct request to{" "}
          <Code>http://localhost:11434/api/tags</Code> from <Code>https://keating.help</Code>.
        </p>
        <p className="text-sm mb-4">
          The same proxy path now handles both discovery GET requests and chat POST requests, so
          non-standard custom providers and Anthropic-compatible endpoints share one backend route.
        </p>
        <h3 id="tool-schemas-031" className="font-bold mt-4 mb-2">Tool Schemas</h3>
        <p className="text-sm mb-4">
          The web model still gets the full 19-tool Keating surface, but now each tool exposes real
          JSON Schema parameters instead of empty <Code>properties</Code> objects. The result is a
          teacher that can call planning, mapping, verification, benchmarking, prompt evaluation,
          due-work, timeline, feedback, and voice tools with valid arguments.
        </p>
        <p className="text-sm text-muted-foreground">
          Version strings, package metadata, changelog, and the web build are aligned for v0.3.1.
        </p>
      </>
    ),
  },
  {
    date: "2026-05-07",
    badge: { label: "FIX", color: "fix" },
    title: "All 19 Keating Web Tools Now Expose Real Parameter Schemas",
    version: "0.3.1",
    summary:
      "The fix that landed in 0.3.1: all tool registrations now describe real JSON Schema parameters so the model can actually supply arguments instead of guessing.",
    sections: [
      { id: "what-changed-schemas", title: "What Changed" },
      { id: "why-it-matters", title: "Why It Matters" },
    ],
    body: (
      <>
        <p className="mb-4 leading-6">
          Keating&apos;s web model now receives the full teaching tool surface with proper JSON
          Schema parameter definitions. The important fix was replacing createSimpleTool, which
          produced empty properties objects, with createTool registrations that describe each
          tool&apos;s actual arguments.
        </p>
        <h3 id="what-changed-schemas" className="font-bold mt-4 mb-2">What Changed</h3>
        <p className="text-sm mb-4">
          All 19 Keating tools are now available to the web model with schemas it can
          actually call. Topic-driven tools expose <Code>topic</Code>, feedback exposes
          a constrained <Code>signal</Code>, prompt evaluation requires <Code>prompt</Code>,
          and the optional speech path exposes the full <Code>keating_voice</Code> shape.
        </p>
        <div className="mb-4 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-2 pr-4 font-bold">Tool</th>
                <th className="py-2 font-bold">Parameters</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["plan", "topic"],
                ["map", "topic"],
                ["animate", "topic"],
                ["verify", "topic"],
                ["bench", "topic (optional)"],
                ["evolve", "topic (optional)"],
                ["quiz", "topic"],
                ["feedback", "signal (up/down/confused), topic"],
                ["policy", "none"],
                ["outputs", "none"],
                ["learner_state", "none"],
                ["auto_improve", "topic (optional)"],
                ["improve", "action (optional)"],
                ["trace", "type (optional)"],
                ["prompt_evolve", "name (optional)"],
                ["prompt_eval", "prompt"],
                ["timeline", "none"],
                ["due", "none"],
                ["keating_voice", "text, tags, voice, pace, affect"],
              ].map(([tool, params]) => (
                <tr key={tool} className="border-b border-border/30">
                  <td className="py-2 pr-4 align-top">
                    <Code>{tool}</Code>
                  </td>
                  <td className="py-2 align-top">{params}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3 id="why-it-matters" className="font-bold mt-4 mb-2">Why It Matters</h3>
        <p className="text-sm mb-4">
          Empty tool schemas make the model guess at invisible arguments. With real
          schemas, the web teacher can reliably choose the right tool and pass valid
          arguments for lessons, checks, benchmarks, learner feedback, prompt evaluation,
          due work, timelines, and voice output.
        </p>
        <p className="text-sm text-muted-foreground">
          The web build compiles successfully with the new tool definitions.
        </p>
      </>
    ),
  },
  {
    date: "2026-05-01",
    badge: { label: "FEATURE", color: "feature" },
    title: "Optional Speech: Gemini Live Voice for the Web",
    version: "0.3.1",
    summary:
      "An opt-in speech layer using Gemini Live. The model gains a keating_voice tool for short utterances while reasoning stays in the normal text loop.",
    sections: [
      { id: "speech-how", title: "How It Works" },
      { id: "shell-support", title: "Shell Support" },
    ],
    body: (
      <>
        <p className="mb-4 leading-6">
          Keating now has an optional speech layer. The teacher still thinks, verifies, plans, and
          steers through the normal model/tool loop, but it can hand short learner-facing moments
          to a dedicated voice tool when speech is useful.
        </p>
        <h3 id="speech-how" className="font-bold mt-4 mb-2">How It Works</h3>
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
        <h3 id="shell-support" className="font-bold mt-4 mb-2">Shell Support</h3>
        <p className="text-sm mb-4">
          The CLI config now includes a disabled-by-default <Code>speech</Code> block. When enabled,
          the Pi extension registers <Code>keating_voice</Code> and emits transcript-safe voice tags:
        </p>
        <CodeBlock>{`[voice voice=conversational tags=question,verify pace=normal affect=curious] What would you expect to happen next?`}</CodeBlock>
        <p className="text-sm text-muted-foreground">
          The first shell version is provider-neutral and tag-based. The web version is the first audio-backed path.
        </p>
      </>
    ),
  },
  {
    date: "2026-04-30",
    badge: { label: "RELEASE", color: "release" },
    title: "v0.3.0 — Pedagogical Engines, a Sharper Logo, and Recorded Workflows",
    version: "0.3.0",
    summary:
      "Flashcards, quizzes, mastery tracking, and long-horizon projects. Brand polish with rebuilt ASCII logo. VHS workflow tapes for demos.",
    sections: [
      { id: "ped-engines", title: "New Pedagogical Engines" },
      { id: "sharper-logo", title: "A Sharper KEATING" },
      { id: "recorded-workflows", title: "Recorded Workflows" },
      { id: "quality-checks", title: "Quality Checks" },
      { id: "plumbing", title: "Plumbing" },
    ],
    body: (
      <>
        <p className="mb-4 leading-6">
          Keating 0.3.0 is out. This release lays the groundwork for a much richer learning loop:
          flashcards, quizzes, mastery tracking, and multi-week projects. It also gives the brand
          a long-overdue polish at both ends of the stack.
        </p>
        <h3 id="ped-engines" className="font-bold mt-4 mb-2">New Pedagogical Engines</h3>
        <ul className="text-sm space-y-3 ml-4 mb-4">
          <li>
            <div className="font-bold mb-1 underline decoration-[#d5604b]">Flashcards:</div>
            <p>
              Spaced-repetition decks with definitions, intuitions, common misconceptions,
              transfer prompts, and optional mnemonics, generated per topic.
            </p>
          </li>
          <li>
            <div className="font-bold mb-1 underline decoration-[#d5604b]">Quizzes & Workbooks:</div>
            <p>
              Structured question sets across recall, comprehension, application, analysis, and
              transfer levels, with rubrics for short-answer items and a generated answer key.
            </p>
          </li>
          <li>
            <div className="font-bold mb-1 underline decoration-[#d5604b]">Mastery Tracking:</div>
            <p>
              Longitudinal mastery curves so the system can decide what to revisit and when,
              instead of treating every session as fresh.
            </p>
          </li>
          <li>
            <div className="font-bold mb-1 underline decoration-[#d5604b]">Long-Horizon Projects:</div>
            <p>
              Multi-stage assignments with milestones, deliverables, and rubrics: the path from
              one-off lessons toward weeks-long studio work.
            </p>
          </li>
        </ul>
        <h3 id="sharper-logo" className="font-bold mt-4 mb-2">A Sharper KEATING</h3>
        <p className="text-sm mb-4">
          The CLI logo was misaligned (the &quot;T&quot; was lopsided and the rows
          drifted). It has been rebuilt in the ANSI Shadow font so the shell now
          matches the web. The web boot screen also picked up a vertical emerald
          gradient and a subtle CRT-style glow.
        </p>
        <h3 id="recorded-workflows" className="font-bold mt-4 mb-2">Recorded Workflows</h3>
        <p className="text-sm mb-4">
          Four new <Code>vhs</Code> tapes live in <Code>docs/</Code> and record
          the workflows we actually demo. The rendered videos:
        </p>
        <div className="space-y-5 mb-4">
          <figure>
            <figcaption className="text-xs text-muted-foreground mb-1">
              <Code>intro.tape</Code> — boot the Keating shell, show the refreshed logo, list commands.
            </figcaption>
            <video src="/tapes/intro.mp4" controls muted loop playsInline className="w-full rounded border border-border" />
          </figure>
          <figure>
            <figcaption className="text-xs text-muted-foreground mb-1">
              <Code>learning-flow.tape</Code> — <Code>plan → map → animate → verify → trace</Code>.
            </figcaption>
            <video src="/tapes/learning-flow.mp4" controls muted loop playsInline className="w-full rounded border border-border" />
          </figure>
          <figure>
            <figcaption className="text-xs text-muted-foreground mb-1">
              <Code>improve-flow.tape</Code> — <Code>bench → evolve → prompt-evolve → improve</Code>.
            </figcaption>
            <video src="/tapes/improve-flow.mp4" controls muted loop playsInline className="w-full rounded border border-border" />
          </figure>
          <figure>
            <figcaption className="text-xs text-muted-foreground mb-1">
              <Code>feedback-flow.tape</Code> — record signals, then <Code>due</Code> and <Code>timeline</Code>.
            </figcaption>
            <video src="/tapes/feedback-flow.mp4" controls muted loop playsInline className="w-full rounded border border-border" />
          </figure>
          <figure>
            <figcaption className="text-xs text-muted-foreground mb-1">
              <Code>teacher-flow.tape</Code> — generate a plan, inspect it, then verify the output.
            </figcaption>
            <video src="/tapes/teacher-flow.mp4" controls muted loop playsInline className="w-full rounded border border-border" />
          </figure>
          <figure>
            <figcaption className="text-xs text-muted-foreground mb-1">
              <Code>session-flow.tape</Code> — launch the shell, check policy, browse outputs, send feedback.
            </figcaption>
            <video src="/tapes/session-flow.mp4" controls muted loop playsInline className="w-full rounded border border-border" />
          </figure>
        </div>
        <h3 id="quality-checks" className="font-bold mt-4 mb-2">Quality Checks</h3>
        <div className="space-y-5 mb-4">
          <figure>
            <figcaption className="text-xs text-muted-foreground mb-1">
              <Code>doctor.tape</Code> — run <Code>just doctor</Code> to check your setup.
            </figcaption>
            <video src="/tapes/doctor.mp4" controls muted loop playsInline className="w-full rounded border border-border" />
          </figure>
          <figure>
            <figcaption className="text-xs text-muted-foreground mb-1">
              <Code>tests.tape</Code> — run <Code>just test</Code> to exercise the suite.
            </figcaption>
            <video src="/tapes/tests.mp4" controls muted loop playsInline className="w-full rounded border border-border" />
          </figure>
        </div>
        <p className="text-sm mb-2">Render any of them yourself with:</p>
        <CodeBlock>{`vhs docs/learning-flow.tape`}</CodeBlock>
        <h3 id="plumbing" className="font-bold mt-4 mb-2">Plumbing</h3>
        <ul className="text-sm space-y-2 ml-4 mb-4">
          <li><strong>Command Spec Registry</strong> — <Code>core/commands.ts</Code> is now the single source of truth for CLI/shell command surfaces.</li>
          <li><strong>Terminal &amp; Theme Modules</strong> — palette, ASCII headers, and section helpers extracted to <Code>core/terminal.ts</Code> and <Code>core/theme.ts</Code>.</li>
          <li><strong>Browser Tools / Storage</strong> — broader tool surfaces and persistence improvements in <Code>web/src/keating/</Code>.</li>
        </ul>
        <p className="text-sm italic text-muted-foreground mt-6">
          The new engines ship as libraries first; CLI subcommands and web UI surfaces will land
          behind them in the next point releases.
        </p>
      </>
    ),
  },
  {
    date: "2026-04-16",
    badge: { label: "RELEASE", color: "release" },
    title: "v0.2.0 — Ax Optimization, MAP-Elites, and Complete Rebrand",
    version: "0.2.0",
    summary:
      "Multi-objective policy and prompt learning via @ax-llm/ax (GEPA/ACE). MAP-Elites for quality-diversity search. Temporal engagement policies. Full rebrand from Feynman to Keating. Retro aesthetic finalized.",
    sections: [
      { id: "ax-optimization", title: "Ax Optimization Framework" },
      { id: "map-elites", title: "MAP-Elites Archive" },
      { id: "engagement-policies", title: "Engagement Policies" },
      { id: "rebrand", title: "Rebrand to Keating" },
    ],
    body: (
      <>
        <p className="mb-4 leading-6">
          0.2.0 is a foundational release. It introduces multi-objective policy
          and prompt evolution powered by{" "}
          <Code>@ax-llm/ax</Code>, quality-diversity search via MAP-Elites, and
          temporal engagement awareness. It also completes the rebrand from
          Feynman to Keating across every page and file.
        </p>

        <h3 id="ax-optimization" className="font-bold mt-4 mb-2">Ax Optimization Framework</h3>
        <p className="text-sm mb-4">
          Integrated <Code>@ax-llm/ax</Code> for multi-objective optimization.
          GEPA (Generative Evolutionary Prompt Augmentation) and ACE (Adaptive
          Context Evolution) now optimize both teaching policy parameters and
          prompt templates against benchmark outcomes. The optimizer explores
          Pareto fronts balancing mastery, retention, engagement, transfer, and
          confusion.
        </p>

        <h3 id="map-elites" className="font-bold mt-4 mb-2">MAP-Elites Archive</h3>
        <p className="text-sm mb-4">
          MAP-Elites provides quality-diversity search: instead of converging to
          a single best policy, it discovers a diverse archive of policies that
          excel across different behavioral dimensions. This gives Keating a
          repertoire of teaching styles it can select from based on topic and
          learner state.
        </p>

        <h3 id="engagement-policies" className="font-bold mt-4 mb-2">Engagement Policies</h3>
        <p className="text-sm mb-4">
          New temporal awareness lets the system track when topics were last
          visited, how confident the learner appeared, and when to reintroduce
          material for spaced repetition. Engagement policies optimize the timing
          of teaching actions rather than just their content.
        </p>

        <h3 id="rebrand" className="font-bold mt-4 mb-2">Rebrand to Keating</h3>
        <p className="text-sm mb-4">
          All Feynman references, paths, assets, and branding have been migrated
          to Keating. The retro aesthetic is finalized: VT323 terminal
          typography, emerald green theme, pixel-art identity, and the Dead Poets
          Society-inspired philosophy of teaching to ignite minds rather than
          fill them.
        </p>
      </>
    ),
  },
  {
    date: "2026-04-10",
    badge: { label: "RELEASE", color: "release" },
    title: "From Stubs to Reality: AI-Powered Pedagogical Verification",
    version: "0.3.0",
    summary:
      "Moved from deterministic stubs to AI-powered verification: real-time animation generation, realistic teaching simulations, dynamic learner profiles, and a dedicated PAPER section.",
    sections: [
      { id: "whats-new-stubs", title: "What's New?" },
    ],
    body: (
      <>
        <p className="mb-4 leading-6">
          Today we&apos;ve completed a major architectural shift: moving from deterministic
          mathematical stubs to true AI-powered verification across our core pedagogical engines.
        </p>
        <h3 id="whats-new-stubs" className="font-bold mt-4 mb-2">What's New?</h3>
        <ul className="text-sm space-y-4 ml-4 mb-4">
          <li>
            <div className="font-bold mb-1 underline decoration-[#d5604b]">Real-Time Animation Generation:</div>
            <p>
              The animation engine no longer relies on hardcoded ManimJS templates. It now uses
              the pi agent to generate custom, context-aware visual teaching beats for any topic.
            </p>
          </li>
          <li>
            <div className="font-bold mb-1 underline decoration-[#d5604b]">Realistic Teaching Simulations:</div>
            <p>
              Our synthetic benchmarks now use LLM-backed simulations to evaluate teaching
              outcomes (mastery, retention, confusion) instead of algebraic approximations.
            </p>
          </li>
          <li>
            <div className="font-bold mb-1 underline decoration-[#d5604b]">Dynamic Learner Profiles:</div>
            <p>
              Learner state updates are now driven by AI-inferred pedagogical shifts based on
              historical performance and feedback.
            </p>
          </li>
          <li>
            <div className="font-bold mb-1 underline decoration-[#d5604b]">Research Paper Integration:</div>
            <p>
              The formal account of the Keating metaharness is now served directly in the web
              application with a dedicated [PAPER] section and PDF download.
            </p>
          </li>
        </ul>
        <div className="my-4">
          <figure>
            <figcaption className="text-xs text-muted-foreground mb-1">
              <Code>teacher-flow.tape</Code> — generate a plan, then verify the output.
            </figcaption>
            <video src="/tapes/teacher-flow.mp4" controls muted loop playsInline className="w-full rounded border border-border" />
          </figure>
        </div>
        <p className="text-sm italic text-muted-foreground mt-6">
          These changes ensure that Keating&apos;s self-improvement loop is grounded in actual
          semantic understanding rather than pre-baked formulas.
        </p>
      </>
    ),
  },
  {
    date: "2026-04-10",
    badge: { label: "TECH", color: "tech" },
    title: "Power Move: Migrating to Nitro + Vite",
    summary:
      "Server stack migrated to Nitro for universal deployment (Node, Bun, edge workers) with Vite integration for a unified build pipeline.",
    sections: [
      { id: "why-nitro", title: "Why Nitro?" },
    ],
    body: (
      <>
        <p className="mb-4">
          We&apos;ve leveled up the Keating server stack by migrating to <Code>Nitro</Code> and{" "}
          <Code>Vite</Code>. This provides a high-performance, completely runtime-agnostic
          engine that integrates directly with our build pipeline.
        </p>
        <h3 id="why-nitro" className="font-bold mt-4 mb-2">Why Nitro?</h3>
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
        <p className="text-sm text-muted-foreground">
          The CLI has been updated to launch this new engine automatically—just run{" "}
          <Code>keating web</Code> and experience the speed.
        </p>
      </>
    ),
  },
  {
    date: "2025-04-10",
    badge: { label: "RELEASE", color: "release" },
    title: "v0.1.4 — CLI Fixes, React Migration, and Nitro+Vite Stack",
    version: "0.1.4",
    summary:
      "CLI works globally via npm/bun. Web app rewritten in React with Keating browser tools. Server migrated to Nitro + Vite for universal deployment.",
    sections: [
      { id: "cli-fixes", title: "CLI Fixes" },
      { id: "react-migration", title: "React Migration" },
      { id: "nitro-vite", title: "Nitro + Vite" },
    ],
    body: (
      <>
        <p className="mb-4 leading-6">
          0.1.4 fixes global CLI installation, completes the React rewrite of
          the web app, and moves the server stack to Nitro + Vite for a
          runtime-agnostic build.
        </p>

        <h3 id="cli-fixes" className="font-bold mt-4 mb-2">CLI Fixes</h3>
        <p className="text-sm mb-4">
          When installed globally via <Code>npm install -g keating</Code> or{" "}
          <Code>bun install -g keating</Code>, the CLI now resolves internal
          paths relative to the package installation directory instead of the
          current working directory. This fixes runtime errors like missing
          compiled extension assets when running <Code>keating</Code> from
          arbitrary directories.
        </p>

        <h3 id="react-migration" className="font-bold mt-4 mb-2">React Migration</h3>
        <p className="text-sm mb-4">
          The web app was rebuilt from Lit components to React, integrating
          Keating browser tools directly into the component tree. The model
          selector was rewritten with dynamic provider discovery, and agent state
          updates now persist correctly across the boot sequence.
        </p>

        <h3 id="nitro-vite" className="font-bold mt-4 mb-2">Nitro + Vite</h3>
        <p className="text-sm mb-4">
          The previous Bun server was replaced with Nitro, enabling deployment
          on Node.js, Bun, or edge workers from the same build. Vite handles the
          client build, and the two share a unified pipeline. New mise tasks{" "}
          <Code>web:build</Code> and <Code>web:preview</Code> handle production
          builds.
        </p>
      </>
    ),
  },
  {
    date: "2026-04-09",
    badge: { label: "FIX", color: "fix" },
    title: "Chat Model Selector Now Reflects the Actual Choice",
    version: "0.1.3",
    summary:
      "Fixed the model selector showing a stale gemini placeholder after picking a different model. State now syncs directly to the active agent.",
    sections: [
      { id: "model-selector-changed", title: "What Changed" },
    ],
    body: (
      <>
        <p className="mb-4">
          Fixed the web UI bug where the chat window kept showing{" "}
          <Code>gemini-3.1-pro-preview</Code> even after picking a different model. The selected
          model now updates the agent state directly, so the chat button and the runtime stay in
          sync.
        </p>
        <h3 id="model-selector-changed" className="font-bold mt-4 mb-2">What Changed</h3>
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
        <p className="text-sm text-muted-foreground">
          This fixes the mismatch between the picker and the chat header, which made it look like
          model changes were being ignored.
        </p>
      </>
    ),
  },
  {
    date: "2026-04-09",
    badge: { label: "RELEASE", color: "release" },
    title: "v0.1.3 — Synthetic Provider Support and Mobile UI Polish",
    version: "0.1.3",
    summary:
      "Synthetic added as a first-class custom provider. Mobile touch targets and spacing improved across homepage, selector, settings, and install tabs.",
    sections: [
      { id: "key-changes-013", title: "Key Changes" },
    ],
    body: (
      <>
        <p className="mb-4">
          Keating now exposes Synthetic as a first-class custom provider in the Pi settings flow.
          The provider is configured as an OpenAI-compatible endpoint at{" "}
          <Code>https://api.synthetic.new/openai/v1</Code>, with matching setup guidance in the
          tutorial.
        </p>
        <h3 id="key-changes-013" className="font-bold mt-4 mb-2">Key Changes</h3>
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
        <p className="text-sm text-muted-foreground">
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
    summary:
      "Fixed text disappearing after sending messages by separating the Lit header from the dynamic chat panel. Added a one-time model loading overlay.",
    sections: [
      { id: "chat-panel-lifecycle", title: "Bug Fix: Chat Panel Lifecycle" },
      { id: "model-loading-overlay", title: "New: Model Loading Overlay" },
    ],
    body: (
      <>
        <p className="mb-4">
          Fixed the text disappearing issue in the chat panel that occurred after sending
          messages. Also added a one-time model loading animation when the browser model
          initializes.
        </p>
        <h3 id="chat-panel-lifecycle" className="font-bold mt-4 mb-2">Bug Fix: Chat Panel Lifecycle</h3>
        <p className="mb-4">
          The root cause was Lit re-rendering replacing the ChatPanel element on every state
          update. Separated the static header from the dynamic chat panel with distinct DOM
          containers. The header renders via Lit&apos;s templating, while the ChatPanel is appended
          once and never replaced.
        </p>
        <h3 id="model-loading-overlay" className="font-bold mt-4 mb-2">New: Model Loading Overlay</h3>
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
        <p className="text-sm text-muted-foreground">
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
    version: "0.1.0",
    summary:
      "Keating is now an installable PWA that works offline with the browser model. WebGPU-powered Gemma 4 E4B streams tokens in real-time.",
    sections: [
      { id: "pwa-key-changes", title: "Key Changes" },
      { id: "pwa-how", title: "How It Works" },
    ],
    body: (
      <>
        <p className="mb-4">
          Keating is now a fully installable Progressive Web App. Install it from your browser
          and run it offline with the browser model. The WebGPU-powered Gemma 4 E4B model
          streams tokens in real-time directly in your browser.
        </p>
        <h3 id="pwa-key-changes" className="font-bold mt-4 mb-2">Key Changes</h3>
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
            real-time. Browser option is disabled with a clear message when WebGPU isn&apos;t
            available.
          </li>
          <li>
            <strong>PWA Manifest:</strong> Added service worker with intelligent caching for
            WASM files and model weights from HuggingFace CDN.
          </li>
        </ul>
        <h3 id="pwa-how" className="font-bold mt-4 mb-2">How It Works</h3>
        <CodeBlock>{`// Hybrid stream function dispatches based on model selection
const hybridStreamFn = async (model, context, options) => {
  if (selectedModelId === 'browser' && webGpuAvailable) {
    return createBrowserStreamFn()(model, context, options);
  }
  return streamSimple(model, context, options);
};`}</CodeBlock>
        <p className="text-sm text-muted-foreground">
          Install: Visit keating.help in Chrome/Edge and click &quot;Install&quot; in the address bar, or
          use the browser&apos;s menu → &quot;Install app&quot;.
        </p>
      </>
    ),
  },
  {
    date: "2025-04-05",
    badge: { label: "UPDATE", color: "update" },
    title: "Default Cloud Model: Gemini 3.1 Pro Preview",
    summary:
      "Updated the default cloud model to gemini-3.1-pro-preview for latest Gemini capabilities when WebGPU is unavailable.",
    body: (
      <>
        <p className="mb-4">
          Updated the default cloud model from <Code>gemini-3.1-pro-preview</Code> to{" "}
          <Code>gemini-3.1-pro-preview</Code>. This gives access to the latest Gemini
          capabilities when WebGPU is unavailable.
        </p>
        <p className="text-sm text-muted-foreground">
          The model selector UI has been updated to reflect this change, showing &quot;Gemini 3.1 Pro
          Preview&quot; instead of the previous version.
        </p>
      </>
    ),
  },
  {
    date: "2025-04-05",
    badge: { label: "TECH", color: "tech" },
    title: "Robust WebGPU Detection",
    summary:
      "Async WebGPU detection before rendering prevents showing the browser model option when it won't actually work.",
    body: (
      <>
        <p className="mb-4">
          The model selector now performs async WebGPU detection before rendering. This prevents
          the UI from showing the browser option when it won&apos;t actually work.
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
        <p className="text-sm text-muted-foreground">
          If WebGPU is unavailable, the browser model option shows &quot;WebGPU not available&quot; and is
          grayed out.
        </p>
      </>
    ),
  },
  {
    date: "2025-01-15",
    badge: { label: "FEATURE", color: "feature" },
    title: "Local Model Support via WebGPU",
    summary:
      "Run Gemma 4 E4B entirely in browser using WebGPU — no API keys, progressively loaded, locally cached.",
    body: (
      <>
        <p className="mb-4">
          Keating now runs entirely in your browser using WebGPU. Run Gemma 4 E4B locally
          without any API keys. The model loads progressively and caches in your browser for
          subsequent sessions.
        </p>
        <p className="text-sm text-muted-foreground">
          Requires Chrome 113+ or Edge 113+ with WebGPU support. Model size: ~5GB cached
          locally.
        </p>
      </>
    ),
  },
  {
    date: "2025-04-01",
    badge: { label: "RELEASE", color: "release" },
    title: "v0.1.2 — Initial Public Release",
    version: "0.1.2",
    summary:
      "First public release of Keating. Pi-powered hyperteacher shell with lesson plans, concept maps, animations, verification, benchmarks, policy evolution, and self-improvement proposals.",
    sections: [
      { id: "core-tools", title: "Core Teaching Tools" },
      { id: "self-improvement", title: "Self-Improvement Loop" },
    ],
    body: (
      <>
        <p className="mb-4 leading-6">
          Keating 0.1.2 is the first public release. It ships a complete
          hyperteacher CLI built on the Pi agent framework, with deterministic
          pedagogical engines for lesson planning, concept mapping, animation
          generation, and teaching verification.
        </p>

        <h3 id="core-tools" className="font-bold mt-4 mb-2">Core Teaching Tools</h3>
        <ul className="text-sm space-y-2 ml-4 mb-4">
          <li><Code>keating plan &lt;topic&gt;</Code> — Generate structured lesson plans</li>
          <li><Code>keating map &lt;topic&gt;</Code> — Create Mermaid concept maps</li>
          <li><Code>keating animate &lt;topic&gt;</Code> — Build Manim-web animation bundles</li>
          <li><Code>keating verify &lt;topic&gt;</Code> — Run verification checklists</li>
          <li><Code>keating bench</Code> — Benchmark teaching policies against synthetic learners</li>
        </ul>

        <h3 id="self-improvement" className="font-bold mt-4 mb-2">Self-Improvement Loop</h3>
        <p className="text-sm mb-4">
          <Code>keating evolve</Code> runs policy evolution by mutating teaching
          parameters against benchmark scores. <Code>keating improve</Code>
          generates targeted improvement proposals from benchmark weakness
          analysis. <Code>keating doctor</Code> diagnoses your runtime environment
          and reports actionable setup guidance.
        </p>
      </>
    ),
  },
  {
    date: "2025-01-10",
    badge: { label: "RELEASE", color: "release" },
    title: "v0.1.0 — Initial Public Release",
    version: "0.1.0",
    summary:
      "First public release. Socratic AI tutor built on Pi agent framework with multi-provider support, local persistence, and dark mode.",
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
    summary:
      "Why Keating is named after John Keating from Dead Poets Society. Education should ignite minds, not fill them.",
    body: (
      <>
        <p className="mb-4">
          Keating is named after John Keating from Dead Poets Society, who taught that the
          purpose of education is not to fill minds but to ignite them. Our AI doesn&apos;t give
          answers — it forces you to reconstruct understanding from memory.
        </p>
        <p className="text-sm text-muted-foreground">
          Core principle: struggle is the feature, not the bug. Neural pathways form through
          effort.
        </p>
      </>
    ),
  },
];

/* ── TOC helpers ─────────────────────────────────────────────────── */

type VersionGroup = { version: string; posts: Post[] };

const ALL_CATEGORIES = "all";
const ALL_VERSIONS = "all";

function postId(post: Post): string {
  return post.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
}

function postSearchText(post: Post): string {
  return [
    post.title,
    post.summary,
    post.version ?? "",
    post.badge.label,
    ...(post.sections?.map((section) => section.title) ?? []),
  ].join(" ").toLowerCase();
}

function versionLabel(post: Post): string {
  return post.version ? `v${majorMinor(post.version)}` : "Other";
}

function groupByVersion(posts: Post[]): VersionGroup[] {
  const map = new Map<string, Post[]>();
  for (const p of posts) {
    const v = p.version ?? "other";
    const mm = v === "other" ? "other" : majorMinor(v);
    if (!map.has(mm)) map.set(mm, []);
    map.get(mm)!.push(p);
  }
  const groups: VersionGroup[] = [];
  for (const [mm, ps] of map) {
    groups.push({ version: mm === "other" ? "Other" : `v${mm}`, posts: ps });
  }
  // Sort by version desc, keep "other" last
  return groups.sort((a, b) => {
    if (a.version === "Other") return 1;
    if (b.version === "Other") return -1;
    return b.version.localeCompare(a.version, undefined, { numeric: true });
  });
}

/* ── Components ──────────────────────────────────────────────────── */

function PostCard({ post, expanded, onToggle }: { post: Post; expanded: boolean; onToggle: () => void }) {
  return (
    <article id={postId(post)} className="paper-fold distressed-border p-6 post-card scroll-mt-28">
      <div className="flex items-center gap-3 mb-3">
        <span className="font-terminal text-[#d5604b]">{post.date}</span>
        <span className={`text-xs px-2 py-1 rounded ${BADGE_CLASSES[post.badge.color]}`}>
          {post.badge.label}
        </span>
        {post.version && (
          <span className="text-xs font-terminal text-muted-foreground">v{post.version}</span>
        )}
      </div>

      <h2 className="text-xl font-bold mb-2">{post.title}</h2>

      <p className={`text-sm leading-6 ${expanded ? "" : "line-clamp-2"}`}>{post.summary}</p>

      {/* Section links when expanded */}
      {expanded && post.sections && post.sections.length > 0 && (
        <div className="mt-3 mb-4 rounded-md bg-muted/30 border border-border p-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            <Hash size={12} />
            Contents
          </div>
          <div className="flex flex-wrap gap-2">
            {post.sections.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="text-xs px-2 py-1 rounded border border-border bg-background hover:border-primary hover:text-primary transition-colors"
              >
                {s.title}
              </a>
            ))}
          </div>
        </div>
      )}

      {expanded && <div className="mt-4">{post.body}</div>}

      <button
        onClick={onToggle}
        className="mt-4 inline-flex items-center gap-1.5 text-xs font-terminal text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? (
          <>
            <ChevronUp size={14} /> Collapse
          </>
        ) : (
          <>
            <ChevronDown size={14} /> Read more
          </>
        )}
      </button>
    </article>
  );
}

function UpdateFilters({
  query,
  onQueryChange,
  selectedCategory,
  onCategoryChange,
  selectedVersion,
  onVersionChange,
  categories,
  versions,
  total,
  filtered,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  selectedCategory: string;
  onCategoryChange: (value: string) => void;
  selectedVersion: string;
  onVersionChange: (value: string) => void;
  categories: string[];
  versions: string[];
  total: number;
  filtered: number;
}) {
  return (
    <section className="paper-fold distressed-border p-5 mb-6" aria-label="Filter updates">
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-2">
          <span className="font-terminal text-xs text-muted-foreground">SEARCH_UPDATES</span>
          <span className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search versions, providers, runtime, sharing, PWA..."
              className="w-full rounded-md border-2 border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground"
            />
          </span>
        </label>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <div className="mb-2 font-terminal text-xs text-muted-foreground">TYPE</div>
            <div className="flex flex-wrap gap-2">
              {[ALL_CATEGORIES, ...categories].map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => onCategoryChange(category)}
                  className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                    selectedCategory === category
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border bg-background text-foreground hover:bg-muted/60"
                  }`}
                >
                  {category === ALL_CATEGORIES ? "All" : category}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 font-terminal text-xs text-muted-foreground">VERSION</div>
            <div className="flex flex-wrap gap-2">
              {[ALL_VERSIONS, ...versions].map((version) => (
                <button
                  key={version}
                  type="button"
                  onClick={() => onVersionChange(version)}
                  className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                    selectedVersion === version
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border bg-background text-foreground hover:bg-muted/60"
                  }`}
                >
                  {version === ALL_VERSIONS ? "All" : version}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="font-terminal text-xs text-muted-foreground">
          Showing {filtered} of {total} updates
        </div>
      </div>
    </section>
  );
}

function VersionTOC({ groups, expandedMap, onJump }: { groups: VersionGroup[]; expandedMap: Set<string>; onJump: (post: Post) => void }) {
  return (
    <div className="paper-fold distressed-border p-5 sticky top-20">
      <h3 className="font-terminal text-sm mb-1 text-accent">$ browse UPDATES</h3>
      <p className="mb-4 text-xs leading-5 text-muted-foreground">
        Jump by release line, feature note, or dev log. Filters update this list.
      </p>
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No matching updates.</p>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <div key={g.version}>
              <div className="font-terminal text-xs text-muted-foreground mb-1 uppercase tracking-wider">
                {g.version}
              </div>
              <div className="space-y-1">
                {g.posts.map((p) => {
                  const isExpanded = expandedMap.has(p.title);
                  return (
                    <button
                      key={p.title}
                      onClick={() => onJump(p)}
                      className={`w-full rounded px-1.5 py-1 text-left text-xs leading-4 transition-colors ${
                        isExpanded
                          ? "border border-primary/20 bg-primary/10 text-primary"
                          : "text-foreground/80 hover:bg-muted/50"
                      }`}
                    >
                      <span className="block font-medium">
                        {p.title.replace(/^v\d+\.\d+\.\d+\s*[-—]\s*/, "")}
                      </span>
                      <span className="font-terminal text-[10px] text-muted-foreground">
                        {p.date} / {p.badge.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FeaturedDocs({ onJump }: { onJump: (post: Post) => void }) {
  const picks = POSTS.filter((post) =>
    ["release", "feature", "tech", "devlog"].includes(post.badge.color),
  ).slice(0, 4);

  return (
    <section className="grid gap-3 md:grid-cols-2 mb-6">
      {picks.map((post) => (
        <button
          key={post.title}
          type="button"
          onClick={() => onJump(post)}
          className="rounded-md border-2 border-border bg-background p-4 text-left transition-colors hover:bg-muted/50"
        >
          <div className="mb-2 flex items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-[10px] ${BADGE_CLASSES[post.badge.color]}`}>
              {post.badge.label}
            </span>
            <span className="font-terminal text-[11px] text-muted-foreground">{post.date}</span>
          </div>
          <h3 className="text-sm font-semibold leading-5">{post.title}</h3>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{post.summary}</p>
        </button>
      ))}
    </section>
  );
}

function ResourceLibrary() {
  const resources = [
    {
      label: "Tutorial settings guide",
      detail: "Provider keys, persona, speech, interface, sharing, and proxy setup.",
      href: "/tutorial#settings",
    },
    {
      label: "Architecture notes",
      detail: "Runtime layers, deterministic pedagogy, and artifact flow.",
      href: "https://github.com/Diogenesoftoronto/keating/blob/main/docs/ARCHITECTURE.md",
    },
    {
      label: "Self-modifying agent plan",
      detail: "Browser, remote sandbox, NodePod, and cloud execution boundaries.",
      href: "https://github.com/Diogenesoftoronto/keating/blob/main/docs/self-modifying-agent-architecture.md",
    },
    {
      label: "Storage and educator roadmap",
      detail: "PDS, AT Protocol, public learning artifacts, and educator tools.",
      href: "https://github.com/Diogenesoftoronto/keating/blob/main/docs/plans/storage-atproto-educator-tools.md",
    },
  ];

  return (
    <section className="paper-fold distressed-border p-5 mb-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Docs Worth Reading</h2>
          <p className="text-sm text-muted-foreground">
            Design notes and implementation plans that explain where Keating is going.
          </p>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {resources.map((resource) => (
          <a
            key={resource.label}
            href={resource.href}
            className="rounded-md border border-border bg-background p-3 transition-colors hover:bg-muted/50"
          >
            <span className="block text-sm font-semibold">{resource.label}</span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">{resource.detail}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

/* ── Page ────────────────────────────────────────────────────────── */

export function Blog() {
  useSeo({
    title: "Keating Blog — Changelog & Release Notes",
    description: "Latest updates, release notes, and development news for Keating — the Pi-powered hyperteacher for Socratic AI tutoring.",
    canonical: "https://keating.help/blog",
  });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(ALL_CATEGORIES);
  const [selectedVersion, setSelectedVersion] = useState(ALL_VERSIONS);

  const toggle = (title: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  };

  const jumpToPost = (post: Post) => {
    const el = document.getElementById(postId(post));
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setExpanded((prev) => new Set(prev).add(post.title));
    }
  };

  const categories = useMemo(
    () => Array.from(new Set(POSTS.map((post) => post.badge.label))).sort(),
    [],
  );
  const versions = useMemo(
    () =>
      Array.from(new Set(POSTS.map(versionLabel))).sort((left, right) => {
        if (left === "Other") return 1;
        if (right === "Other") return -1;
        return right.localeCompare(left, undefined, { numeric: true });
      }),
    [],
  );
  const filteredPosts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return POSTS.filter((post) => {
      if (selectedCategory !== ALL_CATEGORIES && post.badge.label !== selectedCategory) return false;
      if (selectedVersion !== ALL_VERSIONS && versionLabel(post) !== selectedVersion) return false;
      if (normalizedQuery && !postSearchText(post).includes(normalizedQuery)) return false;
      return true;
    });
  }, [query, selectedCategory, selectedVersion]);
  const versionGroups = useMemo(() => groupByVersion(filteredPosts), [filteredPosts]);

  return (
    <div className="retro-layout retro-page">
      <Nav />

      <main className="pt-6 pb-16 px-6">
        <div className="max-w-6xl mx-auto">
          {/* Hero */}
          <div className="paper-fold distressed-border p-8 mb-8">
            <h1 className="text-3xl md:text-4xl font-bold mb-2">Keating Updates</h1>
            <p className="text-muted-foreground font-terminal">Searchable release notes, feature notes, and dev logs</p>
          </div>

          <div className="flex flex-col lg:flex-row gap-8">
            {/* Posts */}
            <div className="flex-1 min-w-0 space-y-6">
              <UpdateFilters
                query={query}
                onQueryChange={setQuery}
                selectedCategory={selectedCategory}
                onCategoryChange={setSelectedCategory}
                selectedVersion={selectedVersion}
                onVersionChange={setSelectedVersion}
                categories={categories}
                versions={versions}
                total={POSTS.length}
                filtered={filteredPosts.length}
              />
              <ResourceLibrary />
              <FeaturedDocs onJump={jumpToPost} />
              {filteredPosts.length === 0 ? (
                <div className="paper-fold distressed-border p-8 text-center">
                  <h2 className="text-lg font-bold">No matching updates</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Try a broader search, another version, or the All type filter.
                  </p>
                </div>
              ) : (
                filteredPosts.map((post) => (
                  <PostCard
                    key={post.title}
                    post={post}
                    expanded={expanded.has(post.title)}
                    onToggle={() => toggle(post.title)}
                  />
                ))
              )}
            </div>

            {/* Sidebar TOC */}
            <aside className="lg:w-64 shrink-0">
              <VersionTOC
                groups={versionGroups}
                expandedMap={expanded}
                onJump={jumpToPost}
              />
            </aside>
          </div>

          <div className="mt-12 p-6 bg-foreground text-background">
            <h3 className="font-terminal text-lg mb-2">STAY_UPDATED</h3>
            <p className="text-sm text-background/70">
              Follow development on{" "}
              <a
                href="https://github.com/Diogenesoftoronto/keating"
                className="text-[#d5604b] underline"
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

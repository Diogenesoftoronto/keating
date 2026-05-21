import { useMemo, useState } from "react";
import { Nav } from "../components/Nav";
import { useSeo } from "../hooks/useSeo";
import { SimpleFooter } from "../components/Footer";
import { ChevronDown, ChevronUp, Hash } from "lucide-react";

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
          Hardcoded hex colors (<Code>#1a1a1a</Code>, <Code>#64748b</Code>,
          <Code>#f4f1ea</Code>) on the landing, tutorial, blog, paper, and
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
            <div className="font-bold mb-1 underline decoration-[#d44a3d]">Flashcards:</div>
            <p>
              Spaced-repetition decks with definitions, intuitions, common misconceptions,
              transfer prompts, and optional mnemonics, generated per topic.
            </p>
          </li>
          <li>
            <div className="font-bold mb-1 underline decoration-[#d44a3d]">Quizzes & Workbooks:</div>
            <p>
              Structured question sets across recall, comprehension, application, analysis, and
              transfer levels, with rubrics for short-answer items and a generated answer key.
            </p>
          </li>
          <li>
            <div className="font-bold mb-1 underline decoration-[#d44a3d]">Mastery Tracking:</div>
            <p>
              Longitudinal mastery curves so the system can decide what to revisit and when,
              instead of treating every session as fresh.
            </p>
          </li>
          <li>
            <div className="font-bold mb-1 underline decoration-[#d44a3d]">Long-Horizon Projects:</div>
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
              <Code>doctor.tape</Code> — run <Code>mise run doctor</Code> to check your setup.
            </figcaption>
            <video src="/tapes/doctor.mp4" controls muted loop playsInline className="w-full rounded border border-border" />
          </figure>
          <figure>
            <figcaption className="text-xs text-muted-foreground mb-1">
              <Code>tests.tape</Code> — run <Code>mise run test</Code> to exercise the suite.
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
            <div className="font-bold mb-1 underline decoration-[#d44a3d]">Real-Time Animation Generation:</div>
            <p>
              The animation engine no longer relies on hardcoded ManimJS templates. It now uses
              the pi agent to generate custom, context-aware visual teaching beats for any topic.
            </p>
          </li>
          <li>
            <div className="font-bold mb-1 underline decoration-[#d44a3d]">Realistic Teaching Simulations:</div>
            <p>
              Our synthetic benchmarks now use LLM-backed simulations to evaluate teaching
              outcomes (mastery, retention, confusion) instead of algebraic approximations.
            </p>
          </li>
          <li>
            <div className="font-bold mb-1 underline decoration-[#d44a3d]">Dynamic Learner Profiles:</div>
            <p>
              Learner state updates are now driven by AI-inferred pedagogical shifts based on
              historical performance and feedback.
            </p>
          </li>
          <li>
            <div className="font-bold mb-1 underline decoration-[#d44a3d]">Research Paper Integration:</div>
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
  const postId = post.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");

  return (
    <article id={postId} className="paper-fold distressed-border p-6 post-card scroll-mt-28">
      <div className="flex items-center gap-3 mb-3">
        <span className="font-terminal text-[#d44a3d]">{post.date}</span>
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

function VersionTOC({ groups, expandedMap, onJump }: { groups: VersionGroup[]; expandedMap: Set<string>; onJump: (post: Post) => void }) {
  return (
    <div className="paper-fold distressed-border p-5 sticky top-20">
      <h3 className="font-terminal text-sm mb-3 text-accent">$ cat CHANGELOG</h3>
      <div className="space-y-3">
        {groups.map((g) => (
          <div key={g.version}>
            <div className="font-terminal text-xs text-muted-foreground mb-1 uppercase tracking-wider">
              {g.version}
            </div>
            <div className="space-y-1">
              {g.posts.map((p) => {
                const pid = p.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
                const isExpanded = expandedMap.has(p.title);
                return (
                  <button
                    key={p.title}
                    onClick={() => onJump(p)}
                    className={`w-full text-left text-xs leading-4 px-1.5 py-1 rounded transition-colors ${
                      isExpanded
                        ? "bg-primary/10 text-primary border border-primary/20"
                        : "text-foreground/80 hover:bg-muted/50"
                    }`}
                  >
                    {p.title.replace(/^v\d+\.\d+\.\d+\s*[-—]\s*/, "")}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
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

  const toggle = (title: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  };

  const jumpToPost = (post: Post) => {
    const pid = post.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
    const el = document.getElementById(pid);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setExpanded((prev) => new Set(prev).add(post.title));
    }
  };

  const versionGroups = useMemo(() => groupByVersion(POSTS), []);

  return (
    <div className="retro-layout retro-page">
      <Nav />

      <main className="pt-6 pb-16 px-6">
        <div className="max-w-6xl mx-auto">
          {/* Hero */}
          <div className="paper-fold distressed-border p-8 mb-8">
            <h1 className="text-3xl md:text-4xl font-bold mb-2">Keating Updates</h1>
            <p className="text-muted-foreground font-terminal">Development log and release notes</p>
          </div>

          <div className="flex flex-col lg:flex-row gap-8">
            {/* Posts */}
            <div className="flex-1 min-w-0 space-y-6">
              {POSTS.map((post) => (
                <PostCard
                  key={post.title}
                  post={post}
                  expanded={expanded.has(post.title)}
                  onToggle={() => toggle(post.title)}
                />
              ))}
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

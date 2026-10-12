import { BoxRenderable, RenderableEvents, SyntaxStyle, type CliRenderer } from "@opentui/core";
import { defineStories, story } from "textbook-sh";
import { SacredTranscriptRenderable } from "../src/tui/sacred-transcript.js";
import { keatingDesignContract } from "../src/tui/design-contract.js";
import { createTuiPresentationProfile, type TerminalEnvironment } from "../src/tui/terminal-profile.js";
import type { TranscriptEntry } from "../src/tui/view-model.js";
import { artifactAndNotice, generatedComponents, markdownExplanation, teachingConversation, toolFailure } from "./fixtures.js";

export default defineStories({
  title: "Keating/Transcript",
  component: "SacredTranscriptRenderable",
  description: "Production terminal transcript with authored offline fixtures; no providers, accounts, or filesystem reads.",
});

function transcript(renderer: CliRenderer, entries: readonly TranscriptEntry[], options: {
  env?: TerminalEnvironment; width?: number; streaming?: TranscriptEntry;
} = {}) {
  const profile = createTuiPresentationProfile({ TERM: "xterm-256color", COLORTERM: "truecolor", LANG: "en_CA.UTF-8", ...options.env });
  const colors = keatingDesignContract.themes[profile.theme].colors;
  const noColor = profile.design.colorMode === "none";
  const root = new BoxRenderable(renderer, {
    id: "textbook-transcript", flexDirection: "column", width: "100%", height: "100%", backgroundColor: noColor ? undefined : colors.surface,
  });
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: noColor ? {} : { fg: colors.text },
    "markup.heading": { ...(noColor ? {} : { fg: colors.text }), bold: true },
    "markup.heading.1": { ...(noColor ? {} : { fg: colors.accent }), bold: true },
    "markup.heading.2": { ...(noColor ? {} : { fg: colors.text }), bold: true },
    "markup.heading.3": { ...(noColor ? {} : { fg: colors.text }), bold: true },
    "markup.strong": { bold: true }, "markup.italic": { italic: true },
    "markup.list.checked": { ...(noColor ? {} : { fg: colors.success }), bold: true },
    "markup.list.unchecked": noColor ? {} : { fg: colors.mutedText },
    "markup.raw": {}, "markup.raw.block": {}, "markup.link": { underline: true }, "markup.quote": { italic: true },
  });
  root.add(new SacredTranscriptRenderable(renderer, {
    entries, streaming: options.streaming, profile, syntaxStyle,
    width: Math.max(20, Math.min(options.width ?? 88, renderer.width)),
  }));
  root.once(RenderableEvents.DESTROYED, () => syntaxStyle.destroy());
  return root;
}

export const Empty = story({ name: "Start a lesson", description: "Fresh transcript before the first learner turn.", render: (renderer) => transcript(renderer, []) });
export const TeachingConversation = story({ name: "Teaching conversation", description: "Learner question and a concise tutor explanation.", render: (renderer) => transcript(renderer, teachingConversation) });
export const Markdown = story({ name: "Worked table and code", description: "Production Markdown rendering: headings, table, code, quotation, and transfer question.", render: (renderer) => transcript(renderer, markdownExplanation) });
export const Streaming = story({ name: "Response in progress", description: "Fixed partial response with the production streaming caret; no live inference.", render: (renderer) => transcript(renderer, teachingConversation.slice(0, 1), {
  streaming: { id: "streaming", kind: "assistant", title: "Keating", body: "## Follow the energy\n\nWhen speed doubles, kinetic energy increases by **four times**. Now consider the work done by the brakes" },
}) });
export const GeneratedComponents = story({ name: "Generated components", description: "Graded quiz, goal, and simulation as terminal Markdown: glyph, title, content; no boxes or bookkeeping.", render: (renderer) => transcript(renderer, generatedComponents) });
export const ToolFailure = story({ name: "Tool failure and recovery", description: "Failed read with visible error detail and a useful next step.", render: (renderer) => transcript(renderer, toolFailure) });
export const Ascii = story({ name: "ASCII and no color", description: "Constrained terminal profile with readable message roles, artifact, and save status.", render: (renderer) => transcript(renderer, [...teachingConversation, ...artifactAndNotice], { width: 64, env: { TERM: "dumb", LANG: "C", KEATING_ASCII: "1", NO_COLOR: "" } }) });
export const Light = story({ name: "Light theme", description: "Teaching transcript on the shared light palette.", render: (renderer) => transcript(renderer, teachingConversation, { env: { KEATING_THEME: "light" } }) });

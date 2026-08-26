import { afterEach, describe, expect, test } from "bun:test";
import { CodeRenderable, SyntaxStyle, type BaseRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";

import { SacredTranscriptRenderable } from "../src/tui/sacred-transcript.js";
import { createTuiPresentationProfile } from "../src/tui/terminal-profile.js";
import type { TranscriptEntry } from "../src/tui/view-model.js";

const renderers: Array<{ destroy(): void }> = [];
const syntaxStyles: SyntaxStyle[] = [];

afterEach(() => {
  while (renderers.length > 0) renderers.pop()?.destroy();
  while (syntaxStyles.length > 0) syntaxStyles.pop()?.destroy();
});

function syntaxStyle(): SyntaxStyle {
  const style = SyntaxStyle.fromStyles({
    default: {},
    "markup.heading": { bold: true },
    "markup.heading.1": { bold: true },
    "markup.heading.2": { bold: true },
    "markup.strong": { bold: true },
    "markup.italic": { italic: true },
    "markup.raw": {},
    "markup.raw.block": {},
    "markup.link": { underline: true },
    "markup.quote": { italic: true },
  });
  syntaxStyles.push(style);
  return style;
}

function lineContaining(frame: string, value: string): string {
  const line = frame.split("\n").find((candidate) => candidate.includes(value));
  expect(line, `expected frame to contain ${JSON.stringify(value)}`).toBeDefined();
  return line ?? "";
}

function codeRenderables(root: BaseRenderable | undefined): CodeRenderable[] {
  if (!root) return [];
  return [
    ...(root instanceof CodeRenderable ? [root] : []),
    ...root.getChildren().flatMap((child) => codeRenderables(child)),
  ];
}

async function settleMarkdown(
  setup: Awaited<ReturnType<typeof createTestRenderer>>,
  transcript: SacredTranscriptRenderable,
): Promise<void> {
  await setup.flush();
  const pending = transcript.entryIds.flatMap((id) =>
    codeRenderables(transcript.getEntryMarkdown(id))
      .filter((renderable) => renderable.isHighlighting)
      .map((renderable) => renderable.highlightingDone));
  await Promise.all(pending);
  await setup.flush();
}

describe("SacredTranscriptRenderable", () => {
  test("renders asymmetric Unicode Message and MessageViewer layers without flattening Markdown", async () => {
    const setup = await createTestRenderer({ width: 84, height: 38, exitOnCtrlC: false });
    renderers.push(setup.renderer);
    const profile = createTuiPresentationProfile({
      TERM: "xterm-256color",
      LANG: "en_CA.UTF-8",
    });
    const entries: TranscriptEntry[] = [
      {
        id: "learner-turn-1",
        kind: "user",
        title: "You",
        body: "Can you keep the complete explanation and the worked table?",
      },
      {
        id: "teacher-turn-1",
        kind: "assistant",
        title: "Keating",
        body: [
          "## Conservation check",
          "The explanation begins here and ends after the executable example.",
          "",
          "| Construct | Expected behavior |",
          "| --- | --- |",
          "| Stable row | semantic native rendering |",
          "",
          "```typescript",
          "const completeBody = true;",
          "console.log(completeBody);",
          "```",
          "",
          "The final sentence must remain visible.",
        ].join("\n"),
      },
    ];
    const transcript = new SacredTranscriptRenderable(setup.renderer, {
      entries,
      profile,
      width: 84,
      syntaxStyle: syntaxStyle(),
    });
    setup.renderer.root.add(transcript);

    await settleMarkdown(setup, transcript);
    const frame = setup.captureCharFrame();
    const userAvatarLine = lineContaining(frame, "╭YO╮");
    const assistantAvatarLine = lineContaining(frame, "╭◉⌒╮");

    expect(userAvatarLine.indexOf("╭YO╮")).toBeLessThan(assistantAvatarLine.indexOf("╭◉⌒╮"));
    expect(frame).toContain("◀");
    expect(frame).toContain("▶");
    expect(frame).toContain("Conservation check");
    expect(frame).toContain("Construct");
    expect(frame).toContain("Expected behavior");
    expect(frame).toContain("semantic native rendering");
    expect(frame).toContain("const completeBody = true;");
    expect(frame).toContain("The final sentence must remain visible.");
    expect(frame).not.toContain("```typescript");
    expect(transcript.entryIds).toEqual(["learner-turn-1", "teacher-turn-1"]);
    expect(transcript.getEntryRenderable("learner-turn-1")?.id).toEndWith(":entry:learner-turn-1");
  });

  test("uses ASCII avatars, tails, and full-width semantic cards without color-only meaning", async () => {
    const setup = await createTestRenderer({ width: 64, height: 32, exitOnCtrlC: false });
    renderers.push(setup.renderer);
    const profile = createTuiPresentationProfile({
      TERM: "dumb",
      NO_COLOR: "",
      KEATING_ASCII: "1",
      LANG: "C",
    });
    const entries: TranscriptEntry[] = [
      { id: "u", kind: "user", title: "You", body: "ASCII learner row" },
      { id: "a", kind: "assistant", title: "Keating", body: "ASCII teacher row" },
      { id: "t", kind: "tool", title: "Search", body: "Tool output remains readable" },
      { id: "r", kind: "artifact", title: "Lesson plan", body: "Artifact output remains readable" },
      { id: "n", kind: "notice", title: "Saved", body: "Notice output remains readable" },
      { id: "e", kind: "error", title: "Provider failed", body: "Error output remains readable" },
    ];
    const transcript = new SacredTranscriptRenderable(setup.renderer, {
      entries,
      profile,
      width: 64,
      syntaxStyle: syntaxStyle(),
    });
    setup.renderer.root.add(transcript);

    await settleMarkdown(setup, transcript);
    const frame = setup.captureCharFrame();
    const userAvatarLine = lineContaining(frame, "[YO]");
    const assistantAvatarLine = lineContaining(frame, "[oo]");
    const toolTitleLine = lineContaining(frame, "-> Search");

    expect(userAvatarLine.indexOf("[YO]")).toBeLessThan(assistantAvatarLine.indexOf("[oo]"));
    expect(frame).toContain("<");
    expect(frame).toContain(">");
    expect(frame).toContain("# Lesson plan");
    expect(frame).toContain(". Saved");
    expect(frame).toContain("X Provider failed");
    expect(frame).toContain("Tool output remains readable");
    expect(frame).toContain("Artifact output remains readable");
    expect(frame).toContain("Notice output remains readable");
    expect(frame).toContain("Error output remains readable");
    expect(toolTitleLine.trimStart().startsWith("+")).toBe(true);
    expect(toolTitleLine.trimEnd().length).toBe(64);
    expect(frame).not.toMatch(/[╭╰◆◀▶─]/);
    expect(profile.design.colorMode).toBe("none");
  });

  test("updates only the streaming Markdown layer, finalizes its caret, and destroys removed rows", async () => {
    const setup = await createTestRenderer({ width: 72, height: 24, exitOnCtrlC: false });
    renderers.push(setup.renderer);
    const profile = createTuiPresentationProfile({ TERM: "xterm-256color", LANG: "en_CA.UTF-8" });
    const completed: TranscriptEntry = {
      id: "assistant-complete",
      kind: "assistant",
      title: "Keating",
      body: "A completed response must keep its parsed renderable.",
    };
    const transcript = new SacredTranscriptRenderable(setup.renderer, {
      entries: [completed],
      streaming: {
        id: "assistant-streaming",
        kind: "assistant",
        title: "Keating",
        body: "Streaming starts",
      },
      profile,
      width: 72,
      syntaxStyle: syntaxStyle(),
    });
    setup.renderer.root.add(transcript);
    await settleMarkdown(setup, transcript);

    const completedMarkdown = transcript.getEntryMarkdown("assistant-complete");
    const streamingMarkdown = transcript.getEntryMarkdown("assistant-streaming");
    const removedRoot = transcript.getEntryRenderable("assistant-complete");
    expect(setup.captureCharFrame()).toContain("▌");

    transcript.reconcile([completed], {
      id: "assistant-streaming",
      kind: "assistant",
      title: "Keating",
      body: "Streaming starts and now includes the second chunk",
    });
    await settleMarkdown(setup, transcript);

    expect(transcript.getEntryMarkdown("assistant-complete")).toBe(completedMarkdown);
    expect(transcript.getEntryMarkdown("assistant-streaming")).toBe(streamingMarkdown);
    expect(setup.captureCharFrame()).toContain("second chunk");
    expect(setup.captureCharFrame()).toContain("▌");

    transcript.reconcile([{
      id: "assistant-streaming",
      kind: "assistant",
      title: "Keating",
      body: "Streaming starts and now includes the final chunk",
    }], null);
    await settleMarkdown(setup, transcript);

    expect(transcript.getEntryMarkdown("assistant-streaming")).toBe(streamingMarkdown);
    expect(streamingMarkdown?.streaming).toBe(false);
    expect(setup.captureCharFrame()).toContain("final chunk");
    expect(setup.captureCharFrame()).not.toContain("▌");
    expect(removedRoot?.isDestroyed).toBe(true);

    const retainedRoot = transcript.getEntryRenderable("assistant-streaming");
    transcript.destroy();
    expect(transcript.isDestroyed).toBe(true);
    expect(retainedRoot?.isDestroyed).toBe(true);
    expect(setup.renderer.root.getRenderable("keating-sacred-transcript")).toBeUndefined();
  });

  test("updates the learner portrait and label without rebuilding completed Markdown", async () => {
    const setup = await createTestRenderer({ width: 64, height: 18, exitOnCtrlC: false });
    renderers.push(setup.renderer);
    const profile = createTuiPresentationProfile({ TERM: "xterm-256color", LANG: "en_CA.UTF-8" });
    const transcript = new SacredTranscriptRenderable(setup.renderer, {
      entries: [{ id: "learner", kind: "user", title: "You", body: "Keep this parsed message." }],
      profile,
      width: 64,
      syntaxStyle: syntaxStyle(),
      userIdentity: {
        label: "Ada",
        avatar: { unicode: ["┌AL┐", "└──┘"], ascii: ["[AL]", "+--+"] },
      },
    });
    setup.renderer.root.add(transcript);
    await settleMarkdown(setup, transcript);
    const markdown = transcript.getEntryMarkdown("learner");
    expect(setup.captureCharFrame()).toContain("Ada");
    expect(setup.captureCharFrame()).toContain("┌AL┐");

    transcript.setIdentity("user", {
      label: "Grace",
      avatar: { unicode: ["┌GH┐", "└──┘"], ascii: ["[GH]", "+--+"] },
    });
    await settleMarkdown(setup, transcript);

    expect(transcript.getEntryMarkdown("learner")).toBe(markdown);
    expect(setup.captureCharFrame()).toContain("Grace");
    expect(setup.captureCharFrame()).toContain("┌GH┐");
    expect(setup.captureCharFrame()).not.toContain("┌AL┐");
  });
});

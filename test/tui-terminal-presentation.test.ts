import { describe, expect, test } from "bun:test";
import { MarkdownRenderable, SyntaxStyle } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { MARKDOWN_PARITY_FIXTURE } from "@keating/learner-contracts";

import { TuiPromptRecovery } from "../src/tui/prompt-recovery.js";
import {
  createTuiPresentationProfile,
  detectTerminalColorMode,
  detectTerminalGlyphMode,
  detectTerminalTheme,
  terminalLayoutProfile,
} from "../src/tui/terminal-profile.js";
import {
  TUI_COMMANDS,
  prepareTerminalMarkdown,
  transcriptMarkdown,
} from "../src/tui/view-model.js";

describe("OpenTUI terminal capability and layout profiles", () => {
  test("detects truecolor, indexed, basic, no-color, Unicode, and ASCII deterministically", () => {
    expect(detectTerminalColorMode({ COLORTERM: "truecolor", TERM: "xterm-256color" })).toBe("truecolor");
    expect(detectTerminalColorMode({ TERM: "xterm-256color" })).toBe("ansi256");
    expect(detectTerminalColorMode({ TERM: "xterm" })).toBe("ansi16");
    expect(detectTerminalColorMode({ TERM: "xterm", NO_COLOR: "" })).toBe("none");
    expect(detectTerminalColorMode({ TERM: "dumb" })).toBe("none");
    expect(detectTerminalGlyphMode({ TERM: "xterm", LANG: "en_CA.UTF-8" })).toBe("unicode");
    expect(detectTerminalGlyphMode({ TERM: "xterm", LANG: "C" })).toBe("ascii");
    expect(detectTerminalTheme({ KEATING_THEME: "light" })).toBe("light");
    expect(detectTerminalTheme({ COLORFGBG: "0;15" })).toBe("light");
  });

  test("projects exact 80x24, 100x30, and 140x40 layouts without color-only meaning", () => {
    expect(terminalLayoutProfile(80, 24)).toMatchObject({
      size: "compact", showActivityRail: false, shellPadding: 0, compactStatus: true,
    });
    expect(terminalLayoutProfile(100, 30)).toMatchObject({
      size: "regular", showActivityRail: true, activityRailWidth: 26, transcriptTableStyle: "columns",
    });
    expect(terminalLayoutProfile(140, 40)).toMatchObject({
      size: "wide", showActivityRail: true, activityRailWidth: 32, transcriptTableStyle: "grid",
    });
    const profile = createTuiPresentationProfile({ TERM: "xterm", NO_COLOR: "", KEATING_ASCII: "1" });
    expect(profile.design.colorMode).toBe("none");
    expect(profile.design.glyphMode).toBe("ascii");
    expect(profile.design.states.error).toMatchObject({ glyph: "X", label: "Error", color: undefined });
    expect(profile.marks).toMatchObject({ assistant: "K", tool: "->", error: "X" });
  });
});

describe("OpenTUI semantic Markdown", () => {
  test("preserves the shared fixture while labeling terminal-only extensions and targets", () => {
    const output = prepareTerminalMarkdown(MARKDOWN_PARITY_FIXTURE);
    expect(output).toContain("**Spoiler (revealed in terminal):** a hidden retrieval cue");
    expect(output).toContain("Math `p(x|y)` (TeX source: `$p(x|y)$`)");
    expect(output).toContain("Display math — readable TeX source");
    expect(output).toContain("Mermaid source is preserved above");
    expect(output).toContain("Link target — a source: https://example.com/source");
    expect(output).toContain("Image target — a diagram: https://example.com/diagram.png");
    expect(output).toContain("```typescript");
  });

  test("renders the real shared fixture through OpenTUI MarkdownRenderable at 80 columns", async () => {
    const setup = await createTestRenderer({ width: 80, height: 24, exitOnCtrlC: false });
    const syntaxStyle = SyntaxStyle.fromStyles({
      default: {},
      "markup.heading": { bold: true },
      "markup.heading.1": { bold: true },
      "markup.heading.2": { bold: true },
      "markup.strong": { bold: true },
      "markup.italic": { italic: true },
      "markup.strikethrough": { dim: true },
      "markup.link": { underline: true },
      "markup.link.label": { underline: true },
      "markup.link.url": { underline: true },
    });
    try {
      const profile = createTuiPresentationProfile({ TERM: "xterm", NO_COLOR: "", KEATING_ASCII: "1" });
      const content = transcriptMarkdown([{
        id: "fixture",
        kind: "assistant",
        title: "Keating",
        body: MARKDOWN_PARITY_FIXTURE,
      }], null, profile);
      const markdown = new MarkdownRenderable(setup.renderer, {
        id: "terminal-markdown-fixture",
        content,
        syntaxStyle,
        conceal: true,
        concealCode: false,
        width: 80,
        height: 24,
        tableOptions: { style: "columns", widthMode: "full", wrapMode: "word", borders: false },
      });
      setup.renderer.root.add(markdown);
      await setup.flush();
      const frame = setup.captureCharFrame();
      expect(frame).toContain("Construct");
      expect(frame).toContain("Expected behavior");
      expect(frame).toContain("semantic native rendering");
      expect(frame).toContain("export function posterior");
      expect(frame).toContain("flowchart LR");
      expect(frame).not.toContain("| Construct | Expected behavior |");
      expect(frame).not.toContain("```typescript");
      expect(frame).not.toContain("```mermaid");
    } finally {
      setup.renderer.destroy();
      syntaxStyle.destroy();
    }
  });
});

describe("OpenTUI failed-prompt recovery", () => {
  test("restores and retries the exact learner draft without mutating it", async () => {
    const prompts: string[] = [];
    let attempts = 0;
    const recovery = new TuiPromptRecovery({
      async prompt(message) {
        prompts.push(message);
        attempts += 1;
        if (attempts === 1) throw new Error("provider unavailable");
      },
      async followUp(message) { prompts.push(`follow:${message}`); },
    });
    const draft = "  preserve spacing?  \nsecond line";
    expect(await recovery.send(draft, false, draft.trim())).toMatchObject({ ok: false, message: draft });
    expect(recovery.draft).toBe(draft);
    expect(await recovery.retry(false)).toEqual({ ok: true, message: draft });
    expect(recovery.draft).toBeNull();
    expect(prompts).toEqual([draft.trim(), draft.trim()]);
    expect(TUI_COMMANDS).toContainEqual(expect.objectContaining({ id: "retry", shortcut: "Ctrl+R" }));
  });

  test("uses the follow-up transport while busy and reports an empty retry truthfully", async () => {
    const calls: string[] = [];
    const recovery = new TuiPromptRecovery({
      async prompt(message) { calls.push(`prompt:${message}`); },
      async followUp(message) { calls.push(`follow:${message}`); },
    });
    expect(await recovery.retry(false)).toEqual({ ok: false, message: null, error: null });
    expect(await recovery.send("queued", true)).toEqual({ ok: true, message: "queued" });
    expect(recovery.pendingDraft).toBe("queued");
    expect(recovery.completePending()).toBe("queued");
    expect(recovery.pendingDraft).toBeNull();
    expect(calls).toEqual(["follow:queued"]);
  });

  test("restores an RPC-accepted draft when the provider fails asynchronously", async () => {
    const recovery = new TuiPromptRecovery({
      async prompt() {},
      async followUp() {},
    });

    expect(await recovery.send("exact accepted draft", false)).toEqual({ ok: true, message: "exact accepted draft" });
    expect(recovery.draft).toBeNull();
    expect(recovery.pendingDraft).toBe("exact accepted draft");
    expect(recovery.failPending()).toBe("exact accepted draft");
    expect(recovery.draft).toBe("exact accepted draft");
    expect(recovery.pendingDraft).toBeNull();
    expect(await recovery.retry(false)).toEqual({ ok: true, message: "exact accepted draft" });
    expect(recovery.pendingDraft).toBe("exact accepted draft");
  });
});

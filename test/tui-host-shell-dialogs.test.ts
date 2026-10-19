import { describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { createTuiDialogs } from "../src/tui/host/dialogs.js";
import { applyKeySuppression, applyTuiEffects, type TuiEffectHandlers } from "../src/tui/host/effects.js";
import type { TuiFocusArea, TuiInteractionEffect } from "../src/tui/host/interaction.js";
import { createTuiShell, currentSidebarWidth, terminalCanShowSidebar } from "../src/tui/host/shell.js";
import { createTuiTheme, openTuiColor } from "../src/tui/host/theme.js";
import { applyVimEdit, type VimEditableInput } from "../src/tui/host/vim-edit.js";
import { createTuiPresentationProfile } from "../src/tui/terminal-profile.js";

const profile = createTuiPresentationProfile({ NO_COLOR: "1", TERM: "xterm" });

async function mountShell() {
  const setup = await createTestRenderer({ width: 100, height: 30, exitOnCtrlC: false });
  const theme = createTuiTheme(profile);
  const parts = await createTuiShell(setup.renderer, theme);
  return { setup, theme, parts };
}

describe("createTuiShell", () => {
  test("mounts the shell and exposes the composer and status line", async () => {
    const { setup, parts } = await mountShell();
    try {
      expect(setup.renderer.root.getChildren().map((child) => child.id)).toContain("keating-open-tui");
      expect(parts.shell.id).toBe("keating-open-tui");
      expect(parts.input.id).toBe("keating-open-tui-input");
      expect(parts.onboarding.visible).toBe(false);
      expect(parts.indicator.visible).toBe(false);
      expect(parts.scroll.content.getChildren().map((child) => child.id)).toContain("keating-open-tui-transcript");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("lays out header, splash, workspace, composer and status in order", async () => {
    const { setup, parts } = await mountShell();
    try {
      const ids = parts.shell.getChildren().map((child) => child.id);
      expect(ids).toEqual([
        "keating-open-tui-header",
        "keating-open-tui-onboarding",
        "keating-open-tui-splash",
        "keating-open-tui-workspace",
        "keating-open-tui-indicator",
        "keating-open-tui-input-frame",
        "keating-open-tui-status",
      ]);
    } finally {
      setup.renderer.destroy();
    }
  });
});

describe("sidebar sizing", () => {
  test("widths step with terminal width and the panel needs 88x22", () => {
    expect(currentSidebarWidth(80)).toBe(24);
    expect(currentSidebarWidth(112)).toBe(30);
    expect(currentSidebarWidth(140)).toBe(34);
    expect(terminalCanShowSidebar(88, 22)).toBe(true);
    expect(terminalCanShowSidebar(87, 22)).toBe(false);
    expect(terminalCanShowSidebar(88, 21)).toBe(false);
  });
});

describe("theme", () => {
  test("monochrome terminals fall back to default colours and ASCII glyph rules follow the profile", () => {
    const theme = createTuiTheme(profile);
    expect(profile.design.colorMode).toBe("none");
    expect(theme.configuredSurfaceColor).toBeUndefined();
    expect(String(openTuiColor(profile, "text"))).toBe(String(theme.textColor));
    expect(theme.surfaceColor).toBeDefined();
    expect(String(theme.sidebarSurfaceColor)).toBe(String(theme.surfaceColor));
  });

  test("ASCII glyph mode installs plain border characters", () => {
    const ascii = createTuiPresentationProfile({ NO_COLOR: "1", TERM: "linux", LANG: "C", LC_ALL: "C" });
    const theme = createTuiTheme(ascii);
    expect(Boolean(theme.customBorderChars)).toBe(ascii.design.glyphMode === "ascii");
  });
});

describe("createTuiDialogs", () => {
  async function mountDialogs(initialFocus: TuiFocusArea = "composer") {
    const { setup, theme, parts } = await mountShell();
    let focusArea: TuiFocusArea = initialFocus;
    const focusLog: TuiFocusArea[] = [];
    let opens = 0;
    let closes = 0;
    let sidebarVisible = false;
    const dialogs = createTuiDialogs({
      renderer: setup.renderer,
      theme,
      shell: parts.shell,
      input: parts.input,
      status: parts.status,
      getFocusArea: () => focusArea,
      setFocusArea: (area) => { focusArea = area; focusLog.push(area); },
      isSidebarVisible: () => sidebarVisible,
      onOpen: () => { opens += 1; },
      onClose: () => { closes += 1; },
    });
    return {
      setup, parts, dialogs, focusLog,
      counts: () => ({ opens, closes }),
      setSidebarVisible: (visible: boolean) => { sidebarVisible = visible; },
    };
  }

  test("a select dialog opens, cancels to undefined, tears down, and returns focus", async () => {
    const { setup, parts, dialogs, focusLog, counts } = await mountDialogs("transcript");
    try {
      const before = parts.shell.getChildren().length;
      const pending = dialogs.presentSelect("Pick", ["alpha", "beta"]);
      expect(dialogs.isOpen()).toBe(true);
      expect(parts.shell.getChildren().length).toBe(before + 1);
      expect(counts()).toEqual({ opens: 1, closes: 0 });
      dialogs.cancel();
      expect(await pending).toBeUndefined();
      expect(dialogs.isOpen()).toBe(false);
      expect(parts.shell.getChildren().length).toBe(before);
      expect(focusLog).toEqual(["transcript"]);
      expect(counts()).toEqual({ opens: 1, closes: 1 });
    } finally {
      setup.renderer.destroy();
    }
  });

  test("a hidden sidebar is never the return focus", async () => {
    const { setup, dialogs, focusLog, setSidebarVisible } = await mountDialogs("sidebar");
    try {
      setSidebarVisible(false);
      const pending = dialogs.presentSelect("Pick", ["alpha"]);
      dialogs.cancel();
      await pending;
      expect(focusLog).toEqual(["composer"]);
    } finally {
      setup.renderer.destroy();
    }
  });

  test("a visible sidebar is restored", async () => {
    const { setup, dialogs, focusLog, setSidebarVisible } = await mountDialogs("sidebar");
    try {
      setSidebarVisible(true);
      const pending = dialogs.presentSelect("Pick", ["alpha"]);
      dialogs.cancel();
      await pending;
      expect(focusLog).toEqual(["sidebar"]);
    } finally {
      setup.renderer.destroy();
    }
  });

  test("an already-aborted signal resolves immediately and closes once", async () => {
    const { setup, parts, dialogs, counts } = await mountDialogs();
    try {
      const before = parts.shell.getChildren().length;
      const controller = new AbortController();
      controller.abort();
      expect(await dialogs.presentSelect("Pick", ["alpha"], { signal: controller.signal })).toBeUndefined();
      expect(dialogs.isOpen()).toBe(false);
      expect(parts.shell.getChildren().length).toBe(before);
      expect(counts().closes).toBe(1);
    } finally {
      setup.renderer.destroy();
    }
  });

  test("aborting while open closes the dialog", async () => {
    const { setup, dialogs } = await mountDialogs();
    try {
      const controller = new AbortController();
      const pending = dialogs.presentSelect("Pick", ["alpha"], { signal: controller.signal });
      expect(dialogs.isOpen()).toBe(true);
      controller.abort();
      expect(await pending).toBeUndefined();
      expect(dialogs.isOpen()).toBe(false);
    } finally {
      setup.renderer.destroy();
    }
  });

  test("a select dialog resolves with the chosen option on Enter", async () => {
    const { setup, dialogs } = await mountDialogs();
    try {
      const pending = dialogs.presentSelect("Pick", ["alpha", "beta"], { initialFocus: "list" });
      setup.mockInput.pressEnter();
      await setup.flush();
      expect(await pending).toBe("alpha");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("a message dialog is scrollable; a plain one is not", async () => {
    const { setup, dialogs } = await mountDialogs();
    try {
      const plain = dialogs.presentSelect("Pick", ["alpha"]);
      expect(dialogs.scroll(1)).toBe(false);
      dialogs.cancel();
      await plain;
      const withMessage = dialogs.presentSelect("Confirm", ["Yes", "No"], { message: "Long body" });
      expect(dialogs.scroll(1)).toBe(true);
      dialogs.cancel();
      await withMessage;
    } finally {
      setup.renderer.destroy();
    }
  });

  test("the filter field holds focus by default; list focus can be requested", async () => {
    const { setup, dialogs } = await mountDialogs();
    try {
      const filtered = dialogs.presentSelect("Pick", ["alpha"]);
      expect(dialogs.searchFocused()).toBe(true);
      dialogs.focusNext();
      expect(dialogs.searchFocused()).toBe(false);
      dialogs.focusPrevious();
      expect(dialogs.searchFocused()).toBe(true);
      dialogs.cancel();
      await filtered;
      const listed = dialogs.presentSelect("Pick", ["alpha"], { initialFocus: "list" });
      expect(dialogs.searchFocused()).toBe(false);
      dialogs.cancel();
      await listed;
    } finally {
      setup.renderer.destroy();
    }
  });

  test("a text dialog preserves its draft in the composer on cancel", async () => {
    const { setup, parts, dialogs } = await mountDialogs();
    try {
      const pending = dialogs.presentTextInput("Edit", "my draft");
      dialogs.cancel();
      expect(await pending).toBeUndefined();
      expect(parts.input.value).toBe("my draft");
      expect(parts.status.plainText).toContain("Draft preserved");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("a text dialog leaves the composer alone when preserving is disabled", async () => {
    const { setup, parts, dialogs } = await mountDialogs();
    try {
      const pending = dialogs.presentTextInput("Secret", "hunter2", undefined, { secret: true, preserveOnCancel: false });
      dialogs.cancel();
      await pending;
      expect(parts.input.value).toBe("");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("a text dialog submits its value on Enter", async () => {
    const { setup, dialogs } = await mountDialogs();
    try {
      const pending = dialogs.presentTextInput("Name", "ada");
      setup.mockInput.pressEnter();
      await setup.flush();
      expect(await pending).toBe("ada");
      expect(dialogs.isOpen()).toBe(false);
    } finally {
      setup.renderer.destroy();
    }
  });

  test("repeated dialogs do not leak renderables", async () => {
    const { setup, parts, dialogs } = await mountDialogs();
    try {
      const before = parts.shell.getChildren().length;
      for (let i = 0; i < 5; i += 1) {
        const pending = dialogs.presentSelect("Pick", ["alpha"]);
        dialogs.cancel();
        await pending;
      }
      expect(parts.shell.getChildren().length).toBe(before);
    } finally {
      setup.renderer.destroy();
    }
  });
});

describe("applyTuiEffects", () => {
  function recorder() {
    const calls: string[] = [];
    const handlers: TuiEffectHandlers = {
      cancelDialog: () => calls.push("cancelDialog"),
      scrollDialog: (d) => calls.push(`scrollDialog:${d}`),
      focusDialog: (d) => calls.push(`focusDialog:${d}`),
      abortProviderLogin: () => calls.push("abortProviderLogin"),
      setStatus: (t) => calls.push(`setStatus:${t}`),
      applyFocus: (a) => calls.push(`applyFocus:${a}`),
      toggleSidebar: () => calls.push("toggleSidebar"),
      showFilePicker: () => calls.push("showFilePicker"),
      beginLeader: () => calls.push("beginLeader"),
      endLeader: (o) => calls.push(`endLeader:${o.kind}`),
      paintVimMode: (m) => calls.push(`paintVimMode:${m}`),
      vimEdit: (a) => calls.push(`vimEdit:${a}`),
      renderOnboarding: () => calls.push("renderOnboarding"),
      finishOnboarding: (o) => calls.push(`finishOnboarding:${o}`),
      invoke: (c) => calls.push(`invoke:${c}`),
    };
    return { calls, handlers };
  }

  test("routes every effect type to its handler, in order", () => {
    const { calls, handlers } = recorder();
    const effects: TuiInteractionEffect[] = [
      { type: "abort-provider-login" },
      { type: "dialog-cancel" },
      { type: "dialog-scroll", direction: -1 },
      { type: "dialog-focus", direction: "previous" },
      { type: "status", text: "hi" },
      { type: "focus-apply", area: "sidebar" },
      { type: "toggle-sidebar" },
      { type: "show-file-picker" },
      { type: "leader-begin" },
      { type: "leader-end", outcome: { kind: "cancel" } },
      { type: "vim-mode", mode: "normal" },
      { type: "vim-edit", action: "undo" },
      { type: "onboarding-render" },
      { type: "onboarding-finish", outcome: "skipped" },
      { type: "invoke", command: "palette" },
    ];
    applyTuiEffects(effects, handlers);
    expect(calls).toEqual([
      "abortProviderLogin", "cancelDialog", "scrollDialog:-1", "focusDialog:previous", "setStatus:hi",
      "applyFocus:sidebar", "toggleSidebar", "showFilePicker", "beginLeader", "endLeader:cancel",
      "paintVimMode:normal", "vimEdit:undo", "renderOnboarding", "finishOnboarding:skipped", "invoke:palette",
    ]);
  });

  test("key suppression maps none/default/all onto preventDefault and stopPropagation", () => {
    const run = (suppress: "none" | "default" | "all") => {
      const log: string[] = [];
      applyKeySuppression({ preventDefault: () => log.push("prevent"), stopPropagation: () => log.push("stop") }, suppress);
      return log;
    };
    expect(run("none")).toEqual([]);
    expect(run("default")).toEqual(["prevent"]);
    expect(run("all")).toEqual(["prevent", "stop"]);
  });
});

describe("applyVimEdit", () => {
  test("each edit action drives exactly the matching input method; mode actions do nothing", () => {
    const calls: string[] = [];
    const input: VimEditableInput = {
      moveCursorLeft: () => calls.push("left"),
      moveCursorRight: () => calls.push("right"),
      moveCursorUp: () => calls.push("up"),
      moveCursorDown: () => calls.push("down"),
      gotoLineHome: () => calls.push("home"),
      gotoLineEnd: () => calls.push("end"),
      moveWordForward: () => calls.push("wordf"),
      moveWordBackward: () => calls.push("wordb"),
      deleteChar: () => calls.push("delete"),
      undo: () => calls.push("undo"),
    };
    const expected: Array<[Parameters<typeof applyVimEdit>[1], string[]]> = [
      ["move-left", ["left"]], ["move-right", ["right"]], ["append", ["right"]],
      ["move-up", ["up"]], ["move-down", ["down"]], ["line-home", ["home"]], ["line-end", ["end"]],
      ["word-forward", ["wordf"]], ["word-backward", ["wordb"]], ["delete", ["delete"]], ["undo", ["undo"]],
      ["insert", []], ["open-line", []], ["escape", []],
    ];
    for (const [action, effect] of expected) {
      calls.length = 0;
      applyVimEdit(input, action);
      expect(calls).toEqual(effect);
    }
  });
});

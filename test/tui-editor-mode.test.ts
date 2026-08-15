import { describe, expect, test } from "bun:test";
import { detectTuiEditorMode, editorModeLabel, vimNormalAction } from "../src/tui/editor-mode.js";

describe("TUI editor modes", () => {
  test("defaults to Emacs and accepts the explicit Vim setting", () => {
    expect(detectTuiEditorMode({})).toBe("emacs");
    expect(detectTuiEditorMode({ KEATING_EDITOR_MODE: "vim" })).toBe("vim");
    expect(detectTuiEditorMode({ KEATING_TUI_EDITOR: "vi" })).toBe("vim");
    expect(editorModeLabel("emacs")).toBe("Emacs");
    expect(editorModeLabel("vim", "normal")).toBe("Vim normal");
  });

  test("maps Vim motions and arrows in normal mode", () => {
    expect(vimNormalAction("h")).toBe("move-left");
    expect(vimNormalAction("left")).toBe("move-left");
    expect(vimNormalAction("j")).toBe("move-down");
    expect(vimNormalAction("up")).toBe("move-up");
    expect(vimNormalAction("w")).toBe("word-forward");
    expect(vimNormalAction("x")).toBe("delete");
    expect(vimNormalAction("escape")).toBe("escape");
    expect(vimNormalAction("q")).toBeNull();
  });
});

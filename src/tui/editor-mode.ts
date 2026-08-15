export type TuiEditorMode = "emacs" | "vim";
export type VimState = "insert" | "normal";

export function detectTuiEditorMode(env: Readonly<Record<string, string | undefined>> = process.env): TuiEditorMode {
  const value = (env.KEATING_EDITOR_MODE ?? env.KEATING_TUI_EDITOR ?? "").toLowerCase();
  return value === "vim" || value === "vi" ? "vim" : "emacs";
}
export function editorModeLabel(mode: TuiEditorMode, vimState: VimState = "insert"): string {
  return mode === "vim" ? `Vim ${vimState}` : "Emacs";
}

export type VimInputAction =
  | "insert"
  | "append"
  | "open-line"
  | "escape"
  | "move-left"
  | "move-right"
  | "move-up"
  | "move-down"
  | "line-home"
  | "line-end"
  | "word-forward"
  | "word-backward"
  | "delete"
  | "undo";

/** Map Vim normal-mode keys, including arrows, without coupling to OpenTUI. */
export function vimNormalAction(key: string): VimInputAction | null {
  switch (key) {
    case "i": return "insert";
    case "a": return "append";
    case "o": return "open-line";
    case "escape": return "escape";
    case "h":
    case "left": return "move-left";
    case "l":
    case "right": return "move-right";
    case "k":
    case "up": return "move-up";
    case "j":
    case "down": return "move-down";
    case "0": return "line-home";
    case "$":
    case "end": return "line-end";
    case "w": return "word-forward";
    case "b": return "word-backward";
    case "x":
    case "delete": return "delete";
    case "u": return "undo";
    default: return null;
  }
}

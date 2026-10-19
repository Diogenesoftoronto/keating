/**
 * Applies a Vim normal-mode action to the single-line composer input. Kept
 * separate from the key reducer so the reducer stays free of renderables.
 */
import type { VimInputAction } from "../editor-mode.js";

/** The slice of OpenTUI's InputRenderable that Vim normal mode drives. */
export interface VimEditableInput {
  moveCursorLeft(): void;
  moveCursorRight(): void;
  moveCursorUp(): void;
  moveCursorDown(): void;
  gotoLineHome(): void;
  gotoLineEnd(): void;
  moveWordForward(): void;
  moveWordBackward(): void;
  deleteChar(): void;
  undo(): void;
}

/**
 * Cursor/edit side effects of `action`. Mode switches (insert, append,
 * open-line, escape) are the reducer's concern and are no-ops here, except
 * that `append` first steps the cursor past the current character.
 */
export function applyVimEdit(input: VimEditableInput, action: VimInputAction): void {
  switch (action) {
    case "append":
    case "move-right":
      input.moveCursorRight();
      return;
    case "move-left":
      input.moveCursorLeft();
      return;
    case "move-up":
      input.moveCursorUp();
      return;
    case "move-down":
      input.moveCursorDown();
      return;
    case "line-home":
      input.gotoLineHome();
      return;
    case "line-end":
      input.gotoLineEnd();
      return;
    case "word-forward":
      input.moveWordForward();
      return;
    case "word-backward":
      input.moveWordBackward();
      return;
    case "delete":
      input.deleteChar();
      return;
    case "undo":
      input.undo();
      return;
    case "insert":
    case "open-line":
    case "escape":
      return;
  }
}

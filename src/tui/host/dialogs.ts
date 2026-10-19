/**
 * Modal overlays for the OpenTUI host: a filterable select list and a text
 * prompt. `createTuiDialogs` owns the overlay lifecycle (build, abort-signal
 * wiring, full teardown with `destroyRecursively`) and returns focus to the
 * area that was focused when the dialog opened. At most one dialog is live.
 * Open/close are reported through callbacks so the key reducer never sees
 * renderables.
 */
import {
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  RGBA,
  ScrollBoxRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core";
import { filterSearchOptions, type SearchOption } from "../search.js";
import { overlayHeaderLines, overlayResponseTone, truncateOverlayLabel } from "../overlay.js";
import { sacredTextWidth } from "../sacred.js";
import type { TuiFocusArea } from "./interaction.js";
import { openTuiColor, type TuiTheme } from "./theme.js";

export interface SelectPresentationOptions {
  /** Keep the filter field focused so typing immediately narrows the list. */
  initialFocus?: "filter" | "list";
  descriptions?: ReadonlyMap<string, string>;
  showDescription?: boolean;
  signal?: AbortSignal;
  /** Full confirmation text, kept out of the truncated heading. */
  message?: string;
}

export interface TextInputPresentationOptions {
  secret?: boolean;
  signal?: AbortSignal;
  preserveOnCancel?: boolean;
}

export interface TuiDialogDeps {
  renderer: CliRenderer;
  theme: TuiTheme;
  /** Root box that overlays are mounted on. */
  shell: BoxRenderable;
  /** Composer input; receives a preserved draft when a text dialog is cancelled. */
  input: InputRenderable;
  status: TextRenderable;
  getFocusArea(): TuiFocusArea;
  setFocusArea(area: TuiFocusArea): void;
  isSidebarVisible(): boolean;
  /** Called when a dialog goes on screen; `scrollable` means it has a PgUp/PgDn body. */
  onOpen(scrollable: boolean): void;
  /** Called once when the dialog is torn down, whatever the cause. */
  onClose(): void;
}

export interface TuiDialogs {
  presentSelect(title: string, options: string[], presentation?: SelectPresentationOptions): Promise<string | undefined>;
  presentTextInput(title: string, prefill?: string, placeholder?: string, presentation?: TextInputPresentationOptions): Promise<string | undefined>;
  /** True while a dialog is on screen. */
  isOpen(): boolean;
  /** Close the open dialog as if Escape were pressed. */
  cancel(): void;
  /** Page the dialog body. Returns false when the open dialog has no scrollable body. */
  scroll(direction: -1 | 1): boolean;
  focusNext(): void;
  focusPrevious(): void;
  /** True when the filter field of a select dialog holds focus. */
  searchFocused(): boolean;
}

export function createTuiDialogs(deps: TuiDialogDeps): TuiDialogs {
  const { renderer, theme, shell, input, status, getFocusArea, setFocusArea, isSidebarVisible, onOpen, onClose } = deps;
  const { textColor, mutedColor, accentColor, borderColor, sidebarSurfaceColor, customBorderChars } = theme;
  const presentationProfile = theme.profile;
  let dialogCancel: (() => void) | null = null;
  let dialogScroll: ((direction: number) => void) | null = null;
  let dialogFocusNext: (() => void) | null = null;
  let dialogFocusPrevious: (() => void) | null = null;
  let dialogSearchInput: InputRenderable | null = null;

  const presentSelect = (title: string, options: string[], presentation: SelectPresentationOptions = {}): Promise<string | undefined> =>
    new Promise((resolve) => {
      const returnFocus = getFocusArea();
      const overlayWidth = Math.max(24, Math.floor(renderer.terminalWidth * 0.8));
      const innerWidth = Math.max(12, overlayWidth - 4);
      // One header row: what this is on the left, the two keys that matter on
      // the right. Typing filters, so the filter row needs no instructions.
      const hint = presentation.message ? "PgUp/PgDn read · esc" : "↵ select · esc";
      const titleLines = overlayHeaderLines(title, hint, innerWidth);
      const maxHeight = Math.max(10, renderer.terminalHeight - 6);
      // The border uses two rows; the filter row and its gap use two more.
      const chromeRows = titleLines.length + 4;
      const availableRows = Math.max(1, maxHeight - chromeRows);
      const optionRows = Math.min(Math.max(1, options.length), presentation.message ? Math.max(1, Math.floor(availableRows / 2)) : availableRows);
      const messageLines = presentation.message?.split("\n").reduce((count, line) => count + Math.max(1, Math.ceil(sacredTextWidth(line) / Math.max(1, innerWidth - 1))), 0) ?? 0;
      const messageRows = Math.min(messageLines, Math.max(1, availableRows - optionRows));
      const optionName = (option: string) => truncateOverlayLabel(option, Math.max(8, innerWidth - 2));
      const modal = new BoxRenderable(renderer, {
        id: `keating-dialog-${Date.now()}`,
        width: "80%",
        height: Math.min(maxHeight, chromeRows + optionRows + (presentation.message ? messageRows : 0)),
        position: "absolute",
        top: "10%",
        left: "10%",
        zIndex: 30,
        flexDirection: "column",
        border: true,
        borderStyle: presentationProfile.design.glyphMode === "ascii" ? "single" : "rounded",
        customBorderChars,
        borderColor,
        backgroundColor: sidebarSurfaceColor,
        shouldFill: true,
        paddingLeft: 1,
        paddingRight: 1,
      });
      const titleView = new TextRenderable(renderer, {
        content: titleLines.join("\n"),
        fg: mutedColor,
        bg: sidebarSurfaceColor,
        height: titleLines.length,
      });
      const filterInput = new InputRenderable(renderer, {
        id: `keating-select-filter-${Date.now()}`,
        width: "100%",
        marginBottom: 1,
        placeholder: presentationProfile.design.glyphMode === "ascii" ? "> filter" : "› filter",
        textColor,
        placeholderColor: mutedColor,
        backgroundColor: sidebarSurfaceColor,
        focusedBackgroundColor: sidebarSurfaceColor,
        focusedTextColor: textColor,
      });
      const select = new SelectRenderable(renderer, {
        id: `keating-select-${Date.now()}`,
        flexGrow: 1,
        options: options.map((option) => ({ name: optionName(option), description: presentation.descriptions?.get(option) ?? "", value: option })),
        showDescription: presentation.showDescription ?? false,
        // The highlight bar already marks the row; a second arrow is noise.
        showSelectionIndicator: false,
        wrapSelection: true,
        backgroundColor: sidebarSurfaceColor,
        textColor: textColor,
        focusedBackgroundColor: sidebarSurfaceColor,
        focusedTextColor: textColor,
        selectedBackgroundColor: accentColor,
        selectedTextColor: sidebarSurfaceColor,
        descriptionColor: mutedColor,
        selectedDescriptionColor: sidebarSurfaceColor,
      });
      const paintSelectedResponse = () => {
        const value = select.getSelectedOption()?.value;
        const role = overlayResponseTone(typeof value === "string" ? value : "");
        select.selectedBackgroundColor = openTuiColor(presentationProfile, role) ?? RGBA.defaultForeground();
      };
      modal.add(titleView);
      if (presentation.message) {
        const body = new ScrollBoxRenderable(renderer, { width: "100%", height: messageRows, flexShrink: 0, scrollY: true, scrollX: false });
        body.add(new TextRenderable(renderer, { content: presentation.message, width: "100%", wrapMode: "word", fg: textColor, bg: sidebarSurfaceColor }));
        modal.add(body);
        dialogScroll = (direction) => body.scrollBy(direction * Math.max(1, messageRows - 1));
      }
      modal.add(filterInput);
      modal.add(select);
      shell.add(modal);
      let done = false;
      let onAbort: (() => void) | undefined;
      const finish = (value?: string) => {
        if (done) return;
        done = true;
        if (onAbort) presentation.signal?.removeEventListener("abort", onAbort);
        dialogCancel = null;
        dialogScroll = null;
        dialogFocusNext = null;
        dialogFocusPrevious = null;
        dialogSearchInput = null;
        onClose();
        // OpenTUI's remove() only detaches; destroy the complete modal tree so
        // repeated palettes do not retain inputs, listeners, buffers, or Yoga nodes.
        modal.destroyRecursively();
        setFocusArea(returnFocus === "sidebar" && !isSidebarVisible() ? "composer" : returnFocus);
        resolve(value);
      };
      onAbort = () => finish(undefined);
      const updateOptions = () => {
        const ranked = filterSearchOptions(options.map((option): SearchOption => ({ label: option, value: option })), filterInput.value);
        select.options = ranked.length > 0
          ? ranked.map((option) => ({ name: optionName(option.label), description: presentation.descriptions?.get(option.label) ?? "", value: option.value }))
          : [{ name: "No matching options", description: "Clear the filter or press Esc", value: undefined }];
        select.setSelectedIndex(0);
        paintSelectedResponse();
      };
      filterInput.on(InputRenderableEvents.INPUT, updateOptions);
      filterInput.on(InputRenderableEvents.ENTER, () => select.focus());
      dialogCancel = () => finish(undefined);
      onOpen(dialogScroll !== null);
      dialogSearchInput = filterInput;
      dialogFocusNext = () => select.focus();
      dialogFocusPrevious = () => filterInput.focus();
      select.on(SelectRenderableEvents.SELECTION_CHANGED, paintSelectedResponse);
      select.on(SelectRenderableEvents.ITEM_SELECTED, () => {
        const value = select.getSelectedOption()?.value;
        if (typeof value === "string") finish(value);
      });
      if (presentation.signal?.aborted) {
        finish(undefined);
        return;
      }
      presentation.signal?.addEventListener("abort", onAbort, { once: true });
      paintSelectedResponse();
      if (presentation.initialFocus === "list") select.focus();
      else filterInput.focus();
    });

  const presentTextInput = (
    title: string,
    prefill?: string,
    placeholder?: string,
    presentation: TextInputPresentationOptions = {},
  ): Promise<string | undefined> =>
    new Promise((resolve) => {
      const returnFocus = getFocusArea();
      const overlayWidth = Math.max(24, Math.floor(renderer.terminalWidth * 0.8));
      const innerWidth = Math.max(12, overlayWidth - 4);
      const titleLines = overlayHeaderLines(title, "↵ submit · esc", innerWidth);
      const modal = new BoxRenderable(renderer, {
        id: `keating-input-dialog-${Date.now()}`,
        width: "80%",
        height: titleLines.length + 3,
        position: "absolute",
        top: "30%",
        left: "10%",
        zIndex: 30,
        flexDirection: "column",
        border: true,
        borderStyle: presentationProfile.design.glyphMode === "ascii" ? "single" : "rounded",
        customBorderChars,
        borderColor,
        backgroundColor: sidebarSurfaceColor,
        shouldFill: true,
        paddingLeft: 1,
        paddingRight: 1,
      });
      const titleView = new TextRenderable(renderer, {
        content: titleLines.join("\n"),
        fg: mutedColor,
        bg: sidebarSurfaceColor,
        height: titleLines.length,
      });
      const dialogInput = new InputRenderable(renderer, {
        id: `keating-dialog-input-${Date.now()}`,
        width: "100%",
        value: prefill ?? "",
        placeholder: placeholder ?? "Type a response…",
        textColor: presentation.secret ? sidebarSurfaceColor : textColor,
        placeholderColor: mutedColor,
        backgroundColor: sidebarSurfaceColor,
        focusedBackgroundColor: sidebarSurfaceColor,
        focusedTextColor: presentation.secret ? sidebarSurfaceColor : textColor,
        showCursor: !presentation.secret,
      });
      modal.add(titleView);
      modal.add(dialogInput);
      shell.add(modal, 3);
      let done = false;
      let onAbort: (() => void) | undefined;
      const finish = (value?: string, preserveInComposer = false) => {
        if (done) return;
        done = true;
        const preservedDraft = dialogInput.value;
        if (onAbort) presentation.signal?.removeEventListener("abort", onAbort);
        dialogCancel = null;
        dialogScroll = null;
        dialogFocusNext = null;
        dialogFocusPrevious = null;
        dialogSearchInput = null;
        onClose();
        modal.destroyRecursively();
        if (value === undefined && preserveInComposer && preservedDraft) {
          input.value = preservedDraft;
          status.content = "Draft preserved in composer. Edit it or reopen document actions with Ctrl+U.";
        }
        setFocusArea(returnFocus === "sidebar" && !isSidebarVisible() ? "composer" : returnFocus);
        resolve(value);
      };
      onAbort = () => finish(undefined);
      dialogCancel = () => finish(undefined, presentation.preserveOnCancel ?? true);
      onOpen(false);
      dialogFocusNext = () => dialogInput.focus();
      dialogFocusPrevious = () => dialogInput.focus();
      dialogInput.on(InputRenderableEvents.ENTER, () => finish(dialogInput.value));
      if (presentation.signal?.aborted) {
        finish(undefined);
        return;
      }
      presentation.signal?.addEventListener("abort", onAbort, { once: true });
      dialogInput.focus();
    });

  return {
    presentSelect,
    presentTextInput,
    isOpen: () => dialogCancel !== null,
    cancel: () => dialogCancel?.(),
    scroll(direction) {
      if (!dialogScroll) return false;
      dialogScroll(direction);
      return true;
    },
    focusNext: () => dialogFocusNext?.(),
    focusPrevious: () => dialogFocusPrevious?.(),
    searchFocused: () => dialogSearchInput?.focused === true,
  };
}

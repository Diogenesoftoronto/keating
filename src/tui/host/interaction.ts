/**
 * Pure keyboard/focus state machine for the OpenTUI host.
 *
 * `tuiInteractionReducer(state, action)` owns focus area, Vim insert/normal
 * mode, the `:` leader prefix and the onboarding tour. It never touches the
 * renderer: facts the reducer cannot own (is a dialog open, is the side panel
 * visible, what is in the composer) arrive in `TuiKeyContext`, and everything
 * it wants done comes back as ordered `TuiInteractionEffect`s plus a
 * `suppress` verdict that tells the host whether to preventDefault /
 * stopPropagation the key.
 *
 * Key precedence is the order of `TUI_KEY_STAGES`: the first stage that
 * claims a key wins, so a later stage can never see it.
 */
import { tuiOnboardingActionForKey, navigateTuiOnboarding } from "../onboarding.js";
import { vimNormalAction, type TuiEditorMode, type VimInputAction, type VimState } from "../editor-mode.js";
import { isTuiLeaderKey, tuiLeaderAction, type TuiLeaderAction } from "../leader.js";
import type { TuiCommand } from "../view-model.js";

export type TuiFocusArea = "composer" | "transcript" | "sidebar";
export type TuiOnboardingResult = "completed" | "skipped";

/** Structural subset of OpenTUI's KeyEvent the reducer reads. */
export interface TuiKey {
  name: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  code?: string;
  baseCode?: number;
}

export interface TuiInteractionState {
  readonly focusArea: TuiFocusArea;
  readonly editorMode: TuiEditorMode;
  readonly vimState: VimState;
  /** `:` was pressed on an empty composer; the next key picks a command. */
  readonly leaderActive: boolean;
  readonly onboarding: { readonly active: boolean; readonly pageIndex: number };
  /** The open dialog, or null. Cancelling closes it here immediately. */
  readonly modal: { readonly scrollable: boolean } | null;
}

/** Facts owned by the host that decide how a key is interpreted. */
export interface TuiKeyContext {
  /** The open dialog's filter field holds focus (Down moves to the list). */
  readonly modalSearchFocused: boolean;
  readonly providerLoginActive: boolean;
  readonly sidebarVisible: boolean;
  /** Composer text is empty or just the leader colon. */
  readonly composerAllowsLeader: boolean;
  /** Composer ends in an `@file` reference that Tab should browse. */
  readonly fileReferenceActive: boolean;
  readonly onboardingPageCount: number;
}

/** Everything the host can be asked to run from the keyboard. */
export type TuiHostCommand = "palette" | "ui-actions" | "transcript-search" | TuiCommand["id"];

export type TuiLeaderOutcome =
  | { readonly kind: "cancel" }
  | { readonly kind: "unknown"; readonly keyName: string }
  | { readonly kind: "run"; readonly command: TuiHostCommand };

export type TuiInteractionEffect =
  | { readonly type: "dialog-cancel" }
  | { readonly type: "dialog-scroll"; readonly direction: -1 | 1 }
  | { readonly type: "dialog-focus"; readonly direction: "next" | "previous" }
  | { readonly type: "abort-provider-login" }
  | { readonly type: "status"; readonly text: string }
  | { readonly type: "focus-apply"; readonly area: TuiFocusArea }
  | { readonly type: "toggle-sidebar" }
  | { readonly type: "show-file-picker" }
  | { readonly type: "leader-begin" }
  | { readonly type: "leader-end"; readonly outcome: TuiLeaderOutcome }
  | { readonly type: "vim-mode"; readonly mode: VimState }
  | { readonly type: "vim-edit"; readonly action: VimInputAction }
  | { readonly type: "onboarding-render" }
  | { readonly type: "onboarding-finish"; readonly outcome: TuiOnboardingResult }
  | { readonly type: "invoke"; readonly command: TuiHostCommand };

/** How much of the key the host should swallow. */
export type TuiKeySuppression = "none" | "default" | "all";

export type TuiInteractionAction =
  | { readonly type: "key"; readonly key: TuiKey; readonly context: TuiKeyContext }
  /** Programmatic focus change; Sidebar falls back to composer when hidden. */
  | { readonly type: "focus-request"; readonly area: TuiFocusArea; readonly sidebarVisible: boolean }
  /** Focus already moved (renderable events); record it without re-applying. */
  | { readonly type: "focus-observed"; readonly area: TuiFocusArea }
  | { readonly type: "vim-mode"; readonly mode: VimState }
  | { readonly type: "modal-open"; readonly scrollable: boolean }
  | { readonly type: "modal-close" }
  | { readonly type: "onboarding-begin" }
  | { readonly type: "onboarding-end" };

export interface TuiInteractionResult {
  readonly state: TuiInteractionState;
  readonly suppress: TuiKeySuppression;
  readonly effects: readonly TuiInteractionEffect[];
}

export const CANCELLING_PROVIDER_STATUS = "Cancelling provider connection…";

export function initialTuiInteractionState(editorMode: TuiEditorMode): TuiInteractionState {
  return {
    focusArea: "composer",
    editorMode,
    vimState: "insert",
    leaderActive: false,
    onboarding: { active: false, pageIndex: 0 },
    modal: null,
  };
}

// A Map, so key names such as "constructor" can never resolve to a prototype member.
const CTRL_COMMANDS: ReadonlyMap<string, TuiHostCommand> = new Map<string, TuiHostCommand>([
  ["p", "palette"],
  ["s", "sessions"],
  ["l", "library"],
  ["o", "courses"],
  ["m", "model"],
  ["t", "thinking"],
  ["n", "new-session"],
  ["x", "abort"],
  ["r", "retry"],
]);

export function leaderActionCommand(action: TuiLeaderAction): TuiHostCommand {
  if (action === "actions") return "ui-actions";
  if (action === "search") return "transcript-search";
  return action;
}

function done(state: TuiInteractionState, suppress: TuiKeySuppression = "none", effects: readonly TuiInteractionEffect[] = []): TuiInteractionResult {
  return { state, suppress, effects };
}

interface KeyStageInput {
  readonly state: TuiInteractionState;
  readonly key: TuiKey;
  readonly context: TuiKeyContext;
  /** Lower-cased key name. */
  readonly name: string;
}

/** A stage returns a result when it claims the key, or null to pass it on. */
type KeyStage = (input: KeyStageInput) => TuiInteractionResult | null;

const onboardingStage: KeyStage = ({ state, key, context }) => {
  if (!state.onboarding.active) return null;
  const action = tuiOnboardingActionForKey({ name: key.name, ctrl: key.ctrl, meta: key.meta, shift: key.shift });
  if (!action) return done(state);
  const navigation = navigateTuiOnboarding(state.onboarding.pageIndex, action, context.onboardingPageCount);
  if (navigation.outcome === "active") {
    return done({ ...state, onboarding: { active: true, pageIndex: navigation.pageIndex } }, "all", [{ type: "onboarding-render" }]);
  }
  return done(
    { ...state, onboarding: { active: false, pageIndex: navigation.pageIndex } },
    "all",
    [{ type: "onboarding-finish", outcome: navigation.outcome }],
  );
};

const modalStage: KeyStage = ({ state, key, context, name }) => {
  const modal = state.modal;
  if (!modal) return null;
  const closed = { ...state, modal: null };
  if (key.ctrl && name === "x" && context.providerLoginActive) {
    return done(closed, "all", [
      { type: "abort-provider-login" },
      { type: "dialog-cancel" },
      { type: "status", text: CANCELLING_PROVIDER_STATUS },
    ]);
  }
  // Ctrl+P is a toggle for the command palette. Treat it as a modal close
  // for any selector/input dialog so the same muscle memory always exits.
  if (key.ctrl && key.name === "p") return done(closed, "all", [{ type: "dialog-cancel" }]);
  if (key.name === "escape") return done(closed, "default", [{ type: "dialog-cancel" }]);
  if ((key.name === "pageup" || key.name === "pagedown") && modal.scrollable) {
    return done(state, "all", [{ type: "dialog-scroll", direction: key.name === "pageup" ? -1 : 1 }]);
  }
  if (key.name === "tab") {
    return done(state, "default", [{ type: "dialog-focus", direction: key.shift ? "previous" : "next" }]);
  }
  if (key.name === "down" && context.modalSearchFocused) {
    return done(state, "default", [{ type: "dialog-focus", direction: "next" }]);
  }
  return done(state);
};

const sidebarEscapeStage: KeyStage = ({ state, name }) => {
  if (state.focusArea !== "sidebar" || name !== "escape") return null;
  return done({ ...state, focusArea: "composer" }, "all", [{ type: "focus-apply", area: "composer" }]);
};

const sidebarToggleStage: KeyStage = ({ state, key, name }) => {
  if (!key.ctrl || name !== "b") return null;
  return done(state, "all", [{ type: "toggle-sidebar" }]);
};

const leaderStage: KeyStage = ({ state, name }) => {
  if (!state.leaderActive) return null;
  const next = { ...state, leaderActive: false };
  if (name === "escape") return done(next, "all", [{ type: "leader-end", outcome: { kind: "cancel" } }]);
  const action = tuiLeaderAction(name);
  // `typeof` guards names that collide with Object.prototype members.
  const outcome: TuiLeaderOutcome = typeof action === "string"
    ? { kind: "run", command: leaderActionCommand(action) }
    : { kind: "unknown", keyName: name };
  return done(next, "all", [{ type: "leader-end", outcome }]);
};

const leaderBeginStage: KeyStage = ({ state, key, context, name }) => {
  if (key.ctrl || key.meta || state.focusArea !== "composer") return null;
  if (!context.composerAllowsLeader || !isTuiLeaderKey(name)) return null;
  return done({ ...state, leaderActive: true }, "all", [{ type: "leader-begin" }]);
};

const tabStage: KeyStage = ({ state, key, context }) => {
  if (key.name !== "tab" || key.ctrl || key.meta) return null;
  if (state.focusArea === "sidebar") return done(state);
  if (state.focusArea === "composer" && context.fileReferenceActive) {
    return done(state, "all", [{ type: "show-file-picker" }]);
  }
  const area: TuiFocusArea = state.focusArea === "composer"
    ? "transcript"
    : context.sidebarVisible ? "sidebar" : "composer";
  return done({ ...state, focusArea: area }, "all", [{ type: "focus-apply", area }]);
};

/** Vim normal-mode action -> effects. Insert/append/open-line leave normal mode. */
function vimNormalResult(state: TuiInteractionState, action: VimInputAction): TuiInteractionResult {
  switch (action) {
    case "insert":
    // The composer is intentionally single-line; `o` enters insert mode at the
    // current cursor instead of creating an impossible new line.
    case "open-line":
      return done({ ...state, vimState: "insert" }, "all", [{ type: "vim-mode", mode: "insert" }]);
    case "append":
      return done({ ...state, vimState: "insert" }, "all", [
        { type: "vim-edit", action },
        { type: "vim-mode", mode: "insert" },
      ]);
    case "escape":
      return done(state, "all");
    default:
      return done(state, "all", [{ type: "vim-edit", action }]);
  }
}

const vimStage: KeyStage = ({ state, key }) => {
  if (state.editorMode !== "vim" || state.focusArea !== "composer") return null;
  if (state.vimState === "insert" && key.name === "escape") {
    return done({ ...state, vimState: "normal" }, "all", [{ type: "vim-mode", mode: "normal" }]);
  }
  if (state.vimState !== "normal" || key.ctrl || key.meta) return null;
  const action = vimNormalAction(key.name);
  return action ? vimNormalResult(state, action) : null;
};

/** Ctrl+<letter> global shortcuts. Falls through for anything unbound. */
const ctrlStage: KeyStage = ({ state, key, context, name }) => {
  if (!key.ctrl) return null;
  if (name === "x" && context.providerLoginActive) {
    return done(state, "all", [{ type: "abort-provider-login" }, { type: "status", text: CANCELLING_PROVIDER_STATUS }]);
  }
  if (key.name === "u") return done(state, "all", [{ type: "invoke", command: "ui-actions" }]);
  if (key.name === "f") return done(state, "all", [{ type: "invoke", command: "transcript-search" }]);
  // Ctrl+M is encoded as Ctrl+Return when Kitty/modifyOtherKeys is active.
  // Raw legacy terminals cannot distinguish it from Enter, so they retain
  // the ordinary submit behavior.
  if (name === "return" || name === "enter") return done(state, "all", [{ type: "invoke", command: "model" }]);
  const command = CTRL_COMMANDS.get(name)
    ?? (key.code?.toLowerCase() === "keym" || key.baseCode === 109 ? "model" : undefined);
  if (!command) return null;
  return done(state, "all", [{ type: "invoke", command }]);
};

/** Precedence, highest first: the first stage to claim a key wins. */
export const TUI_KEY_STAGES: ReadonlyArray<readonly [string, KeyStage]> = [
  ["onboarding", onboardingStage],
  ["modal", modalStage],
  ["sidebar-escape", sidebarEscapeStage],
  ["sidebar-toggle", sidebarToggleStage],
  ["leader", leaderStage],
  ["leader-begin", leaderBeginStage],
  ["tab", tabStage],
  ["vim", vimStage],
  ["ctrl", ctrlStage],
];

function reduceKey(state: TuiInteractionState, key: TuiKey, context: TuiKeyContext): TuiInteractionResult {
  const input: KeyStageInput = { state, key, context, name: key.name.toLowerCase() };
  for (const [, stage] of TUI_KEY_STAGES) {
    const result = stage(input);
    if (result) return result;
  }
  return done(state);
}

/** Effective focus target: the side panel is only reachable while visible. */
function resolveFocusArea(area: TuiFocusArea, sidebarVisible: boolean): TuiFocusArea {
  return area === "sidebar" && !sidebarVisible ? "composer" : area;
}

export function tuiInteractionReducer(state: TuiInteractionState, action: TuiInteractionAction): TuiInteractionResult {
  switch (action.type) {
    case "key":
      return reduceKey(state, action.key, action.context);
    case "focus-request": {
      const area = resolveFocusArea(action.area, action.sidebarVisible);
      return done({ ...state, focusArea: area }, "none", [{ type: "focus-apply", area }]);
    }
    case "focus-observed":
      return done({ ...state, focusArea: action.area });
    case "vim-mode":
      return done({ ...state, vimState: action.mode }, "none", [{ type: "vim-mode", mode: action.mode }]);
    case "modal-open":
      return done({ ...state, modal: { scrollable: action.scrollable } });
    case "modal-close":
      return done({ ...state, modal: null });
    case "onboarding-begin":
      return done({ ...state, onboarding: { active: true, pageIndex: 0 } });
    case "onboarding-end":
      return done({ ...state, onboarding: { ...state.onboarding, active: false } });
  }
}

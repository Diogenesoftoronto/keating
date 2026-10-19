/**
 * Keyboard wiring for the OpenTUI host. `installKeyboard` subscribes one
 * `keypress` listener that feeds the pure reducer (see `interaction.ts`) with
 * a `TuiKeyContext` read from live state, applies the key-suppression verdict,
 * then runs the reducer's effects through `TuiEffectHandlers`. Precedence is
 * decided entirely in the reducer; this module only translates effects into
 * flow calls and widget updates.
 */
import { activeComposerFileReference } from "../composer.js";
import { TUI_LEADER_HINT } from "../leader.js";
import { tuiOnboardingPages } from "../onboarding.js";
import { TUI_COMMANDS } from "../view-model.js";
import type { HostContext } from "./context.js";
import { applyKeySuppression, applyTuiEffects, type TuiEffectHandlers } from "./effects.js";
import { finishOnboarding, type OnboardingDeps } from "./flows/onboarding.js";
import { runCommandAndRefocus, type CommandDeps } from "./flows/commands.js";
import {
  showCommandPalette,
  showFileReferencePicker,
  showTranscriptSearch,
  showUiActions,
  type PickerDeps,
} from "./flows/pickers.js";
import type { TuiHostCommand, TuiKey, TuiKeyContext, TuiLeaderOutcome } from "./interaction.js";
import { dispatchInteraction } from "./state.js";

export type KeyboardDeps = CommandDeps & PickerDeps & OnboardingDeps & Pick<HostContext, "renderer" | "sidebar">;

/** Run one host command from a shortcut, leader key or palette entry. */
export function invokeHostCommand(deps: KeyboardDeps, command: TuiHostCommand): void {
  if (command === "palette") void showCommandPalette(deps);
  else if (command === "ui-actions") void showUiActions(deps);
  else if (command === "transcript-search") void showTranscriptSearch(deps);
  else {
    const match = TUI_COMMANDS.find((candidate) => candidate.id === command);
    if (match) void runCommandAndRefocus(deps, match);
  }
}

/** Facts the reducer needs but cannot own, read fresh for every key. */
export function keyContext(deps: Pick<KeyboardDeps, "dialogs" | "state" | "view">): TuiKeyContext {
  const { dialogs, state, view } = deps;
  return {
    modalSearchFocused: dialogs.searchFocused(),
    providerLoginActive: state.activeProviderLoginAbort !== null,
    sidebarVisible: state.sidebar?.visible === true,
    composerAllowsLeader: view.composer.value.length === 0 || view.composer.value === ":",
    fileReferenceActive: Boolean(activeComposerFileReference(view.composer.value)),
    onboardingPageCount: state.interaction.onboarding.active
      ? tuiOnboardingPages({ hasProvider: state.firstRunHasProvider }).length
      : 0,
  };
}

export function createEffectHandlers(deps: KeyboardDeps): TuiEffectHandlers {
  const { dialogs, sidebar, state, view } = deps;
  return {
    cancelDialog: () => dialogs.cancel(),
    scrollDialog: (direction) => { dialogs.scroll(direction); },
    focusDialog: (direction) => { if (direction === "next") dialogs.focusNext(); else dialogs.focusPrevious(); },
    abortProviderLogin: () => state.activeProviderLoginAbort?.abort(),
    setStatus: (text) => { view.status.content = text; },
    applyFocus: view.applyFocusArea,
    toggleSidebar: () => sidebar.toggle(),
    showFilePicker: () => { void showFileReferencePicker(deps); },
    beginLeader: () => {
      view.composer.value = "";
      view.status.content = TUI_LEADER_HINT;
    },
    endLeader(outcome: TuiLeaderOutcome) {
      view.composer.value = "";
      if (outcome.kind === "cancel") view.status.content = view.idleStatus();
      else if (outcome.kind === "unknown") view.status.content = `Unknown :${outcome.keyName} command · ${TUI_LEADER_HINT}`;
      else invokeHostCommand(deps, outcome.command);
    },
    paintVimMode: view.paintVimMode,
    vimEdit: view.vimEdit,
    renderOnboarding: view.renderOnboarding,
    finishOnboarding: (outcome) => { void finishOnboarding(deps, outcome); },
    invoke: (command) => invokeHostCommand(deps, command),
  };
}

/** A key event the host can suppress, as OpenTUI delivers it. */
export type SuppressibleKey = TuiKey & { preventDefault(): void; stopPropagation(): void };

/** Route every key through the reducer, suppress it per the verdict, then run its effects. */
export function createKeypressHandler(deps: KeyboardDeps): (key: SuppressibleKey) => void {
  const handlers = createEffectHandlers(deps);
  return (key) => {
    const result = dispatchInteraction(deps.state, { type: "key", key, context: keyContext(deps) });
    applyKeySuppression(key, result.suppress);
    applyTuiEffects(result.effects, handlers);
  };
}

export function installKeyboard(deps: KeyboardDeps): void {
  const onKey = createKeypressHandler(deps);
  deps.renderer.keyInput.on("keypress", (key) => onKey(key));
}

/**
 * Applies `TuiInteractionEffect`s produced by the key reducer. The mapping
 * from effect to handler is exhaustive and flat; the handlers themselves are
 * supplied by the host, which owns the renderables.
 */
import type { VimInputAction, VimState } from "../editor-mode.js";
import type {
  TuiFocusArea,
  TuiHostCommand,
  TuiInteractionEffect,
  TuiKeySuppression,
  TuiLeaderOutcome,
  TuiOnboardingResult,
} from "./interaction.js";

export interface TuiEffectHandlers {
  cancelDialog(): void;
  scrollDialog(direction: -1 | 1): void;
  focusDialog(direction: "next" | "previous"): void;
  abortProviderLogin(): void;
  setStatus(text: string): void;
  applyFocus(area: TuiFocusArea): void;
  toggleSidebar(): void;
  showFilePicker(): void;
  beginLeader(): void;
  endLeader(outcome: TuiLeaderOutcome): void;
  paintVimMode(mode: VimState): void;
  vimEdit(action: VimInputAction): void;
  renderOnboarding(): void;
  finishOnboarding(outcome: TuiOnboardingResult): void;
  invoke(command: TuiHostCommand): void;
}

export function applyTuiEffect(effect: TuiInteractionEffect, handlers: TuiEffectHandlers): void {
  switch (effect.type) {
    case "dialog-cancel": return handlers.cancelDialog();
    case "dialog-scroll": return handlers.scrollDialog(effect.direction);
    case "dialog-focus": return handlers.focusDialog(effect.direction);
    case "abort-provider-login": return handlers.abortProviderLogin();
    case "status": return handlers.setStatus(effect.text);
    case "focus-apply": return handlers.applyFocus(effect.area);
    case "toggle-sidebar": return handlers.toggleSidebar();
    case "show-file-picker": return handlers.showFilePicker();
    case "leader-begin": return handlers.beginLeader();
    case "leader-end": return handlers.endLeader(effect.outcome);
    case "vim-mode": return handlers.paintVimMode(effect.mode);
    case "vim-edit": return handlers.vimEdit(effect.action);
    case "onboarding-render": return handlers.renderOnboarding();
    case "onboarding-finish": return handlers.finishOnboarding(effect.outcome);
    case "invoke": return handlers.invoke(effect.command);
  }
}

/** Run effects in the order the reducer emitted them. */
export function applyTuiEffects(effects: readonly TuiInteractionEffect[], handlers: TuiEffectHandlers): void {
  for (const effect of effects) applyTuiEffect(effect, handlers);
}

/** `default` stops the terminal default only; `all` also stops other key listeners. */
export function applyKeySuppression(
  key: { preventDefault(): void; stopPropagation(): void },
  suppress: TuiKeySuppression,
): void {
  if (suppress === "none") return;
  key.preventDefault();
  if (suppress === "all") key.stopPropagation();
}

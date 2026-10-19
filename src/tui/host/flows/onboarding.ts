/**
 * Start and finish the keyboard-first onboarding tour.
 */
import { KEATING_VERSION } from "../../../core/version.js";
import { markTuiOnboardingSeen, resetTuiOnboarding } from "../../onboarding.js";
import { sanitizeDiagnostic } from "../../view-model.js";
import { dispatchInteraction } from "../state.js";
import type { HostContext } from "../context.js";
import { showSetupWizard } from "./setup.js";

export type OnboardingDeps = Pick<HostContext, "client" | "controller" | "cwd" | "dialogs" | "openExternalUrl" | "state" | "surface" | "view">;

export async function beginOnboarding(deps: OnboardingDeps, reset = false): Promise<void> {
  const { cwd, client, state } = deps;
  const { composer: input } = deps.view;
  if (reset) await resetTuiOnboarding(cwd);
  try {
    state.firstRunHasProvider = (await client.getAvailableModels()).length > 0;
  } catch {
    state.firstRunHasProvider = false;
  }
  deps.view.resetOnboardingObject();
  dispatchInteraction(state, { type: "onboarding-begin" });
  input.blur();
  deps.view.renderOnboarding();
}

export async function finishOnboarding(deps: OnboardingDeps, outcome: "completed" | "skipped"): Promise<void> {
  const { cwd, state } = deps;
  const { setFocusArea, status } = deps.view;
  dispatchInteraction(state, { type: "onboarding-end" });
  state.suppressEmptySplash = true;
  deps.view.renderOnboarding();
  setFocusArea("composer");
  try {
    await markTuiOnboardingSeen(cwd, KEATING_VERSION);
    status.content = outcome === "skipped"
      ? "Tour skipped · /onboarding replays it · Ctrl+P opens every command"
      : "Ready · ask a real question · @path adds a file · Ctrl+P opens every command";
  } catch (error) {
    status.content = `Ready, but tour completion was not saved: ${sanitizeDiagnostic(error, 160)} · /onboarding replays it`;
  }
  if (outcome === "completed") await showSetupWizard(deps, { confirm: false });
}

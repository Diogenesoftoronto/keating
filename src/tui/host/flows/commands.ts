/**
 * Dispatch of local Keating commands (palette, leader keys, slash commands and
 * sidebar entries all land in `runCommand`) and the hand-off to the classic Pi shell.
 */
import { type TuiCommand } from "../../view-model.js";
import type { HostContext } from "../context.js";
import { showCourses } from "./courses.js";
import { showLibrary } from "./library.js";
import { beginOnboarding } from "./onboarding.js";
import { retryLastPrompt } from "./prompt.js";
import { showModelPicker } from "./provider.js";
import { restorePendingDraft } from "./recovery.js";
import { showReview } from "./review.js";
import { showSessions } from "./sessions.js";
import { showDebug, showSettings } from "./settings.js";
import { showSetupWizard } from "./setup.js";
import { showShareSession } from "./share.js";

export type CommandDeps = Pick<HostContext, "client" | "controller" | "cwd" | "dialogs" | "listSessions" | "openExternalUrl" | "promptRecovery" | "renderer" | "sidebar" | "state" | "surface" | "view">;

export async function exitToShell(deps: CommandDeps): Promise<void> {
  const { client, controller, state, renderer } = deps;
  state.settled = true;
  state.settle?.({ action: "shell", sessionPath: controller.getCurrentSessionPath() || undefined });
  renderer.destroy();
  await client.stop();
}

export async function runCommand(deps: CommandDeps, command: TuiCommand): Promise<void> {
  const { controller, surface, state, sidebar } = deps;
  switch (command.id) {
    case "onboarding":
      await beginOnboarding(deps, true);
      return;
    case "setup":
      await showSetupWizard(deps);
      return;
    case "sessions":
      await showSessions(deps);
      return;
    case "library":
      await showLibrary(deps);
      return;
    case "review":
      await showReview(deps);
      return;
    case "courses":
      await showCourses(deps);
      return;
    case "share":
      await showShareSession(deps);
      return;
    case "settings":
      await showSettings(deps);
      return;
    case "debug":
      await showDebug(deps);
      return;
    case "model":
      await showModelPicker(deps);
      return;
    case "thinking":
      await controller.cycleThinking();
      return;
    case "new-session": {
      const confirmed = state.entries.length === 0
        ? true
        : await surface.presentConfirm("Start a new session?", "Your current session remains saved and can be reopened in Pi.");
      if (confirmed) {
        await controller.newSession();
        await sidebar.refreshSessions();
      }
      return;
    }
    case "abort":
      await controller.abort();
      restorePendingDraft(deps, "The response was stopped before completion.", "Stopped draft restored");
      return;
    case "retry":
      await retryLastPrompt(deps);
      return;
    case "shell":
      await exitToShell(deps);
  }
}

export async function runCommandAndRefocus(deps: CommandDeps, command: TuiCommand): Promise<void> {
  const { state } = deps;
  const { setFocusArea } = deps.view;
  await runCommand(deps, command);
  if (!state.settled) setFocusArea("composer");
}

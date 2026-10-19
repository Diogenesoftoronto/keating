/**
 * Runtime settings and the read-only debug service.
 */
import { TUI_DEBUG_ACTIONS, tuiDebugEventsMarkdown, tuiDebugMessagesMarkdown, tuiDebugSummary, tuiProcessDiagnosticsMarkdown } from "../../debug.js";
import { TUI_SETTINGS_ACTIONS, tuiRuntimeSettings, tuiSettingsMarkdown } from "../../settings.js";
import { sanitizeDiagnostic } from "../../view-model.js";
import type { HostContext } from "../context.js";
import { busySurfaceNotice, restoreIdleStatus } from "./common.js";
import { beginOnboarding } from "./onboarding.js";
import { showModelPicker, showProviderLogin } from "./provider.js";

export type SettingsDeps = Pick<HostContext, "client" | "controller" | "cwd" | "dialogs" | "openExternalUrl" | "state" | "surface" | "view">;

export async function showSettings(deps: SettingsDeps): Promise<void> {
  const { client, controller, dialogs } = deps;
  const { appendEntry, status, composer: input } = deps.view;
  const { presentSelect } = dialogs;
  if (busySurfaceNotice(deps, "Settings")) return;
  status.content = "Loading runtime settings…";
  try {
    const [stateResult, modelsResult, commandsResult] = await Promise.allSettled([
      client.getState(), client.getAvailableModels(), client.getCommands(),
    ]);
    const settings = tuiRuntimeSettings(
      stateResult.status === "fulfilled" ? stateResult.value : {},
      modelsResult.status === "fulfilled" ? modelsResult.value.length : 0,
      commandsResult.status === "fulfilled" ? commandsResult.value.map((command) => command.name) : [],
    );
    appendEntry({ id: `settings-summary-${Date.now()}`, kind: "artifact", title: "Settings", body: tuiSettingsMarkdown(settings) });
    const action = await presentSelect("Terminal settings · changes apply to the real Pi runtime", [...TUI_SETTINGS_ACTIONS]);
    if (action === undefined || action === "Close settings") return;
    if (action === "Replay onboarding tour") await beginOnboarding(deps, true);
    else if (action === "Select model") await showModelPicker(deps);
    else if (action === "Connect or repair provider") {
      if (await showProviderLogin(deps)) await showModelPicker(deps);
    } else if (action === "Cycle thinking") await controller.cycleThinking();
    else if (action === "Toggle automatic retry") {
      await client.setAutoRetry(!settings.autoRetry);
      appendEntry({ id: `settings-retry-${Date.now()}`, kind: "notice", title: "Automatic retry changed", body: settings.autoRetry ? "Off" : "On" });
    } else if (action === "Toggle automatic compaction") {
      await client.setAutoCompaction(!settings.autoCompaction);
      appendEntry({ id: `settings-compaction-${Date.now()}`, kind: "notice", title: "Automatic compaction changed", body: settings.autoCompaction ? "Off" : "On" });
    } else if (action === "Toggle steering queue mode") {
      const mode = settings.steeringMode === "all" ? "one-at-a-time" : "all";
      await client.setSteeringMode(mode);
      appendEntry({ id: `settings-steering-${Date.now()}`, kind: "notice", title: "Steering queue changed", body: mode });
    } else if (action === "Toggle follow-up queue mode") {
      const mode = settings.followUpMode === "all" ? "one-at-a-time" : "all";
      await client.setFollowUpMode(mode);
      appendEntry({ id: `settings-followup-${Date.now()}`, kind: "notice", title: "Follow-up queue changed", body: mode });
    } else if (action === "Open debug service") {
      await showDebug(deps);
    } else if (action === "Prepare /shell code-capability handoff") {
      input.value = "/shell";
      appendEntry({
        id: `settings-shell-${Date.now()}`,
        kind: "notice",
        title: "Classic Pi handoff prepared",
        body: "/shell is in the composer. Submit when ready to use execution and source-mutation tools; provider login and model selection stay available here.",
      });
    }
  } catch (error) {
    appendEntry({ id: `settings-error-${Date.now()}`, kind: "error", title: "Settings change failed", body: `${sanitizeDiagnostic(error)}\n\nThe prior runtime setting remains in effect. Retry provider connection directly from settings.` });
  } finally {
    restoreIdleStatus(deps);
  }
}

export async function showDebug(deps: SettingsDeps): Promise<void> {
  const { client, state, dialogs } = deps;
  const { appendEntry, status } = deps.view;
  const { presentSelect } = dialogs;
  if (busySurfaceNotice(deps, "Debug service")) return;
  status.content = "Collecting local runtime diagnostics…";
  try {
    const [stateResult, messagesResult, modelsResult, commandsResult, statsResult] = await Promise.allSettled([
      client.getState(),
      client.getMessages(),
      client.getAvailableModels(),
      client.getCommands(),
      client.getSessionStats(),
    ]);
    const piState = stateResult.status === "fulfilled" ? stateResult.value : {};
    const messages = messagesResult.status === "fulfilled" ? messagesResult.value : [];
    const models = modelsResult.status === "fulfilled" ? modelsResult.value : [];
    const commands = commandsResult.status === "fulfilled" ? commandsResult.value : [];
    const sessionStats = statsResult.status === "fulfilled" ? statsResult.value : undefined;
    appendEntry({
      id: `debug-summary-${Date.now()}`,
      kind: "artifact",
      title: "Debug service",
      body: tuiDebugSummary({
        state: piState,
        messages,
        models,
        commands,
        sessionStats,
        events: state.runtimeDebugEvents,
        processDiagnostics: client.getStderr(),
      }),
    });
    const action = await presentSelect("Terminal debug service · local and read-only", [...TUI_DEBUG_ACTIONS]);
    if (action === "Show model-facing messages") {
      appendEntry({ id: `debug-messages-${Date.now()}`, kind: "artifact", title: "Model-facing messages", body: tuiDebugMessagesMarkdown(messages) });
    } else if (action === "Show recent runtime events") {
      appendEntry({ id: `debug-events-${Date.now()}`, kind: "artifact", title: "Runtime events", body: tuiDebugEventsMarkdown(state.runtimeDebugEvents) });
    } else if (action === "Show Pi process diagnostics") {
      appendEntry({ id: `debug-process-${Date.now()}`, kind: "artifact", title: "Pi process diagnostics", body: tuiProcessDiagnosticsMarkdown(client.getStderr()) });
    } else if (action === "Clear captured runtime events") {
      state.runtimeDebugEvents.splice(0);
      appendEntry({ id: `debug-cleared-${Date.now()}`, kind: "notice", title: "Runtime event ring cleared", body: "No session messages, provider credentials, or saved Pi state were changed." });
    }
  } catch (error) {
    appendEntry({
      id: `debug-error-${Date.now()}`,
      kind: "error",
      title: "Debug service could not inspect the runtime",
      body: `${sanitizeDiagnostic(error)}\n\nThe active session was not changed. Pi process diagnostics remain available after the next RPC response.`,
    });
  } finally {
    restoreIdleStatus(deps);
  }
}
